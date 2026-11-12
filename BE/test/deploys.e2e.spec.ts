import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { SecurityScanService } from '../src/security/security-scan.service.js'
import { errorBody, JWKS_URL, keySet, token } from './auth-helpers.js'
import { startApp } from './start-app.js'

// vitest.config.ts의 값과 같다.
const SUPABASE_USER_URL = 'https://test.supabase.co/auth/v1/user'
const REST_URL = 'https://test.supabase.co/rest/v1/deploys'
const SECRET_KEY = 'sb_secret_test'
const GITHUB_ID = '4242'
const FULL_NAME = 'Student/My-App'
const REPO_URL = 'https://github.com/student/my-app'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222'
// Postgres(PostgREST)가 주는 모양: 마이크로초와 +00:00.
const CREATED_AT = '2026-11-10T01:00:00.123456+00:00'

type Json = Record<string, unknown>
// docs/design/api.md의 예시와 같은 유효한 spec.
const spec = (): Json => ({
  project: { slug: 'my-app', repo: 'student/my-app' },
  services: [
    {
      name: 'fe',
      role: 'fe',
      dir: 'FE',
      build: {
        context: 'FE',
        dockerfile: null,
        framework: 'vite-react',
        nodeVersion: '22',
        install: 'pnpm install --frozen-lockfile',
        build: 'pnpm run build',
        start: null,
        outputDir: 'dist',
        buildEnv: { VITE_API_URL: '/api' },
      },
      runtime: {
        kind: 'static',
        port: 8080,
        health: { type: 'http', path: '/', startupTimeoutSeconds: 10 },
        env: {},
        secretKeys: [],
        links: [],
        ingressPath: '/',
        stripPrefix: false,
        resources: null,
      },
    },
    {
      name: 'be',
      role: 'be',
      dir: 'BE',
      build: {
        context: '.',
        dockerfile: 'BE/Dockerfile',
        framework: null,
        nodeVersion: null,
        install: null,
        build: null,
        start: null,
        outputDir: null,
        buildEnv: {},
      },
      runtime: {
        kind: 'server',
        port: 3000,
        health: { type: 'http', path: '/api/health', startupTimeoutSeconds: 60 },
        env: { NODE_ENV: 'production' },
        secretKeys: ['DATABASE_URL'],
        links: [],
        ingressPath: '/api',
        stripPrefix: false,
        resources: null,
      },
    },
  ],
})
const body = (extra: Json = {}): Json => ({ repoUrl: REPO_URL, commit: SHA, spec: spec(), ...extra })

interface Row {
  id: string
  user_id: string
  slug: string
  repo: string
  commit_sha: string
  spec: Json
  created_at: string
}

type Answer = () => Response
let supabaseAnswer: Answer
let githubAnswer: Answer
let commitAnswer: Answer
// 저장소(PostgREST)의 가짜. rows가 테이블이고, restFail에 든 메서드는 그 답을 대신 돌려준다.
let rows: Row[]
let restFail: Partial<Record<'GET' | 'POST', Answer>>
let logError: MockInstance<Logger['error']>

const linkedUser = (id = GITHUB_ID): Answer => () =>
  Response.json({ identities: [{ provider: 'email', id: 'user-1' }, { provider: 'github', id }] })
const repoOwnedBy = (id: number | string, type = 'User'): Answer => () =>
  Response.json({ full_name: FULL_NAME, private: false, owner: { login: 'student', id, type } })
const status = (code: number): Answer => () => new Response('{}', { status: code })
const fails = (err: Error): Answer => () => {
  throw err
}
const storedRow = (): Row => ({
  id: randomUUID(),
  user_id: USER_ID,
  slug: 'my-app',
  repo: FULL_NAME,
  commit_sha: SHA,
  spec: spec(),
  created_at: CREATED_AT,
})
// 어느 서비스든 닿지 못하거나 알아볼 수 없게 답하면 같은 결과여야 한다.
const outage: [string, Answer][] = [
  ['network error', fails(new TypeError('fetch failed'))],
  ['timeout', fails(new DOMException('timed out', 'TimeoutError'))],
  ['500', status(500)],
  ['401 (the key was refused)', status(401)],
  ['200 that is not JSON', () => new Response('<html>')],
  ['200 that is not a list', () => Response.json({ not: 'a list' })],
]

const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString())

