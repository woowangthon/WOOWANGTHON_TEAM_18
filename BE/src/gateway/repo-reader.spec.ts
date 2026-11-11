import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_BYTES, RepoReader, repoPath } from './repo-reader.js'

const SHA = 'a'.repeat(40)
const API = `https://api.github.com/repos/student/app/contents`
const RAW = `https://raw.githubusercontent.com/student/app/${SHA}`

describe('repoPath', () => {
  it.each([
    ['.', ''],
    ['', ''],
    ['src/main.ts', 'src/main.ts'],
    ['./src//a.ts', 'src/a.ts'],
  ])('keeps %j as %j', (path, clean) => {
    expect(repoPath(path)).toBe(clean)
  })

  it.each(['/etc/passwd', '../x', 'src/../../x', 'a\\b', 'a\0b', 'a'.repeat(401)])('refuses %j', (path) => {
    expect(repoPath(path)).toBeNull()
  })
})

describe('RepoReader', () => {
  const answers = new Map<string, Response | Error>()
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const answer = answers.get(String(input))
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve(answer ?? new Response('{}', { status: 404 }))
  })
  const reader = new RepoReader()
  afterEach(() => {
    answers.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const stub = () => vi.stubGlobal('fetch', fetchMock)

  it('lists a folder at the commit', async () => {
    stub()
    answers.set(`${API}?ref=${SHA}`, Response.json([{ name: 'src', type: 'dir', size: 0 }, { name: 'a.ts', type: 'file', size: 3 }, 'junk']))
    await expect(reader.read('student/app', SHA, '')).resolves.toEqual({
      type: 'dir',
      entries: [
        { name: 'src', type: 'dir', size: 0 },
        { name: 'a.ts', type: 'file', size: 3 },
      ],
    })
  })

  it('decodes a file, encoding each path part', async () => {
    stub()
    answers.set(`${API}/src/my%20file.ts?ref=${SHA}`, Response.json({ type: 'file', encoding: 'base64', content: Buffer.from('hello').toString('base64') }))
    await expect(reader.read('student/app', SHA, 'src/my file.ts')).resolves.toEqual({ type: 'file', content: 'hello', truncated: false })
  })

  it('reads a big file from raw and cuts it at the limit', async () => {
    stub()
    answers.set(`${API}/big.txt?ref=${SHA}`, Response.json({ type: 'file', encoding: 'none', content: '' }))
    answers.set(`${RAW}/big.txt`, new Response('x'.repeat(MAX_FILE_BYTES + 10)))
    const entry = await reader.read('student/app', SHA, 'big.txt')
    expect(entry).toMatchObject({ type: 'file', truncated: true })
    expect(entry?.type === 'file' && entry.content.length).toBe(MAX_FILE_BYTES)
  })

  it('answers null for a missing path', async () => {
    stub()
    await expect(reader.read('student/app', SHA, 'nope')).resolves.toBeNull()
  })

  it.each([
    ['a 403 (rate limit)', new Response('{}', { status: 403 })],
    ['a network error', new TypeError('fetch failed')],
  ])('throws GITHUB_UNAVAILABLE on %s', async (_label, answer) => {
    stub()
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    answers.set(`${API}/a?ref=${SHA}`, answer)
    const err = await reader.read('student/app', SHA, 'a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceUnavailableException)
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'GITHUB_UNAVAILABLE' })
  })
})
