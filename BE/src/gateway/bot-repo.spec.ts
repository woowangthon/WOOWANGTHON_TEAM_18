import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { BotError, BotRepo } from './bot-repo.js'

// 가짜 값만 쓴다. 진짜 토큰은 테스트에 없다.
const TOKEN = `ghp_${'f'.repeat(36)}`
const FORK = { full_name: 'wanggane-bot/app', fork: true, owner: { login: 'wanggane-bot' }, parent: { full_name: 'Student/App' } }

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}
let seen: Seen[]
let routes: Record<string, (body: unknown) => { status: number; body?: unknown; text?: string }>
let errors: string[]

const respond = (r: { status: number; body?: unknown; text?: string }) =>
  new Response(r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body)), { status: r.status })

function bot(token: string | null = TOKEN): BotRepo {
  const b = new BotRepo({ get: () => token ?? undefined } as unknown as ConfigService<Env, true>)
  b.waitMs = 0
  return b
}

beforeEach(() => {
  seen = []
  errors = []
  routes = {
    'GET /user': () => ({ status: 200, body: { login: 'wanggane-bot' } }),
    'POST /repos/student/app/forks': () => ({ status: 202, body: FORK }),
    'GET /repos/wanggane-bot/app': () => ({ status: 200, body: FORK }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const path = url.replace('https://api.github.com', '')
      const call: Seen = { method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined }
      seen.push(call)
      const route = routes[`${call.method} ${path}`]
      return Promise.resolve(respond(route ? route(call.body) : { status: 404, body: { message: 'Not Found' } }))
    }),
  )
  vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => void errors.push(String(message)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BotRepo.fork', () => {
  it('forks the repository once, checks that it is the bot fork of that repository, and remembers it', async () => {
    const b = bot()
    expect(await b.fork('student/app')).toBe('wanggane-bot/app')
    expect(await b.fork('student/app')).toBe('wanggane-bot/app')
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.github.com', '')}`)).toEqual(['GET /user', 'POST /repos/student/app/forks', 'GET /repos/wanggane-bot/app'])
    expect(seen[1].body).toEqual({ default_branch_only: true })
  })

  it('sends the token only to api.github.com, as a bearer header', async () => {
    await bot().fork('student/app')
    for (const s of seen) {
      expect(s.url.startsWith('https://api.github.com/')).toBe(true)
      expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('waits until GitHub has made the fork', async () => {
    let tries = 0
    routes['GET /repos/wanggane-bot/app'] = () => (++tries < 3 ? { status: 404 } : { status: 200, body: FORK })
    expect(await bot().fork('student/app')).toBe('wanggane-bot/app')
    expect(tries).toBe(3)
  })

  it('gives up when the fork never shows up', async () => {
    routes['GET /repos/wanggane-bot/app'] = () => ({ status: 404 })
    await expect(bot().fork('student/app')).rejects.toMatchObject({ kind: 'cannot-fork' })
  })

  it.each([403, 404, 422])('says the repository cannot be forked when GitHub answers %i', async (status) => {
    routes['POST /repos/student/app/forks'] = () => ({ status, body: { message: 'Forbidden' } })
    await expect(bot().fork('student/app')).rejects.toMatchObject({ kind: 'cannot-fork' })
  })

  it.each([401, 429, 500, 502])('does not call GitHub answering %i a blocked repository', async (status) => {
    routes['POST /repos/student/app/forks'] = () => ({ status })
    await expect(bot().fork('student/app')).rejects.toMatchObject({ kind: 'github' })
  })

  it.each([
    ['another owner', { ...FORK, owner: { login: 'someone' } }],
    ['not a fork', { ...FORK, fork: false }],
    ['a fork of another repository', { ...FORK, parent: { full_name: 'other/app' } }],
    ['an odd name', { ...FORK, full_name: 'a b' }],
  ])('refuses a fork answer with %s', async (_name, body) => {
    routes['POST /repos/student/app/forks'] = () => ({ status: 202, body })
    await expect(bot().fork('student/app')).rejects.toMatchObject({ kind: 'cannot-fork' })
  })

  it.each(['student', 'a/b/c', 'a b/c', '../x', 'a/..', './x', 'a/.'])('does not call GitHub for the repository name %j', async (name) => {
    await expect(bot().fork(name)).rejects.toMatchObject({ kind: 'cannot-fork' })
    expect(seen).toEqual([])
  })

  it('does nothing without a token', async () => {
    const b = bot(null)
    expect(b.available()).toBe(false)
    await expect(b.fork('student/app')).rejects.toMatchObject({ kind: 'none' })
    await expect(b.tree('wanggane-bot/app', 'a'.repeat(40))).rejects.toMatchObject({ kind: 'none' })
    expect(seen).toEqual([])
  })
})

describe('BotRepo.tree and blob', () => {
  it('reads the files of a commit with their mode and blob', async () => {
    const sha = 'a'.repeat(40)
    routes[`GET /repos/wanggane-bot/app/git/commits/${sha}`] = () => ({ status: 200, body: { tree: { sha: 'tree1' } } })
    routes['GET /repos/wanggane-bot/app/git/trees/tree1?recursive=1'] = () => ({
      status: 200,
      body: { truncated: false, tree: [{ path: 'start.sh', mode: '100755', type: 'blob', sha: 'b1', size: 9 }, { path: 'src', mode: '040000', type: 'tree', sha: 't2' }, { nope: 1 }] },
    })
    expect(await bot().tree('wanggane-bot/app', sha)).toEqual({
      treeSha: 'tree1',
      truncated: false,
      entries: new Map([
        ['start.sh', { mode: '100755', type: 'blob', sha: 'b1', size: 9 }],
        ['src', { mode: '040000', type: 'tree', sha: 't2', size: 0 }],
      ]),
    })
  })

  it('reads a blob as bytes', async () => {
    routes['GET /repos/wanggane-bot/app/git/blobs/b1'] = () => ({ status: 200, body: { encoding: 'base64', content: Buffer.from('hello').toString('base64') } })
    expect((await bot().blob('wanggane-bot/app', 'b1')).toString()).toBe('hello')
  })

  it('fails with a bot error when the commit is not readable', async () => {
    await expect(bot().tree('wanggane-bot/app', 'a'.repeat(40))).rejects.toMatchObject({ kind: 'github' })
  })
})

describe('BotRepo.commit', () => {
  const files = [{ path: 'start.sh', mode: '100755', content: 'echo hi\n' }]
  const wire = (refStatus: number) => {
    routes['POST /repos/wanggane-bot/app/git/blobs'] = () => ({ status: 201, body: { sha: 'blob1' } })
    routes['POST /repos/wanggane-bot/app/git/trees'] = () => ({ status: 201, body: { sha: 'tree2' } })
    routes['POST /repos/wanggane-bot/app/git/commits'] = () => ({ status: 201, body: { sha: 'c'.repeat(40) } })
    routes['POST /repos/wanggane-bot/app/git/refs'] = () => ({ status: refStatus, body: {} })
    routes['PATCH /repos/wanggane-bot/app/git/refs/heads/wcp-fix-t_a'] = () => ({ status: 200, body: {} })
  }

  it('writes the blob, the tree on the base tree, a commit on the parent, and the branch', async () => {
    wire(201)
    expect(await bot().commit('wanggane-bot/app', 'p'.repeat(40), 'tree0', 'wcp-fix-t_a', files, 'fix: x')).toBe('c'.repeat(40))
    expect(seen.map((s) => `${s.method} ${s.url.replace('https://api.github.com/repos/wanggane-bot/app/git/', '')}`)).toEqual(['POST blobs', 'POST trees', 'POST commits', 'POST refs'])
    expect(seen[0].body).toEqual({ content: 'echo hi\n', encoding: 'utf-8' })
    expect(seen[1].body).toEqual({ base_tree: 'tree0', tree: [{ path: 'start.sh', mode: '100755', type: 'blob', sha: 'blob1' }] })
    expect(seen[2].body).toEqual({ message: 'fix: x', tree: 'tree2', parents: ['p'.repeat(40)] })
    expect(seen[3].body).toEqual({ ref: 'refs/heads/wcp-fix-t_a', sha: 'c'.repeat(40) })
  })

  it('moves the branch with force when it already exists', async () => {
    wire(422)
    await bot().commit('wanggane-bot/app', 'p'.repeat(40), 'tree0', 'wcp-fix-t_a', files, 'fix: x')
    expect(seen.at(-1)).toMatchObject({ method: 'PATCH', body: { sha: 'c'.repeat(40), force: true } })
  })

  it('fails with a bot error when a step is refused', async () => {
    wire(201)
    routes['POST /repos/wanggane-bot/app/git/trees'] = () => ({ status: 422, body: { message: 'bad' } })
    await expect(bot().commit('wanggane-bot/app', 'p'.repeat(40), 'tree0', 'wcp-fix-t_a', files, 'm')).rejects.toMatchObject({ kind: 'github' })
    expect(seen.map((s) => s.method)).not.toContain('PATCH')
  })
})

describe('BotRepo.pull', () => {
  const repoOk = () => {
    routes['GET /repos/student/app'] = () => ({ status: 200, body: { default_branch: 'main' } })
  }

  it('opens the pull request from the bot branch to the default branch', async () => {
    repoOk()
    routes['POST /repos/student/app/pulls'] = () => ({ status: 201, body: { html_url: 'https://github.com/student/app/pull/3' } })
    expect(await bot().pull('student/app', 'wcp-fix-t_a', 'title', 'body')).toEqual({ opened: true, url: 'https://github.com/student/app/pull/3' })
    expect(seen.at(-1)?.body).toEqual({ title: 'title', body: 'body', head: 'wanggane-bot:wcp-fix-t_a', base: 'main', maintainer_can_modify: false })
  })

  it('returns the pull request that is already open for this branch', async () => {
    repoOk()
    routes['POST /repos/student/app/pulls'] = () => ({ status: 422, body: { message: 'A pull request already exists' } })
    routes['GET /repos/student/app/pulls?head=wanggane-bot%3Awcp-fix-t_a&state=all'] = () => ({ status: 200, body: [{ html_url: 'https://github.com/student/app/pull/2' }] })
    expect(await bot().pull('student/app', 'wcp-fix-t_a', 't', 'b')).toEqual({ opened: true, url: 'https://github.com/student/app/pull/2' })
  })

  it.each([403, 404, 422])('says it did not open when GitHub answers %i and there is no pull request', async (status) => {
    repoOk()
    routes['POST /repos/student/app/pulls'] = () => ({ status, body: {} })
    routes['GET /repos/student/app/pulls?head=wanggane-bot%3Awcp-fix-t_a&state=all'] = () => ({ status: 200, body: [] })
    expect(await bot().pull('student/app', 'wcp-fix-t_a', 't', 'b')).toEqual({ opened: false })
  })

  it('says it did not open when the repository cannot be read', async () => {
    routes['GET /repos/student/app'] = () => ({ status: 404 })
    expect(await bot().pull('student/app', 'b', 't', 'b')).toEqual({ opened: false })
  })

  it('fails with a bot error on a server error', async () => {
    repoOk()
    routes['POST /repos/student/app/pulls'] = () => ({ status: 502 })
    await expect(bot().pull('student/app', 'b', 't', 'b')).rejects.toMatchObject({ kind: 'github' })
  })
})

describe('BotRepo.patch', () => {
  it('asks for the patch format and cuts a very long answer', async () => {
    routes['GET /repos/wanggane-bot/app/compare/aaa...bbb'] = () => ({ status: 200, text: 'x'.repeat(150_000) })
    const text = await bot().patch('wanggane-bot/app', 'aaa', 'bbb')
    expect(text).toHaveLength(100_000)
    expect(seen[0].headers.Accept).toBe('application/vnd.github.patch')
  })
})

describe('the token stays secret', () => {
  it('is not in the log or the error when GitHub cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError(`fetch failed for Bearer ${TOKEN}`))))
    const err = await bot().fork('student/app').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BotError)
    expect(JSON.stringify({ err, message: (err as Error).message, stack: (err as Error).stack?.includes(TOKEN) })).not.toContain(TOKEN)
    expect(errors.join('\n')).not.toContain(TOKEN)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('is not in the log when GitHub refuses', async () => {
    routes['GET /user'] = () => ({ status: 401, body: { message: `Bad credentials ${TOKEN}` } })
    await expect(bot().fork('student/app')).rejects.toBeInstanceOf(BotError)
    expect(errors.join('\n')).not.toContain(TOKEN)
    expect(errors.join('\n')).toContain('401')
  })
})
