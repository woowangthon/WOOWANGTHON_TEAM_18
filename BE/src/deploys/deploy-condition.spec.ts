import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildInputHash, isImageDigest, targetSlot, validateServiceConditions } from './deploy-condition.js'
import type { Spec } from './deploy-input.js'

const TREE = '2d8b924e8a4f903f22ae8bd725b51596ab76af65'
const BLOB = 'f828b49b883d0e542c4165ae68e777f1710da4e1'
const HASH = `sha256:${'a'.repeat(64)}`
const IMAGE = `ghcr.io/woowang-bot/student-apps@sha256:${'b'.repeat(64)}`

type Build = Spec['services'][number]['build']
const viteBuild = (): Build => ({
  context: 'FE',
  dockerfile: null,
  framework: 'vite-react',
  nodeVersion: '22',
  install: 'pnpm install --frozen-lockfile',
  build: 'pnpm run build',
  start: null,
  outputDir: 'dist',
  buildEnv: { VITE_API_URL: '/api', VITE_MODE: 'prod' },
})
const dockerBuild = (): Build => ({
  context: '.',
  dockerfile: 'BE/Dockerfile',
  framework: null,
  nodeVersion: null,
  install: null,
  build: null,
  start: null,
  outputDir: null,
  buildEnv: {},
})

const spec = (...names: string[]) => ({ project: { slug: 'my-app', repo: 'student/my-app' }, services: names.map((name) => ({ name })) }) as Spec

describe('targetSlot', () => {
  it('takes the slot that is not live, and A on the first deploy', () => {
    expect(targetSlot(null)).toBe('a')
    expect(targetSlot('a')).toBe('b')
    expect(targetSlot('b')).toBe('a')
  })
})

describe('buildInputHash', () => {
  const source = { contextTree: TREE, dockerfileBlob: null }

  it('is sha256: and 64 hex chars over the sorted-key JSON of the inputs', () => {
    const build = viteBuild()
    // 키를 정렬한 JSON을 손으로 적는다. 해시 재료를 바꾸면 이 테스트가 깨져야 한다.
    const json =
      `{"build":{"build":"pnpm run build","buildEnv":{"VITE_API_URL":"/api","VITE_MODE":"prod"},"context":"FE","dockerfile":null,` +
      `"framework":"vite-react","install":"pnpm install --frozen-lockfile","nodeVersion":"22","outputDir":"dist","start":null},` +
      `"contextTree":"${TREE}","defaultDockerfile":"vite-react@1","dockerfileBlob":null}`
    expect(buildInputHash(build, source)).toBe(`sha256:${createHash('sha256').update(json).digest('hex')}`)
  })

  it('does not depend on key order', () => {
    const build = viteBuild()
    const reordered = { ...build, buildEnv: { VITE_MODE: 'prod', VITE_API_URL: '/api' } }
    const reversed = Object.fromEntries(Object.entries(reordered).reverse()) as unknown as Build
    expect(buildInputHash(reversed, source)).toBe(buildInputHash(build, source))
  })

  it.each([
    ['the context tree', () => buildInputHash(viteBuild(), { contextTree: BLOB, dockerfileBlob: null })],
    ['a build value', () => buildInputHash({ ...viteBuild(), install: 'npm ci' }, source)],
    ['a build env value', () => buildInputHash({ ...viteBuild(), buildEnv: { VITE_API_URL: '/v2', VITE_MODE: 'prod' } }, source)],
    ['the framework (another default Dockerfile)', () => buildInputHash({ ...viteBuild(), framework: 'nextjs' }, source)],
  ])('changes with %s', (_, other) => {
    expect(other()).not.toBe(buildInputHash(viteBuild(), source))
  })

  it('uses the Dockerfile blob, and no default Dockerfile version, when the student has a Dockerfile', () => {
    const build = dockerBuild()
    const json =
      `{"build":{"build":null,"buildEnv":{},"context":".","dockerfile":"BE/Dockerfile","framework":null,"install":null,` +
      `"nodeVersion":null,"outputDir":null,"start":null},"contextTree":"${TREE}","defaultDockerfile":null,"dockerfileBlob":"${BLOB}"}`
    expect(buildInputHash(build, { contextTree: TREE, dockerfileBlob: BLOB })).toBe(`sha256:${createHash('sha256').update(json).digest('hex')}`)
    expect(buildInputHash(build, { contextTree: TREE, dockerfileBlob: TREE })).not.toBe(buildInputHash(build, { contextTree: TREE, dockerfileBlob: BLOB }))
  })
})

