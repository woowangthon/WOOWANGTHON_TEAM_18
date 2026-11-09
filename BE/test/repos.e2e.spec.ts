import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

// vitest.config.ts의 값과 같다.
const SUPABASE_USER_URL = 'https://test.supabase.co/auth/v1/user'
const API_KEY = 'sb_publishable_test'
const GITHUB_ID = '4242'
const REPO_URL = 'https://github.com/student/my-app'
const VALID = { repoUrl: REPO_URL }

// 테스트마다 바꿔 끼우는 외부 서비스의 답. 기본값은 "연동한 학생이 자기 개인 레포를 낸다"이다.
type Answer = () => Response
let supabaseAnswer: Answer
let githubAnswer: Answer
let treeAnswer: Answer
let logError: MockInstance<Logger['error']>

const linkedUser = (id = GITHUB_ID): Answer => () =>
  Response.json({ identities: [{ provider: 'email', id: 'user-1' }, { provider: 'github', id }] })
const emailOnlyUser: Answer = () => Response.json({ identities: [{ provider: 'email', id: 'user-1' }] })
const repoOwnedBy = (id: number | string, type = 'User'): Answer => () =>
  Response.json({ full_name: 'Student/My-App', private: false, default_branch: 'main', owner: { login: 'student', id, type } })
const treeOf = (paths: string[], truncated = false): Answer => () =>
  Response.json({ sha: 'abc', truncated, tree: paths.map((path) => ({ path, type: path.endsWith('/') ? 'tree' : 'blob' })) })
const status = (code: number): Answer => () => new Response('{}', { status: code })
const fails = (err: Error): Answer => () => {
  throw err
}
// 어느 서비스든 닿지 못하거나 알아볼 수 없게 답하면 같은 결과여야 한다.
const outage: [string, Answer][] = [
  ['network error', fails(new TypeError('fetch failed'))],
  ['timeout', fails(new DOMException('timed out', 'TimeoutError'))],
  ['500', status(500)],
  ['200 that is not JSON', () => new Response('<html>')],
]

const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString())

const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url === SUPABASE_USER_URL) return Promise.resolve().then(() => supabaseAnswer())
  if (url.includes('/git/trees/')) return Promise.resolve().then(() => treeAnswer())
  if (url.startsWith('https://api.github.com/repos/')) return Promise.resolve().then(() => githubAnswer())
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})
let app: INestApplication<App>

