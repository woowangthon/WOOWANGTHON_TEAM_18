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
const FULL_NAME = 'Student/My-App'
const REPO_URL = 'https://github.com/student/my-app'
const VALID = { repoUrl: REPO_URL }

// 테스트마다 바꿔 끼우는 외부 서비스의 답. 기본값은 "연동한 학생이 자기 개인 레포를 낸다"이다.
type Answer = () => Response
let supabaseAnswer: Answer
let githubAnswer: Answer
let treeAnswer: Answer
// raw.githubusercontent.com의 package.json 답. 키는 레포 루트 기준 경로이고, 정하지 않은 경로를 읽으려 하면 테스트가 실패한다.
type RawAnswer = () => Response | Promise<Response>
let rawFiles: Record<string, RawAnswer | object>
let logError: MockInstance<Logger['error']>

const linkedUser = (id = GITHUB_ID): Answer => () =>
  Response.json({ identities: [{ provider: 'email', id: 'user-1' }, { provider: 'github', id }] })
const emailOnlyUser: Answer = () => Response.json({ identities: [{ provider: 'email', id: 'user-1' }] })
const repoOwnedBy = (id: number | string, type = 'User'): Answer => () =>
  Response.json({ full_name: FULL_NAME, private: false, owner: { login: 'student', id, type } })
// 끝에 /가 붙은 이름은 폴더다. GitHub는 폴더 항목의 path에 /를 붙이지 않고 type만 tree로 표시한다.
const treeOf = (paths: string[], truncated = false): Answer => () =>
  Response.json({
    sha: 'abc',
    truncated,
    tree: paths.map((p) => (p.endsWith('/') ? { path: p.slice(0, -1), type: 'tree' } : { path: p, type: 'blob' })),
  })
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

const RAW_PREFIX = 'https://raw.githubusercontent.com/student/my-app/HEAD/'

const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString())

