import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { RepoReader, repoPath } from './repo-reader.js'

// api.md `read_repo`: 200KB 넘으면 자른다.
const SPEC_FILE_BYTES = 200 * 1024

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
    const answer = answers.get(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (answer instanceof Error) return Promise.reject(answer)
    return Promise.resolve(answer ?? new Response('{}', { status: 404 }))
  })
  const readerWith = (GITHUB_TOKEN?: string) => new RepoReader(new ConfigService<Env, true>({ GITHUB_TOKEN }))
  const reader = readerWith()
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
    answers.set(`${RAW}/big.txt`, new Response('x'.repeat(SPEC_FILE_BYTES * 3)))
    const entry = await reader.read('student/app', SHA, 'big.txt')
    expect(entry).toMatchObject({ type: 'file', truncated: true })
    expect(entry?.type === 'file' && entry.content.length).toBe(SPEC_FILE_BYTES)
  })

  it('stops reading a raw file at the limit instead of taking all of it', async () => {
    stub()
    let pulled = 0
    // 끝나지 않는 파일: 다 읽으려 하면 이 테스트는 끝나지 않는다.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(64 * 1024).fill(120))
      },
    })
    answers.set(`${API}/huge.bin?ref=${SHA}`, Response.json({ type: 'file', encoding: 'none', content: '' }))
    answers.set(`${RAW}/huge.bin`, new Response(endless))
    const entry = await reader.read('student/app', SHA, 'huge.bin')
    expect(entry).toMatchObject({ type: 'file', truncated: true })
    expect(entry?.type === 'file' && entry.content.length).toBe(SPEC_FILE_BYTES)
    expect(pulled).toBeLessThan(10)
  })

  it('answers null for a missing path', async () => {
    stub()
    await expect(reader.read('student/app', SHA, 'nope')).resolves.toBeNull()
  })

  it.each([
    ['a 403 that is not a rate limit', new Response('{}', { status: 403 })],
    ['a network error', new TypeError('fetch failed')],
  ])('throws GITHUB_UNAVAILABLE on %s', async (_label, answer) => {
    stub()
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    answers.set(`${API}/a?ref=${SHA}`, answer)
    const err = await reader.read('student/app', SHA, 'a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceUnavailableException)
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'GITHUB_UNAVAILABLE' })
  })

  it.each([
    ['a token', 'github_pat_x', 'Bearer github_pat_x'],
    ['no token', undefined, undefined],
  ])('with %s, sends Authorization %s to the API (never to raw)', async (_, token, auth) => {
    stub()
    answers.set(`${API}/big.txt?ref=${SHA}`, Response.json({ type: 'file', encoding: 'none', content: '' }))
    answers.set(`${RAW}/big.txt`, new Response('x'))
    await readerWith(token).read('student/app', SHA, 'big.txt')
    const headers = fetchMock.mock.calls.map(([url, init]) => [url as string, (init?.headers as Record<string, string>).Authorization])
    expect(headers).toEqual([
      [`${API}/big.txt?ref=${SHA}`, auth],
      [`${RAW}/big.txt`, undefined],
    ])
  })

  it('throws GITHUB_RATE_LIMITED with the reset time when no requests remain', async () => {
    stub()
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const reset = Math.floor(Date.UTC(2026, 10, 14, 8, 30) / 1000)
    answers.set(`${API}/a?ref=${SHA}`, new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }))
    const err = await reader.read('student/app', SHA, 'a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServiceUnavailableException)
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'GITHUB_RATE_LIMITED', retryAt: '2026-11-14T08:30:00.000Z' })
  })
})