function rest(url: URL, init: RequestInit | undefined): Response {
  const method = (init?.method ?? 'GET') as 'GET' | 'POST'
  const fail = restFail[method]
  if (fail) return fail()
  if (method === 'POST') {
    const row = { ...(JSON.parse(init?.body as string) as Json), id: randomUUID(), created_at: CREATED_AT } as Row
    rows.push(row)
    return Response.json([row], { status: 201 })
  }
  let result = rows
  for (const col of ['slug', 'id', 'user_id'] as const) {
    const value = url.searchParams.get(col)
    if (value === null) continue
    if (!value.startsWith('eq.')) throw new Error(`unexpected filter ${col}=${value}`)
    result = result.filter((r) => r[col] === value.slice(3))
  }
  return Response.json(result.slice(0, Number(url.searchParams.get('limit') ?? result.length)))
}

const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url === SUPABASE_USER_URL) return Promise.resolve().then(() => supabaseAnswer())
  if (url.startsWith(REST_URL)) return Promise.resolve().then(() => rest(new URL(url), init))
  if (url.includes('/commits/')) return Promise.resolve().then(() => commitAnswer())
  if (url.startsWith('https://api.github.com/repos/')) return Promise.resolve().then(() => githubAnswer())
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})
let app: INestApplication<App>