const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = urlOf(input)
  if (url === JWKS_URL) return Promise.resolve(Response.json(keySet))
  if (url === SUPABASE_USER_URL) return Promise.resolve().then(() => supabaseAnswer())
  if (url.includes('/git/trees/')) return Promise.resolve().then(() => treeAnswer())
  if (url.startsWith('https://api.github.com/repos/')) return Promise.resolve().then(() => githubAnswer())
  if (url.startsWith(RAW_PREFIX)) {
    const answer = rawFiles[decodeURIComponent(url.slice(RAW_PREFIX.length))]
    if (answer === undefined) return Promise.reject(new Error(`unexpected raw fetch ${url}`))
    return Promise.resolve().then(() => (typeof answer === 'function' ? answer() : Response.json(answer)))
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`))
})
let app: INestApplication<App>

beforeEach(async () => {
  supabaseAnswer = linkedUser()
  githubAnswer = repoOwnedBy(Number(GITHUB_ID))
  treeAnswer = treeOf([])
  rawFiles = {}
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
const deploySpec = (body?: string | object, auth?: string | null) => post('/api/repos/deploy-spec', body, auth)

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
  it.each<[string, Answer, string[], boolean]>([
    ['at the repo root', treeOf(['Dockerfile', 'package.json', 'src/', 'src/index.ts']), ['Dockerfile'], false],
    ['in every sub folder, in the order GitHub lists them', treeOf(['BE/', 'BE/Dockerfile', 'FE/', 'FE/web/', 'FE/web/Dockerfile']), ['BE/Dockerfile', 'FE/web/Dockerfile'], false],
    ['none: 200 with an empty list, not an error', treeOf(['README.md', 'src/', 'src/index.ts']), [], false],
    ['passes truncated through so an empty list is not read as "none"', treeOf(['a/Dockerfile'], true), ['a/Dockerfile'], true],
    ['a repo with no commits (GitHub says 409): 200 with an empty list', status(409), [], false],
  ])('%s', async (_, answer, found, truncated) => {
    treeAnswer = answer
    const res = await dockerfiles(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ repo: FULL_NAME, dockerfiles: found, truncated })
  })

  // 'Dockerfile/'은 이름이 Dockerfile인 폴더(type tree)다. 파일이 아니므로 세지 않는다.
  it.each(['Dockerfile.prod', 'api.Dockerfile', 'MyDockerfile', 'docs/Dockerfile.md', 'dockerfile', 'Dockerfile/'])(
    'does not count %s',
    async (path) => {
      treeAnswer = treeOf([path])
      const res = await dockerfiles(VALID)
      expect(res.body).toMatchObject({ dockerfiles: [] })
    },
  )

  it('reads the default branch (HEAD) of the repo, with no credential and a time limit', async () => {
    const t = await token()
    await dockerfiles(VALID, `Bearer ${t}`)

    const github = callsTo('https://api.github.com/')
    expect(github).toHaveLength(2)
    const [treeUrl, treeInit] = github[1]
    expect(urlOf(treeUrl)).toBe('https://api.github.com/repos/student/my-app/git/trees/HEAD?recursive=1')
    expect(JSON.stringify(treeInit?.headers).toLowerCase()).not.toContain('authorization')
    expect(JSON.stringify(github)).not.toContain(t)
    expect(treeInit?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('POST /api/repos/dockerfiles checks ownership first (same errors as /repos/check)', () => {
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
    expect(callsTo('https://api.github.com/').filter(([url]) => urlOf(url).includes('/git/trees/'))).toHaveLength(0)
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

  it('/repos/check does not call the file list', async () => {
    const res = await check(VALID)
    expect(res.status).toBe(200)
    expect(callsTo('https://api.github.com/')).toHaveLength(1)
  })
})

// 실제 Vite 템플릿(react-ts)과 Nest 앱의 모양을 따른다.
const VITE_PKG = {
  scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
  dependencies: { react: '^19.3.1', 'react-dom': '^19.3.1' },
  devDependencies: { typescript: '~7.0.2', vite: '^8.3.6' },
  engines: { node: '>=22' },
}
const NEST_PKG = {
  scripts: { build: 'nest build', start: 'node dist/main' },
  dependencies: { '@nestjs/core': '^12.0.0' },
  devDependencies: { typescript: '^6.0.0' },
}
const RAW = 'https://raw.githubusercontent.com/'
const rawCalls = () => callsTo(RAW)
const treeCalls = () => callsTo('https://api.github.com/').filter(([url]) => urlOf(url).includes('/git/trees/'))

describe('POST /api/repos/deploy-spec drafts the deploy spec', () => {
  it('answers each folder of a monorepo from its package.json, lock file and Dockerfile', async () => {
    treeAnswer = treeOf(['FE/', 'FE/package.json', 'FE/pnpm-lock.yaml', 'FE/Dockerfile', 'BE/', 'BE/package.json', 'BE/pnpm-lock.yaml', 'BE/Dockerfile', 'README.md'])
    rawFiles = { 'FE/package.json': VITE_PKG, 'BE/package.json': NEST_PKG }
    const res = await deploySpec(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      repo: FULL_NAME,
      truncated: false,
      projects: [
        {
          dir: 'BE',
          framework: { value: null, source: null },
          language: { value: 'typescript', source: 'package.json' },
          packageManager: { value: 'pnpm', source: 'lockfile' },
          install: { value: 'pnpm install --frozen-lockfile', source: 'lockfile' },
          build: { value: 'pnpm run build', script: 'nest build', source: 'package.json' },
          start: { value: 'pnpm run start', script: 'node dist/main', source: 'package.json' },
          outputDir: { value: null, source: null },
          port: { value: null, source: null },
          nodeVersion: null,
          lockfile: 'BE/pnpm-lock.yaml',
          dockerfile: true,
          needsReview: ['framework', 'outputDir', 'port'],
        },
        {
          dir: 'FE',
          framework: { value: 'vite-react', source: 'package.json' },
          language: { value: 'typescript', source: 'package.json' },
          packageManager: { value: 'pnpm', source: 'lockfile' },
          install: { value: 'pnpm install --frozen-lockfile', source: 'lockfile' },
          build: { value: 'pnpm run build', script: 'tsc -b && vite build', source: 'package.json' },
          start: { value: null, script: null, source: null },
          outputDir: { value: 'dist', source: 'default' },
          port: { value: null, source: null },
          nodeVersion: '>=22',
          lockfile: 'FE/pnpm-lock.yaml',
          dockerfile: true,
          needsReview: [],
        },
      ],
    })
  })

  it('uses a lock file kept at the repo root for a workspace package, and leaves the workspace root out', async () => {
    treeAnswer = treeOf(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/', 'apps/web/', 'apps/web/package.json'])
    rawFiles = { 'package.json': { private: true, devDependencies: { typescript: '5' } }, 'apps/web/package.json': VITE_PKG }
    const res = await deploySpec(VALID)
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.projects[0]).toMatchObject({ dir: 'apps/web', lockfile: 'pnpm-lock.yaml', install: { value: 'pnpm install --frozen-lockfile', source: 'lockfile' } })
  })

  it.each<[string, Answer]>([
    ['no package.json anywhere: 200 with an empty list, not an error', treeOf(['main.py', 'requirements.txt'])],
    ['a repo with no commits (GitHub says 409)', status(409)],
  ])('%s', async (_, answer) => {
    treeAnswer = answer
    const res = await deploySpec(VALID)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ repo: FULL_NAME, projects: [], truncated: false })
    expect(rawCalls()).toHaveLength(0)
  })

  it('passes the file list cut by GitHub through as truncated', async () => {
    treeAnswer = treeOf(['package.json'], true)
    rawFiles = { 'package.json': VITE_PKG }
    const res = await deploySpec(VALID)
    expect(res.body).toMatchObject({ truncated: true, projects: [{ dir: '.' }] })
  })

  it('reads at most 10 package.json (shallowest first) and says the list is cut', async () => {
    const dirs = Array.from({ length: 11 }, (_, i) => `p${String(i).padStart(2, '0')}`)
    treeAnswer = treeOf(dirs.flatMap((d) => [`${d}/`, `${d}/package.json`]))
    rawFiles = Object.fromEntries(dirs.map((d) => [`${d}/package.json`, {}]))
    const res = await deploySpec(VALID)
    expect(res.status).toBe(200)
    expect(res.body.truncated).toBe(true)
    expect(res.body.projects.map((p: { dir: string }) => p.dir)).toEqual(dirs.slice(0, 10))
    expect(rawCalls()).toHaveLength(10)
  })

  it('never reads a package.json inside node_modules or one that is a folder', async () => {
    treeAnswer = treeOf(['package.json', 'node_modules/', 'node_modules/react/', 'node_modules/react/package.json', 'docs/', 'docs/package.json/'])
    rawFiles = { 'package.json': VITE_PKG }
    const res = await deploySpec(VALID)
    expect(res.body.projects).toHaveLength(1)
    expect(rawCalls()).toHaveLength(1)
  })

  it('names the folder only as GitHub spells it, percent-encoded per path segment', async () => {
    treeAnswer = treeOf(['my app/#frag/한글/package.json'])
    rawFiles = { 'my app/#frag/한글/package.json': VITE_PKG }
    const res = await deploySpec(VALID)
    expect(res.body.projects[0]).toMatchObject({ dir: 'my app/#frag/한글' })
    expect(urlOf(rawCalls()[0][0])).toBe(`${RAW_PREFIX}my%20app/%23frag/%ED%95%9C%EA%B8%80/package.json`)
  })

  it('starts all the reads at once, not one after another', async () => {
    treeAnswer = treeOf(['a/package.json', 'b/package.json', 'c/package.json'])
    let release: () => void
    const all = new Promise<void>((resolve) => (release = resolve))
    const gate: RawAnswer = () => {
      if (rawCalls().length === 3) release()
      return all.then(() => Response.json({}))
    }
    rawFiles = { 'a/package.json': gate, 'b/package.json': gate, 'c/package.json': gate }
    const res = await deploySpec(VALID)
    expect(res.status).toBe(200)
    expect(res.body.projects).toHaveLength(3)
  })

  it('asks GitHub for the API twice only and reads files without any credential and with a time limit', async () => {
    const t = await token()
    treeAnswer = treeOf(['FE/package.json', 'BE/package.json'])
    rawFiles = { 'FE/package.json': VITE_PKG, 'BE/package.json': NEST_PKG }
    await deploySpec(VALID, `Bearer ${t}`)

    expect(callsTo('https://api.github.com/')).toHaveLength(2)
    expect(rawCalls().map(([url]) => urlOf(url)).sort()).toEqual([`${RAW_PREFIX}BE/package.json`, `${RAW_PREFIX}FE/package.json`])
    for (const [, init] of rawCalls()) {
      expect(JSON.stringify(init?.headers).toLowerCase()).not.toContain('authorization')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(JSON.stringify(rawCalls())).not.toContain(t)
  })

  describe('a package.json that is gone or not a JSON object leaves that folder open for the student', () => {
    it.each<[string, RawAnswer | object]>([
      ['gone by now (404)', () => new Response('404: Not Found', { status: 404 })],
      ['200 that is not JSON', () => new Response('<html>')],
      ['a JSON array', []],
      ['a JSON string', () => Response.json('hello')],
    ])('%s', async (_, answer) => {
      treeAnswer = treeOf(['FE/package.json', 'FE/yarn.lock', 'FE/Dockerfile', 'BE/package.json'])
      rawFiles = { 'FE/package.json': answer, 'BE/package.json': NEST_PKG }
      const res = await deploySpec(VALID)
      expect(res.status).toBe(200)
      expect(res.body.projects).toEqual([
        expect.objectContaining({ dir: 'BE', language: { value: 'typescript', source: 'package.json' } }),
        // 락 파일과 Dockerfile은 package.json 없이도 안다.
        expect.objectContaining({
          dir: 'FE',
          framework: { value: null, source: null },
          language: { value: null, source: null },
          packageManager: { value: 'yarn', source: 'lockfile' },
          dockerfile: true,
        }),
      ])
    })
  })
})

describe('POST /api/repos/deploy-spec checks ownership first (same errors as /repos/check)', () => {
  it.each([
    ['a repo owned by another account', () => (githubAnswer = repoOwnedBy(1)), 403, 'REPO_NOT_OWNED'],
    ['an organization repo', () => (githubAnswer = repoOwnedBy(Number(GITHUB_ID), 'Organization')), 422, 'REPO_NOT_PERSONAL'],
    ['a missing or private repo', () => (githubAnswer = status(404)), 404, 'REPO_NOT_FOUND'],
    ['an account without GitHub linked', () => (supabaseAnswer = emailOnlyUser), 403, 'GITHUB_NOT_LINKED'],
  ])('%s never reaches the file list or any file', async (_, arrange, code, errorCode) => {
    treeAnswer = treeOf(['package.json'])
    rawFiles = { 'package.json': VITE_PKG }
    arrange()
    const res = await deploySpec(VALID)
    expect(res.status).toBe(code)
    expect(res.body).toEqual(errorBody(errorCode))
    expect(treeCalls()).toHaveLength(0)
    expect(rawCalls()).toHaveLength(0)
  })

  it('a bad repo address (400 INVALID_REPO_URL) before calling anyone', async () => {
    const res = await deploySpec({ repoUrl: 'https://github.com/student/my-app/tree/main' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual(errorBody('INVALID_REPO_URL'))
    expect(fetchMock.mock.calls.filter(([url]) => urlOf(url) !== JWKS_URL)).toHaveLength(0)
  })

  it('no token (401 AUTH_REQUIRED) without asking anyone', async () => {
    const res = await deploySpec(VALID, null)
    expect(res.status).toBe(401)
    expect(res.body).toEqual(errorBody('AUTH_REQUIRED'))
    expect(callsTo('https://api.github.com/')).toHaveLength(0)
    expect(rawCalls()).toHaveLength(0)
  })
})

describe('POST /api/repos/deploy-spec when GitHub cannot give a file (503, never a user error)', () => {
  it.each<[string, Answer]>([...outage, ['404', status(404)], ['rate limit 403', status(403)], ['rate limit 429', status(429)], ['200 without a tree', () => Response.json({ truncated: false })]])(
    'file list: %s → GITHUB_UNAVAILABLE and no file is read',
    async (_, answer) => {
      treeAnswer = answer
      const res = await deploySpec(VALID)
      expect(res.status).toBe(503)
      expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
      expect(rawCalls()).toHaveLength(0)
    },
  )

  it.each<[string, RawAnswer]>([
    ['network error', fails(new TypeError('fetch failed'))],
    ['timeout', fails(new DOMException('timed out', 'TimeoutError'))],
    ['500', status(500)],
    ['rate limit 429', status(429)],
    ['403', status(403)],
    ['an error status with a body that looks fine', () => Response.json(VITE_PKG, { status: 502 })],
  ])('one package.json: %s → GITHUB_UNAVAILABLE (and it is logged)', async (_, answer) => {
    treeAnswer = treeOf(['FE/package.json', 'BE/package.json'])
    rawFiles = { 'FE/package.json': VITE_PKG, 'BE/package.json': answer }
    const res = await deploySpec(VALID)
    expect(res.status).toBe(503)
    expect(res.body).toEqual(errorBody('GITHUB_UNAVAILABLE'))
    expect(logError).toHaveBeenCalled()
  })

  it('/repos/check and /repos/dockerfiles never read a file', async () => {
    treeAnswer = treeOf(['Dockerfile', 'package.json'])
    expect((await check(VALID)).status).toBe(200)
    expect((await dockerfiles(VALID)).status).toBe(200)
    expect(rawCalls()).toHaveLength(0)
  })
})
