import { HttpException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { ReposService } from '../repos/repos.service.js'
import { buildInputHash } from './deploy-condition.js'
import { DeployConditionService } from './deploy-condition.service.js'
import type { Spec } from './deploy-input.js'
import { DeployEvents } from './deploy-events.js'
import { DeploysStore } from './deploys.store.js'

const REST = 'https://test.supabase.co/rest/v1'
const SECRET_KEY = 'sb_secret_test'
const DEPLOY_ID = '6f1c0a52-3b7e-4a40-9a6c-2f5d8e1b7c90'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const ROOT_TREE = '483be3d9aaea957550069d6def67451446f66d24'
const FE_TREE = '1111111111111111111111111111111111111111'
const BE_DOCKERFILE = 'f828b49b883d0e542c4165ae68e777f1710da4e1'
const IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'c'.repeat(64)}`
const TREES_URL = `https://api.github.com/repos/Student/My-App/git/trees/${COMMIT}?recursive=1`
const COMMIT_URL = `https://api.github.com/repos/Student/My-App/git/commits/${COMMIT}`

// docs/design/deploy-handoff.md 예시의 FE(Dockerfile 없음, 컨텍스트 FE)와 BE(Dockerfile 있음, 컨텍스트 루트).
const spec = (): Spec =>
  ({
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
        runtime: {},
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
        runtime: {},
      },
    ],
  }) as unknown as Spec

const deployRow = () => ({
  id: DEPLOY_ID,
  user_id: '11111111-1111-4111-8111-111111111111',
  slug: 'my-app',
  repo: 'Student/My-App',
  commit_sha: COMMIT,
  spec: spec(),
  created_at: '2026-11-10T01:00:00.123456+00:00',
})

// GitHub가 실제로 주는 모양: 최상위 sha는 요청한 commit SHA이고, 폴더 항목은 type tree다.
const treeBody = (entries = [
  { path: 'BE', type: 'tree', sha: '2d8b924e8a4f903f22ae8bd725b51596ab76af65' },
  { path: 'BE/Dockerfile', type: 'blob', sha: BE_DOCKERFILE, size: 958 },
  { path: 'FE', type: 'tree', sha: FE_TREE },
  { path: 'FE/package.json', type: 'blob', sha: '2222222222222222222222222222222222222222', size: 400 },
], truncated = false) => ({ sha: COMMIT, tree: entries, truncated })

let deploys: () => Response
let projects: () => Response
let cache: (service: string) => Response
let trees: () => Response
let commit: () => Response

const urlOf = (input: string | URL | Request) => (input instanceof Request ? input.url : input.toString())
const fetchMock = vi.fn<typeof fetch>((input) => {
  const url = new URL(urlOf(input))
  const href = url.toString()
  if (href.startsWith(`${REST}/deploys?`)) return Promise.resolve(deploys())
  if (href.startsWith(`${REST}/projects?`)) return Promise.resolve(projects())
  if (href.startsWith(`${REST}/build_cache?`)) return Promise.resolve(cache(url.searchParams.get('service')!.slice(3)))
  if (href === TREES_URL) return Promise.resolve(trees())
  if (href === COMMIT_URL) return Promise.resolve(commit())
  return Promise.reject(new Error(`unexpected fetch ${href}`))
})

let service: DeployConditionService
let logError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  deploys = () => Response.json([deployRow()])
  projects = () => Response.json([])
  cache = () => Response.json([])
  trees = () => Response.json(treeBody())
  commit = () => Response.json({ sha: COMMIT, tree: { sha: ROOT_TREE } })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  const config = new ConfigService<Env, true>({
    PORT: 3000,
    CORS_ORIGINS: [],
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: SECRET_KEY,
  })
  service = new DeployConditionService(new ReposService(config), new DeploysStore(config, new DeployEvents()))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const calls = (prefix: string) => fetchMock.mock.calls.filter(([input]) => urlOf(input).startsWith(prefix))
const params = (prefix: string) => calls(prefix).map(([input]) => Object.fromEntries(new URL(urlOf(input)).searchParams))

const feHash = buildInputHash(spec().services[0].build, { contextTree: FE_TREE, dockerfileBlob: null })
const beHash = buildInputHash(spec().services[1].build, { contextTree: ROOT_TREE, dockerfileBlob: BE_DOCKERFILE })