beforeEach(async () => {
  supabaseAnswer = linkedUser()
  githubAnswer = repoOwnedBy(Number(GITHUB_ID))
  commitAnswer = () => new Response(SHA, { headers: { 'content-type': 'application/vnd.github.sha' } })
  rows = []
  restFail = {}
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

// auth: 생략하면 USER_ID의 올바른 토큰, null이면 헤더 없음.
const bearer = async (sub = USER_ID) => `Bearer ${await token({ sub })}`
async function create(payload?: string | object, auth?: string | null) {
  const authorization = auth === undefined ? await bearer() : auth
  return request(app.getHttpServer())
    .post('/api/deploys')
    .set(authorization === null ? {} : { Authorization: authorization })
    .set('Content-Type', 'application/json')
    .send(payload)
}
async function read(path: string, auth?: string | null) {
  const authorization = auth === undefined ? await bearer() : auth
  return request(app.getHttpServer()).get(path).set(authorization === null ? {} : { Authorization: authorization })
}

const callsTo = (prefix: string) => fetchMock.mock.calls.filter(([url]) => urlOf(url).startsWith(prefix))
// 외부 서비스(Supabase 인증 · GitHub · 저장소)를 한 번도 부르지 않았다. 로그인 토큰의 공개 키 목록은 센다.
const noExternalCalls = () =>
  expect(fetchMock.mock.calls.map(([url]) => urlOf(url)).filter((u) => u !== JWKS_URL)).toEqual([])

describe('POST /api/deploys saves', () => {
  it('a validated spec for a repo the user owns and answers 201', async () => {
    const res = await create(body())
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      // GitHub가 돌려준 표기
      repo: FULL_NAME,
      commit: SHA,
      spec: spec(),
      // UTC ISO 8601
      createdAt: '2026-11-10T01:00:00.123Z',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: USER_ID, slug: 'my-app', repo: FULL_NAME, commit_sha: SHA, spec: spec() })
    expect((res.body as Json).id).toBe(rows[0].id)
  })

  it('writes with the server key alone, and the user token never reaches the database', async () => {
    const auth = await bearer()
    await create(body(), auth)

    const inserts = callsTo(REST_URL).filter(([, init]) => init?.method === 'POST')
    expect(inserts).toHaveLength(1)
    const [, init] = inserts[0]
    expect(init?.headers).toEqual({ apikey: SECRET_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    // 저장하는 칸은 다섯 개뿐이다.
    expect(Object.keys(JSON.parse(init?.body as string) as Json).sort()).toEqual(['commit_sha', 'repo', 'slug', 'spec', 'user_id'])
    for (const [, i] of callsTo(REST_URL)) expect(JSON.stringify(i)).not.toContain(auth.slice('Bearer '.length))
  })

  it('takes the owner from the token, not from the request body', async () => {
    const res = await create(body({ user_id: OTHER_USER_ID, id: 'x', created_at: 'x', repo: 'evil/evil', commit_sha: 'x' }))
    expect(res.status).toBe(201)
    expect(rows[0]).toMatchObject({ user_id: USER_ID, repo: FULL_NAME, commit_sha: SHA })
    expect(rows[0].id).not.toBe('x')
  })

  it('looks the slug up with an encoded, exact filter', async () => {
    await create(body())
    const lookups = callsTo(REST_URL).filter(([, init]) => init?.method === 'GET')
    expect(lookups).toHaveLength(1)
    const url = new URL(urlOf(lookups[0][0]))
    expect(url.searchParams.get('slug')).toBe('eq.my-app')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(url.searchParams.get('select')).toBe('user_id,repo')
  })

  it('again for the same user and repo, as a new deploy (nothing is overwritten)', async () => {
    const first = await create(body())
    const second = await create(body())
    expect(second.status).toBe(201)
    expect((second.body as Json).id).not.toBe((first.body as Json).id)
    expect(rows).toHaveLength(2)
  })

  it('a repo matched without regard to case (the spec says student/my-app, GitHub says Student/My-App)', async () => {
    const res = await create(body())
    expect((res.body as Json).repo).toBe('Student/My-App')
  })
  it('and asks for the security scan of the saved repo and commit without waiting for it (UC-10)', async () => {
    await app.close()
    const requestScan = vi.fn()
    app = await startApp([], (b) => b.overrideProvider(SecurityScanService).useValue({ request: requestScan }))
    const res = await create(body())
    expect(res.status).toBe(201)
    // GitHub가 돌려준 표기로, 저장한 뒤에 한 번.
    expect(requestScan).toHaveBeenCalledExactlyOnceWith(FULL_NAME, SHA)
  })
})

describe('POST /api/deploys refuses before any external call', () => {
  it('a repoUrl that is not a GitHub repo address', async () => {
    const res = await create(body({ repoUrl: 'https://example.com/a/b' }))
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_REPO_URL'))
    noExternalCalls()
  })

  it.each([
    ['missing', undefined],
    ['null (an empty repo has no commit to deploy)', null],
    ['a short SHA', '0123456'],
    ['upper case', SHA.toUpperCase()],
    ['a branch name', 'main'],
    ['with a space', ` ${SHA}`],
    ['a number', 7],
  ])('a commit that is %s', async (_name, commit) => {
    const res = await create({ repoUrl: REPO_URL, commit, spec: spec() })
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_COMMIT'))
    noExternalCalls()
  })

  it('a spec with invalid fields, and says which ones with a code each', async () => {
    const bad = spec()
    ;((bad.services as Json[])[1].runtime as Json).port = 0
    delete ((bad.services as Json[])[0].build as Json).install
    const res = await create({ repoUrl: REPO_URL, commit: SHA, spec: bad })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_SPEC',
        message: 'spec has invalid fields (first: services[0].build.install)',
        fields: [
          { path: 'services[0].build.install', code: 'REQUIRED' },
          { path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' },
        ],
      },
    })
    noExternalCalls()
  })

  it.each([undefined, null, 'spec', [], 7])('a spec that is not an object (%j)', async (value) => {
    const res = await create({ repoUrl: REPO_URL, commit: SHA, spec: value })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: { code: 'INVALID_SPEC', message: expect.any(String) as string, fields: [{ path: 'spec', code: 'INVALID_TYPE' }] } })
    noExternalCalls()
  })

  it('a body that is not an object', async () => {
    for (const payload of [undefined, '[]']) {
      const res = await create(payload)
      expect(res.status).toBe(400)
      expect(res.body).toEqual(errorBody('INVALID_REPO_URL'))
    }
    // JSON 본문 파서(엄격 모드)가 객체나 배열이 아닌 최상위 값을 먼저 거른다.
    const res = await create('"x"')
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('BAD_REQUEST'))
    noExternalCalls()
  })

  it('checks in the documented order: repoUrl, then commit, then spec', async () => {
    const bad = { repoUrl: 'nope', commit: 'nope', spec: 'nope' }
    expect((await create(bad)).body).toEqual(errorBody('INVALID_REPO_URL'))
    expect((await create({ ...bad, repoUrl: REPO_URL })).body).toEqual(errorBody('INVALID_COMMIT'))
    expect(((await create({ ...bad, repoUrl: REPO_URL, commit: SHA })).body as { error: { code: string } }).error.code).toBe('INVALID_SPEC')
  })

  it('a request body of more than 100 KB', async () => {
    const huge = body({ spec: { ...spec(), padding: 'A'.repeat(200_000) } })
    const res = await create(huge)
    expect(res.status).toBe(413)
    expect(res.body).toEqual(errorBody('PAYLOAD_TOO_LARGE'))
    noExternalCalls()
  })

  it('a request without a login token', async () => {
    const res = await create(body(), null)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
    expect(callsTo(REST_URL)).toHaveLength(0)
  })
})