describe('isImageDigest', () => {
  it.each([
    [IMAGE, true],
    [`ghcr.io/woowang-bot/student-apps:my-app-fe-0123456789ab`, false],
    [`ghcr.io/woowang-bot/other@sha256:${'b'.repeat(64)}`, false],
    [`docker.io/woowang-bot/student-apps@sha256:${'b'.repeat(64)}`, false],
    [`ghcr.io/Woowang/student-apps@sha256:${'b'.repeat(64)}`, false],
    [`ghcr.io/-bot/student-apps@sha256:${'b'.repeat(64)}`, false],
    // GitHub 사용자 이름은 39자까지다.
    [`ghcr.io/${'a'.repeat(39)}/student-apps@sha256:${'b'.repeat(64)}`, true],
    [`ghcr.io/${'a'.repeat(40)}/student-apps@sha256:${'b'.repeat(64)}`, false],
    [`ghcr.io/woowang-bot/student-apps@sha256:${'b'.repeat(63)}`, false],
    [`${IMAGE}\n`, false],
    [null, false],
  ])('%s → %s', (value, ok) => {
    expect(isImageDigest(value)).toBe(ok)
  })
})

describe('validateServiceConditions', () => {
  const two = spec('fe', 'be')

  it('accepts a run without an image and a reuse with one', () => {
    expect(
      validateServiceConditions(two, {
        fe: { buildInputHash: HASH, build: 'reuse', image: IMAGE },
        be: { buildInputHash: HASH, build: 'run', image: null },
      }),
    ).toEqual([])
  })

  it('wants exactly the service names of the spec as keys', () => {
    expect(validateServiceConditions(two, { fe: { buildInputHash: HASH, build: 'run', image: null }, ai: {} })).toEqual([
      { path: 'deploy_condition.services.be', code: 'REQUIRED' },
      { path: 'deploy_condition.services.ai', code: 'UNKNOWN_SERVICE' },
    ])
  })

  it.each([
    ['null', null],
    ['an array', []],
  ])('rejects services that are %s', (_, services) => {
    expect(validateServiceConditions(two, services)).toEqual([{ path: 'deploy_condition.services', code: 'INVALID_TYPE' }])
  })

  it.each([
    ['a service that is not an object', 'x', [{ path: '.fe', code: 'INVALID_TYPE' }]],
    ['an unknown key', { buildInputHash: HASH, build: 'run', image: null, tag: 't' }, [{ path: '.fe.tag', code: 'UNKNOWN_KEY' }]],
    ['a hash without the sha256: prefix', { buildInputHash: 'a'.repeat(64), build: 'run', image: null }, [{ path: '.fe.buildInputHash', code: 'INVALID_VALUE' }]],
    ['a missing hash', { build: 'run', image: null }, [{ path: '.fe.buildInputHash', code: 'INVALID_VALUE' }]],
    ['a reuse without an image', { buildInputHash: HASH, build: 'reuse', image: null }, [{ path: '.fe.image', code: 'REQUIRED' }]],
    ['a reuse with the image key missing', { buildInputHash: HASH, build: 'reuse' }, [{ path: '.fe.image', code: 'REQUIRED' }]],
    ['a reuse with a tag, not a digest', { buildInputHash: HASH, build: 'reuse', image: 'ghcr.io/b/student-apps:t' }, [{ path: '.fe.image', code: 'INVALID_VALUE' }]],
    ['a run that already has an image', { buildInputHash: HASH, build: 'run', image: IMAGE }, [{ path: '.fe.image', code: 'MUST_BE_NULL' }]],
    ['a run with the image key missing', { buildInputHash: HASH, build: 'run' }, [{ path: '.fe.image', code: 'MUST_BE_NULL' }]],
    ['an unknown build value', { buildInputHash: HASH, build: 'skip', image: null }, [{ path: '.fe.build', code: 'INVALID_VALUE' }]],
  ])('reports %s', (_, fe, expected) => {
    expect(validateServiceConditions(spec('fe'), { fe })).toEqual(expected.map((i) => ({ ...i, path: `deploy_condition.services${i.path}` })))
  })
})