async function failure(promise: Promise<unknown>) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(HttpException)
  const http = err as HttpException
  return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> }
}

describe('DeployConditionService.prepare', () => {
  it('builds the deploy input for slot A on the first deploy, with every service to run', async () => {
    const prepared = await service.prepare(DEPLOY_ID, 'sha256:secret')

    expect(prepared).toEqual({
      deployId: DEPLOY_ID,
      slot: 'a',
      input: {
        commitSha: COMMIT,
        deploy_condition: {
          secretHash: 'sha256:secret',
          services: {
            fe: { buildInputHash: feHash, build: 'run', image: null },
            be: { buildInputHash: beHash, build: 'run', image: null },
          },
        },
        spec: spec(),
      },
    })
    // 저장된 spec을 고치지 않고 그대로 넘긴다.
    expect(Object.keys(prepared.input.deploy_condition.services)).toEqual(['fe', 'be'])
  })

  it('reads the rows with the secret key, by id, slug and hash', async () => {
    await service.prepare(DEPLOY_ID, null)

    expect(params(`${REST}/deploys`)).toEqual([{ select: '*', id: `eq.${DEPLOY_ID}`, limit: '1' }])
    expect(params(`${REST}/projects`)).toEqual([{ select: 'live_slot', slug: 'eq.my-app', limit: '1' }])
    expect(params(`${REST}/build_cache`)).toEqual([
      { select: 'image', slug: 'eq.my-app', service: 'eq.fe', build_input_hash: `eq.${feHash}`, limit: '1' },
      { select: 'image', slug: 'eq.my-app', service: 'eq.be', build_input_hash: `eq.${beHash}`, limit: '1' },
    ])
    for (const [, init] of calls(REST)) expect(init?.headers).toEqual({ apikey: SECRET_KEY })
    // GitHub에는 키를 보내지 않는다.
    for (const [, init] of calls('https://api.github.com/')) expect(JSON.stringify(init?.headers)).not.toContain(SECRET_KEY)
  })

  it.each([
    ['a', 'b'],
    ['b', 'a'],
    [null, 'a'],
  ])('targets the other slot when live_slot is %s', async (live, target) => {
    projects = () => Response.json([{ live_slot: live }])
    expect((await service.prepare(DEPLOY_ID, null)).slot).toBe(target)
  })

  it('reuses the cached image of a service whose hash is in build_cache', async () => {
    cache = (svc) => Response.json(svc === 'fe' ? [{ image: IMAGE }] : [])
    const { services } = (await service.prepare(DEPLOY_ID, null)).input.deploy_condition
    expect(services.fe).toEqual({ buildInputHash: feHash, build: 'reuse', image: IMAGE })
    expect(services.be).toEqual({ buildInputHash: beHash, build: 'run', image: null })
  })

  it('uses the root tree of the commit, not the echoed sha, for context "."', async () => {
    await service.prepare(DEPLOY_ID, null)
    expect(calls(COMMIT_URL)).toHaveLength(1)
    expect(beHash).not.toBe(buildInputHash(spec().services[1].build, { contextTree: COMMIT, dockerfileBlob: BE_DOCKERFILE }))
  })

  it('skips the commit call when no service builds from the repo root', async () => {
    const row = deployRow()
    row.spec.services = [row.spec.services[0]]
    deploys = () => Response.json([row])
    await service.prepare(DEPLOY_ID, null)
    expect(calls(COMMIT_URL)).toHaveLength(0)
  })

  it('answers 404 DEPLOY_NOT_FOUND for an unknown deploy and reads nothing else', async () => {
    deploys = () => Response.json([])
    expect(await failure(service.prepare(DEPLOY_ID, null))).toEqual({ status: 404, body: { code: 'DEPLOY_NOT_FOUND', message: 'No such deploy' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the context folder is missing', [{ path: 'BE/Dockerfile', type: 'blob', sha: BE_DOCKERFILE }], 'FE', 'FE is not a folder in'],
    ['the context is a file, not a folder', [{ path: 'FE', type: 'blob', sha: FE_TREE }, { path: 'BE/Dockerfile', type: 'blob', sha: BE_DOCKERFILE }], 'FE', 'FE is not a folder in'],
    ['the Dockerfile is missing', [{ path: 'FE', type: 'tree', sha: FE_TREE }], 'BE/Dockerfile', 'BE/Dockerfile is not a file in'],
    ['the Dockerfile is a folder', [{ path: 'FE', type: 'tree', sha: FE_TREE }, { path: 'BE/Dockerfile', type: 'tree', sha: BE_DOCKERFILE }], 'BE/Dockerfile', 'BE/Dockerfile is not a file in'],
  ])('answers 422 BUILD_SOURCE_NOT_FOUND when %s', async (_, entries, path, message) => {
    trees = () => Response.json(treeBody(entries))
    expect(await failure(service.prepare(DEPLOY_ID, null))).toEqual({
      status: 422,
      body: { code: 'BUILD_SOURCE_NOT_FOUND', message: `${message} ${COMMIT}`, path },
    })
  })

  it('says the file list was truncated when a path is not found in it', async () => {
    trees = () => Response.json(treeBody([], true))
    const { body } = await failure(service.prepare(DEPLOY_ID, null))
    expect(body).toEqual({ code: 'BUILD_SOURCE_NOT_FOUND', message: `FE was not in the truncated file list of ${COMMIT}`, path: 'FE' })
  })

  it.each([
    ['the commit call fails', () => (commit = () => new Response('', { status: 500 }))],
    ['the commit has no tree sha', () => (commit = () => Response.json({ sha: COMMIT }))],
    ['the tree sha is not 40 hex chars', () => (commit = () => Response.json({ tree: { sha: 'HEAD' } }))],
    ['the tree call fails', () => (trees = () => new Response('', { status: 403 }))],
  ])('answers 503 GITHUB_UNAVAILABLE when %s', async (_, arrange) => {
    arrange()
    const { status, body } = await failure(service.prepare(DEPLOY_ID, null))
    expect({ status, code: body.code }).toEqual({ status: 503, code: 'GITHUB_UNAVAILABLE' })
  })

  it.each([
    ['projects answers an unknown slot', () => (projects = () => Response.json([{ live_slot: 'A' }])), 'projects'],
    ['projects answers a row without live_slot', () => (projects = () => Response.json([{}])), 'projects'],
    ['build_cache answers a tag, not a digest', () => (cache = () => Response.json([{ image: 'ghcr.io/b/student-apps:t' }])), 'build_cache'],
    ['build_cache fails', () => (cache = () => new Response('[]', { status: 500 })), 'build_cache'],
  ])('answers 503 DATABASE_UNAVAILABLE when %s', async (_, arrange, table) => {
    arrange()
    const { status, body } = await failure(service.prepare(DEPLOY_ID, null))
    expect({ status, code: body.code }).toEqual({ status: 503, code: 'DATABASE_UNAVAILABLE' })
    expect(logError).toHaveBeenCalledWith(expect.stringContaining(`/rest/v1/${table} answered`))
  })
})

describe('DeployConditionService.buildHash', () => {
  it('gives the same hash prepare gives for unchanged build settings, reading only that service\'s sources', async () => {
    expect(await service.buildHash('Student/My-App', COMMIT, spec().services[1].build)).toBe(beHash)
    expect(await service.buildHash('Student/My-App', COMMIT, spec().services[0].build)).toBe(feHash)
    expect(calls(`${REST}/`)).toHaveLength(0)
  })

  it('gives a new hash for changed build settings', async () => {
    const build = { ...spec().services[0].build, outputDir: 'build' }
    expect(await service.buildHash('Student/My-App', COMMIT, build)).toBe(buildInputHash(build, { contextTree: FE_TREE, dockerfileBlob: null }))
    expect(await service.buildHash('Student/My-App', COMMIT, build)).not.toBe(feHash)
  })

  it('answers 422 BUILD_SOURCE_NOT_FOUND for a patched context that is not in the commit', async () => {
    const build = { ...spec().services[0].build, context: 'web' }
    expect(await failure(service.buildHash('Student/My-App', COMMIT, build))).toMatchObject({ status: 422, body: { code: 'BUILD_SOURCE_NOT_FOUND', path: 'web' } })
  })
})