describe('POST /api/deploys checks the repo and commit before touching the database', () => {
  it.each([
    ['a repo owned by another account', () => (githubAnswer = repoOwnedBy(1)), 403, 'REPO_NOT_OWNED'],
    ['an organization repo', () => (githubAnswer = repoOwnedBy(Number(GITHUB_ID), 'Organization')), 422, 'REPO_NOT_PERSONAL'],
    ['a missing or private repo', () => (githubAnswer = status(404)), 404, 'REPO_NOT_FOUND'],
    ['an account without GitHub linked', () => (supabaseAnswer = () => Response.json({ identities: [] })), 403, 'GITHUB_NOT_LINKED'],
    ['a commit that is not in the repo', () => (commitAnswer = status(422)), 404, 'COMMIT_NOT_FOUND'],
    ['a commit answered with another SHA', () => (commitAnswer = () => new Response('a'.repeat(40))), 404, 'COMMIT_NOT_FOUND'],
  ])('%s', async (_name, arrange, code, errorCode) => {
    arrange()
    const res = await create(body())
    expect(res.status).toBe(code)
    expect(res.body).toEqual(errorBody(errorCode))
    expect(callsTo(REST_URL)).toHaveLength(0)
  })

  it('a repo that is not the one the spec says', async () => {
    const other = spec()
    ;(other.project as Json).repo = 'student/other-app'
    const res = await create({ repoUrl: REPO_URL, commit: SHA, spec: other })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: { code: 'INVALID_SPEC', message: expect.any(String) as string, fields: [{ path: 'project.repo', code: 'MISMATCH' }] },
    })
    expect(callsTo(REST_URL)).toHaveLength(0)
  })

  it.each(outage)('GitHub answers with %s', async (_name, answer) => {
    githubAnswer = answer
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
    expect(callsTo(REST_URL)).toHaveLength(0)
  })
})

describe('POST /api/deploys and slugs', () => {
  const existing = (user_id: string, repo: string): Row => ({
    id: randomUUID(),
    user_id,
    slug: 'my-app',
    repo,
    commit_sha: SHA,
    spec: spec(),
    created_at: CREATED_AT,
  })

  it('refuses a slug another user already uses', async () => {
    rows.push(existing(OTHER_USER_ID, FULL_NAME))
    const res = await create(body())
    expect(res.status).toBe(409)
    expect(res.body).toEqual(errorBody('SLUG_TAKEN'))
    expect(rows).toHaveLength(1)
  })

  it('refuses a slug the same user uses for another repo', async () => {
    rows.push(existing(USER_ID, 'Student/Other-App'))
    const res = await create(body())
    expect(res.status).toBe(409)
    expect(res.body).toEqual(errorBody('SLUG_TAKEN'))
    expect(rows).toHaveLength(1)
  })

  it('treats the repo name of an earlier save as the same repo whatever its letter case', async () => {
    rows.push(existing(USER_ID, FULL_NAME.toLowerCase()))
    expect((await create(body())).status).toBe(201)
  })

  it('allows the same user to use the slug again for the same repo', async () => {
    rows.push(existing(USER_ID, FULL_NAME))
    expect((await create(body())).status).toBe(201)
    expect(rows).toHaveLength(2)
  })
})