beforeEach(async () => {
  supabaseAnswer = linkedUser()
  githubAnswer = repoOwnedBy(Number(GITHUB_ID))
  treeAnswer = treeOf([])
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  app = await startApp()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// auth: 생략하면 올바른 토큰, null이면 헤더 없음. body가 문자열이면 그대로 보낸다.
async function post(path: string, body?: string | object, auth?: string | null) {
  const authorization = auth === undefined ? `Bearer ${await token()}` : auth
  return request(app.getHttpServer())
    .post(path)
    .set(authorization === null ? {} : { Authorization: authorization })
    .set('Content-Type', 'application/json')
    .send(body)
}

const check = (body?: string | object, auth?: string | null) => post('/api/repos/check', body, auth)
const dockerfiles = (body?: string | object, auth?: string | null) => post('/api/repos/dockerfiles', body, auth)

const callsTo = (prefix: string) => fetchMock.mock.calls.filter(([url]) => urlOf(url).startsWith(prefix))

describe('POST /api/repos/check passes', () => {
  it('for a public personal repo owned by the linked GitHub account', async () => {
    const res = await check(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ repo: 'Student/My-App' })
  })

  it('asks Supabase with the user token and the public key, and GitHub without any credential', async () => {
    const t = await token()
    await check(VALID, `Bearer ${t}`)

    const [, supabaseInit] = callsTo(SUPABASE_USER_URL)[0]
    expect(supabaseInit?.headers).toEqual({ Authorization: `Bearer ${t}`, apikey: API_KEY })
    expect(supabaseInit?.signal).toBeInstanceOf(AbortSignal)

    const github = callsTo('https://api.github.com/')
    expect(github).toHaveLength(1)
    const [githubUrl, githubInit] = github[0]
    expect(urlOf(githubUrl)).toBe('https://api.github.com/repos/student/my-app')
    expect(JSON.stringify(githubInit?.headers).toLowerCase()).not.toContain('authorization')
    expect(JSON.stringify(github)).not.toContain(t)
    expect(githubInit?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('POST /api/repos/check rejects', () => {
  it('a GitHub account that is not linked (403 GITHUB_NOT_LINKED)', async () => {
    supabaseAnswer = emailOnlyUser
    const res = await check(VALID)
    expect(res.status).toBe(403)
    expect(res.body).toEqual(errorBody('GITHUB_NOT_LINKED'))
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })

  it('a repo owned by another GitHub account, compared by numeric ID, not name (403 REPO_NOT_OWNED)', async () => {
    // repoOwnedBy의 login도 student지만 ID는 연동한 계정(4242)과 다르다. 이름을 넘겨받은 다른 사람이다.
    githubAnswer = repoOwnedBy(1)
    const res = await check(VALID)
    expect(res.status).toBe(403)
    expect(res.body).toEqual(errorBody('REPO_NOT_OWNED'))
  })

  it('a repo owned by an organization, even for a member (422 REPO_NOT_PERSONAL)', async () => {
    githubAnswer = repoOwnedBy(Number(GITHUB_ID), 'Organization')
    const res = await check(VALID)
    expect(res.status).toBe(422)
    expect(res.body).toEqual(errorBody('REPO_NOT_PERSONAL'))
  })

  it('a missing or private repo (404 REPO_NOT_FOUND)', async () => {
    githubAnswer = status(404)
    const res = await check(VALID)
    expect(res.status).toBe(404)
    expect(res.body).toEqual(errorBody('REPO_NOT_FOUND'))
  })

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['a JSON array', [REPO_URL]],
    ['a number', { repoUrl: 123 }],
    ['another host', { repoUrl: 'https://gitlab.com/student/my-app' }],
    ['a host that only starts with github.com', { repoUrl: 'https://github.com.evil.io/student/my-app' }],
    ['a deeper path', { repoUrl: 'https://github.com/student/my-app/tree/main' }],
  ])('%s (400 INVALID_REPO_URL) before calling anyone', async (_, body) => {
    const res = await check(body)
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_REPO_URL'))
    expect(callsTo(SUPABASE_USER_URL)).toHaveLength(0)
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })

  it('a body that is not JSON (400, not a server error)', async () => {
    const res = await check('{"repoUrl":')
    expect(res.status).toBe(400)
  })

  it.each([
    ['no token', null, 'AUTH_REQUIRED'],
    ['a token that fails the login check', 'Bearer garbage', 'INVALID_TOKEN'],
  ])('%s (401) without asking Supabase or GitHub', async (_, auth, code) => {
    const res = await check(VALID, auth)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody(code))
    expect(callsTo(SUPABASE_USER_URL)).toHaveLength(0)
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })

  it('a session Supabase refuses (it answers 403) (401 INVALID_TOKEN)', async () => {
    supabaseAnswer = status(403)
    const res = await check(VALID)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody('INVALID_TOKEN'))
  })
})

describe('POST /api/repos/check when an outside service is not working (503, never a user error)', () => {
  it('Supabase refusing our public key (401) is not the user\'s fault: 503, and it is logged', async () => {
    supabaseAnswer = status(401)
    const res = await check(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('AUTH_UNAVAILABLE'))
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('401'))
  })

  it.each<[string, Answer]>([
    ...outage,
    ['429', status(429)],
    ['500 with a body that looks fine', () => Response.json({ identities: [{ provider: 'github', id: GITHUB_ID }] }, { status: 500 })],
    ['200 without identities', () => Response.json({ id: 'x' })],
    ['a github identity without a string id', () => Response.json({ identities: [{ provider: 'github', id: 7 }] })],
  ])('Supabase: %s → AUTH_UNAVAILABLE', async (_, answer) => {
    supabaseAnswer = answer
    const res = await check(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('AUTH_UNAVAILABLE'))
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })

  it.each<[string, Answer]>([
    ...outage,
    ['rate limit 403', status(403)],
    ['rate limit 429', status(429)],
    ['403 with a body that looks fine', () => Response.json({ full_name: 'student/my-app', owner: { id: Number(GITHUB_ID), type: 'User' } }, { status: 403 })],
    ['200 without an owner', () => Response.json({ full_name: 'student/my-app' })],
  ])('GitHub: %s → GITHUB_UNAVAILABLE', async (_, answer) => {
    githubAnswer = answer
    const res = await check(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
  })
})

describe('POST /api/repos/dockerfiles finds Dockerfiles', () => {
  it('at the repo root', async () => {
    treeAnswer = treeOf(['Dockerfile', 'package.json', 'src/', 'src/index.ts'])
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ repo: 'Student/My-App', dockerfiles: ['Dockerfile'], truncated: false })
  })

  it('in every sub folder, in the order GitHub lists them', async () => {
    treeAnswer = treeOf(['BE/', 'BE/Dockerfile', 'FE/', 'FE/web/', 'FE/web/Dockerfile'])
    const res = await dockerfiles(VALID)
    expect(res.body).toEqual({ repo: 'Student/My-App', dockerfiles: ['BE/Dockerfile', 'FE/web/Dockerfile'], truncated: false })
  })

  it('answers 200 with an empty list when there is none (not an error)', async () => {
    treeAnswer = treeOf(['README.md', 'src/', 'src/index.ts'])
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ repo: 'Student/My-App', dockerfiles: [], truncated: false })
  })

  it.each(['Dockerfile.prod', 'api.Dockerfile', 'MyDockerfile', 'docs/Dockerfile.md', 'dockerfile', 'Dockerfile/'])(
    'does not count %s',
    async (path) => {
      treeAnswer = treeOf([path])
      const res = await dockerfiles(VALID)
      expect(res.body).toMatchObject({ dockerfiles: [] })
    },
  )

  it('does not count a folder named Dockerfile', async () => {
    treeAnswer = () => Response.json({ truncated: false, tree: [{ path: 'Dockerfile', type: 'tree' }, { path: 'Dockerfile/x', type: 'blob' }] })
    const res = await dockerfiles(VALID)
    expect(res.body).toMatchObject({ dockerfiles: [] })
  })

  it('passes truncated through so an empty list is not read as "none"', async () => {
    treeAnswer = treeOf(['a/Dockerfile'], true)
    const res = await dockerfiles(VALID)
    expect(res.body).toEqual({ repo: 'Student/My-App', dockerfiles: ['a/Dockerfile'], truncated: true })
  })

  it('reads the default branch of the repo, with no credential and a time limit', async () => {
    githubAnswer = () =>
      Response.json({ full_name: 'student/my-app', default_branch: 'release/v 1', owner: { id: Number(GITHUB_ID), type: 'User' } })
    const t = await token()
    await dockerfiles(VALID, `Bearer ${t}`)

    const github = callsTo('https://api.github.com/')
    expect(github).toHaveLength(2)
    const [treeUrl, treeInit] = github[1]
    expect(urlOf(treeUrl)).toBe('https://api.github.com/repos/student/my-app/git/trees/release/v%201?recursive=1')
    expect(JSON.stringify(treeInit?.headers).toLowerCase()).not.toContain('authorization')
    expect(JSON.stringify(github)).not.toContain(t)
    expect(treeInit?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('POST /api/repos/dockerfiles checks ownership first (same errors as /repos/check)', () => {
  const noTreeCall = () => expect(callsTo('https://api.github.com/').filter(([url]) => urlOf(url).includes('/git/trees/'))).toHaveLength(0)

  it.each([
    ['a repo owned by another account', () => (githubAnswer = repoOwnedBy(1)), 403, 'REPO_NOT_OWNED'],
    ['an organization repo', () => (githubAnswer = repoOwnedBy(Number(GITHUB_ID), 'Organization')), 422, 'REPO_NOT_PERSONAL'],
    ['a missing or private repo', () => (githubAnswer = status(404)), 404, 'REPO_NOT_FOUND'],
    ['an account without GitHub linked', () => (supabaseAnswer = emailOnlyUser), 403, 'GITHUB_NOT_LINKED'],
  ])('%s never reaches the file list', async (_, arrange, code, errorCode) => {
    arrange()
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(code)
    expect(res.body).toEqual(errorBody(errorCode))
    noTreeCall()
  })

  it('a bad repo address (400 INVALID_REPO_URL) before calling anyone', async () => {
    const res = await dockerfiles({ repoUrl: 'https://github.com/student/my-app/tree/main' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_REPO_URL'))
    expect(callsTo(SUPABASE_USER_URL)).toHaveLength(0)
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })

  it('no token (401 AUTH_REQUIRED) without asking anyone', async () => {
    const res = await dockerfiles(VALID, null)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
  })
})

describe('POST /api/repos/dockerfiles when GitHub cannot give the file list (503, never a user error)', () => {
  it.each<[string, Answer]>([
    ...outage,
    ['404', status(404)],
    ['rate limit 403', status(403)],
    ['rate limit 429', status(429)],
    ['403 with a body that looks fine', () => Response.json({ truncated: false, tree: [] }, { status: 403 })],
    ['200 without a tree', () => Response.json({ truncated: false })],
    ['200 without truncated', () => Response.json({ tree: [] })],
    ['200 with an entry without a path', () => Response.json({ truncated: false, tree: [{ type: 'blob' }] })],
  ])('tree: %s → GITHUB_UNAVAILABLE', async (_, answer) => {
    treeAnswer = answer
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
  })

  it.each<[string, unknown]>([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', 7],
  ])('a repo answer whose default_branch is %s → GITHUB_UNAVAILABLE, logged', async (_, branch) => {
    githubAnswer = () => Response.json({ full_name: 'student/my-app', default_branch: branch, owner: { id: Number(GITHUB_ID), type: 'User' } })
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('default_branch'))
    expect(callsTo('https://api.github.com/')).toHaveLength(1)
  })

  it('/repos/check does not need default_branch and does not call the file list', async () => {
    githubAnswer = () => Response.json({ full_name: 'student/my-app', owner: { id: Number(GITHUB_ID), type: 'User' } })
    const res = await check(VALID)
    expect(res.status).toBe(200)
    expect(callsTo('https://api.github.com/')).toHaveLength(1)
  })
})