describe('POST /api/deploys when the database cannot be used', () => {
  it.each(outage)('the slug lookup answers with %s', async (_name, answer) => {
    restFail.GET = answer
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    expect(rows).toHaveLength(0)
  })

  it.each(outage)('the insert answers with %s', async (_name, answer) => {
    restFail.POST = answer
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })

  it.each([
    ['an empty list', () => Response.json([], { status: 201 })],
    ['two rows that are deploys', () => Response.json([storedRow(), storedRow()], { status: 201 })],
    ['a row without a spec object', () => Response.json([{ ...storedRow(), spec: 'x' }], { status: 201 })],
    ['a row without created_at', () => Response.json([{ ...storedRow(), created_at: undefined }], { status: 201 })],
    ['a row that is not a deploy', () => Response.json([{ id: 1 }], { status: 201 })],
  ])('the insert answers with %s', async (_name, answer) => {
    restFail.POST = answer
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })

  it.each([
    ['without a user_id', { repo: FULL_NAME }],
    ['without a repo', { user_id: USER_ID }],
    ['with a repo that is not text', { user_id: USER_ID, repo: 5 }],
  ])('a slug lookup that answers with a row %s', async (_name, row) => {
    restFail.GET = () => Response.json([row])
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })

  it.each(['GET', 'POST'] as const)('an error status is an outage even when the %s body is a list', async (method) => {
    restFail[method] = () => new Response('[]', { status: 500 })
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
    expect(rows).toHaveLength(0)
    // 상태 코드는 로그에 남는다(본문은 남기지 않는다).
    expect(logError).toHaveBeenCalledWith(expect.stringContaining(`${method} /rest/v1/deploys answered 500`))
  })

  it('never puts the server key or the spec in a log or a response', async () => {
    restFail.POST = () => new Response(JSON.stringify({ message: `key ${SECRET_KEY} spec ${JSON.stringify(spec())}` }), { status: 500 })
    const res = await create(body())
    expect(JSON.stringify(res.body)).not.toContain(SECRET_KEY)
    expect(JSON.stringify(logError.mock.calls)).not.toContain(SECRET_KEY)
    expect(JSON.stringify(logError.mock.calls)).not.toContain('pnpm run build')
  })
})

describe('GET /api/deploys/:id', () => {
  async function saved(sub = USER_ID) {
    const res = await create(body(), await bearer(sub))
    return (res.body as { id: string }).id
  }

  it('returns the deploy to its owner in the same shape as the save', async () => {
    const id = await saved()
    const res = await read(`/api/deploys/${id}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id, repo: FULL_NAME, commit: SHA, spec: spec(), createdAt: '2026-11-10T01:00:00.123Z' })
  })

  it('asks for the id and the user together, so another user gets nothing', async () => {
    const id = await saved()
    fetchMock.mockClear()
    await read(`/api/deploys/${id}`)
    const [call] = callsTo(REST_URL)
    expect(call[1]?.method).toBe('GET')
    expect(call[1]?.headers).toEqual({ apikey: SECRET_KEY })
    const url = new URL(urlOf(call[0]))
    expect(url.searchParams.get('id')).toBe(`eq.${id}`)
    expect(url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`)
    expect(url.searchParams.get('limit')).toBe('1')
  })

  it('answers 404 for another user’s deploy, the same as for one that does not exist', async () => {
    const id = await saved(OTHER_USER_ID)
    const other = await read(`/api/deploys/${id}`)
    const missing = await read(`/api/deploys/${randomUUID()}`)
    expect(other.status).toBe(404)
    expect(other.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(other.body)
  })

  it('ignores a user_id in the query string', async () => {
    const id = await saved(OTHER_USER_ID)
    const res = await read(`/api/deploys/${id}?user_id=${OTHER_USER_ID}`)
    expect(res.status).toBe(404)
  })

  it('accepts an upper case id', async () => {
    const id = await saved()
    expect((await read(`/api/deploys/${id.toUpperCase()}`)).status).toBe(200)
  })

  it.each(['1', 'abc', '1; DROP TABLE deploys; --', 'eq.x&or=(user_id.neq.0)', 'x'.repeat(100), `${randomUUID()}x`, '..'])(
    'answers 404 without asking the database for the id "%s"',
    async (id) => {
      const res = await read(`/api/deploys/${encodeURIComponent(id)}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual(errorBody('DEPLOY_NOT_FOUND'))
      expect(callsTo(REST_URL)).toHaveLength(0)
    },
  )

  it.each(outage)('answers 503 when the database answers with %s', async (_name, answer) => {
    restFail.GET = answer
    const res = await read(`/api/deploys/${randomUUID()}`)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('DATABASE_UNAVAILABLE'))
  })

  it('answers 503 when the row is not a deploy', async () => {
    restFail.GET = () => Response.json([{ id: 1 }])
    const res = await read(`/api/deploys/${randomUUID()}`)
    expect(res.status).toBe(503)
  })

  it('needs a login token', async () => {
    const res = await read(`/api/deploys/${randomUUID()}`, null)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
    expect(callsTo(REST_URL)).toHaveLength(0)
  })
})
