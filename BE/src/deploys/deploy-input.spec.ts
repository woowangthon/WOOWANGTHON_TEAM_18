import { describe, expect, it } from 'vitest'
import { type Issue, type IssueCode, isRelativePath, MAX_ISSUES, validateSpec } from './deploy-input.js'

type Json = Record<string, unknown>
const REMOVE = Symbol('remove')

// docs/design/api.md의 예시와 같은 유효한 spec: 정적 FE(Dockerfile 없음)와 서버 BE(Dockerfile 있음).
const valid = (): Json => ({
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
        links: [{ env: 'FE_URL', service: 'fe' }],
        ingressPath: '/api',
        stripPrefix: false,
        resources: null,
      },
    },
  ],
})

// 유효한 spec에서 칸 몇 개를 바꾼다. 경로는 `services[1].runtime.port` 모양이고 REMOVE를 주면 키를 지운다.
function make(...changes: [string, unknown][]): Json {
  const spec = valid()
  for (const [path, value] of changes) {
    const keys = path.split(/[.[\]]+/).filter(Boolean)
    const last = keys.pop() as string
    let cur: Json = spec
    for (const k of keys) cur = cur[k] as Json
    if (value === REMOVE) delete cur[last]
    else cur[last] = value
  }
  return spec
}

const issuesOf = (input: unknown): Issue[] => {
  const result = validateSpec(input)
  return result.ok ? [] : result.issues
}
// 서버가 돌려주는 spec이 아니라 어긋난 칸 하나만 본다.
const only = (path: string, code: IssueCode): Issue[] => [{ path, code }]

// 첫 서비스(fe)를 고치는 시험에서 BE의 links가 그 이름을 가리켜 UNKNOWN_SERVICE가 겹쳐 나오지 않게 링크를 비운다.
const noLinks: [string, unknown] = ['services[1].runtime.links', []]
const lead = (path: string): [string, unknown][] => (path.startsWith('services[0]') ? [noLinks] : [])

// BE를 Dockerfile 없는 서버(Node)로 바꾼다. 이 상태가 유효하고, 아래 규칙 시험의 출발점이다.
const beNoDockerfile: [string, unknown][] = [
  ['services[1].build.dockerfile', null],
  ['services[1].build.framework', 'nest'],
  ['services[1].build.nodeVersion', '22'],
  ['services[1].build.install', 'pnpm install --frozen-lockfile'],
  ['services[1].build.build', 'pnpm run build'],
  ['services[1].build.start', 'pnpm run start'],
]

describe('a valid spec', () => {
  it('passes and is returned as is', () => {
    const input = valid()
    const result = validateSpec(input)
    expect(result.ok).toBe(true)
    // 같은 객체다(복사본이 아니다).
    expect(result.ok && result.spec).toBe(input)
  })

  it('allows a server without a Dockerfile (framework, node version, install, build, start)', () => {
    expect(issuesOf(make(...beNoDockerfile))).toEqual([])
  })

  it('allows a service-less-ingress internal service and a tcp health check', () => {
    expect(
      issuesOf(make(['services[1].runtime.ingressPath', null], ['services[1].runtime.health', { type: 'tcp', path: null, startupTimeoutSeconds: 30 }])),
    ).toEqual([])
  })

  it('allows 3 services', () => {
    const spec = valid()
    const services = spec.services as Json[]
    services.push({ ...structuredClone(services[1]), name: 'ai', role: 'ai' })
    expect(issuesOf(spec)).toEqual([])
  })
})

describe('shape', () => {
  it.each([null, [], 'spec', 3, undefined])('rejects a spec that is not an object (%j)', (input) => {
    expect(issuesOf(input)).toEqual(only('spec', 'INVALID_TYPE'))
  })

  it.each([
    ['extra', 'extra'],
    ['project.extra', 'project.extra'],
    ['services[0].extra', 'services[0].extra'],
    ['services[0].build.extra', 'services[0].build.extra'],
    ['services[0].runtime.extra', 'services[0].runtime.extra'],
    ['services[0].runtime.health.extra', 'services[0].runtime.health.extra'],
    ['services[1].runtime.links[0].extra', 'services[1].runtime.links[0].extra'],
  ])('rejects an unknown key at %s', (path, expected) => {
    expect(issuesOf(make([path, 1]))).toEqual(only(expected, 'UNKNOWN_KEY'))
  })

  it.each([
    'project',
    'services',
    'project.slug',
    'services[0].name',
    'services[0].build',
    'services[0].build.nodeVersion',
    'services[0].build.buildEnv',
    'services[0].runtime.resources',
    'services[0].runtime.health.path',
    'services[1].runtime.links[0].service',
  ])('requires %s even when its value would be null', (path) => {
    expect(issuesOf(make(...lead(path), [path, REMOVE]))).toEqual(only(path, 'REQUIRED'))
  })

  it.each([
    ['project', 'project'],
    ['services[0]', 'services[0]'],
    ['services[0].build', 'services[0].build'],
    ['services[0].runtime', 'services[0].runtime'],
    ['services[0].runtime.health', 'services[0].runtime.health'],
    ['services[1].runtime.links[0]', 'services[1].runtime.links[0]'],
  ])('rejects %s that is not an object', (path, expected) => {
    for (const value of ['x', [1], null]) {
      expect(issuesOf(make(...lead(path), [path, value]))).toEqual(only(expected, 'INVALID_TYPE'))
    }
  })
})

describe('project', () => {
  it.each(['a', 'my-app', 'a1', '1a', 'a'.repeat(58)])('accepts slug "%s"', (slug) => {
    expect(issuesOf(make(['project.slug', slug]))).toEqual([])
  })

  it.each(['', 'My-App', '-a', 'a-', 'a_b', 'a.b', 'a b', 'a'.repeat(59), 'ㄱ'])('rejects slug "%s"', (slug) => {
    expect(issuesOf(make(['project.slug', slug]))).toEqual(only('project.slug', 'INVALID_VALUE'))
  })

  it.each(['www', 'api', 'admin', 'app', 'platform', 'default', 'kube-system'])('rejects the reserved slug "%s"', (slug) => {
    expect(issuesOf(make(['project.slug', slug]))).toEqual(only('project.slug', 'RESERVED'))
  })

  it.each([5, null, ['a']])('rejects a slug that is not a string (%j)', (slug) => {
    expect(issuesOf(make(['project.slug', slug]))).toEqual(only('project.slug', 'INVALID_TYPE'))
  })

  it.each(['student/my-app', 'a/b', 'A.b_c/D-e.f'])('accepts repo "%s"', (repo) => {
    expect(issuesOf(make(['project.repo', repo]))).toEqual([])
  })

  it.each(['my-app', '/my-app', 'a/b/c', 'a/', 'a b/c', ''])('rejects repo "%s"', (repo) => {
    expect(issuesOf(make(['project.repo', repo]))).toEqual(only('project.repo', 'INVALID_VALUE'))
  })
})

describe('services', () => {
  it('needs at least one and at most three', () => {
    expect(issuesOf(make(['services', []]))).toEqual(only('services', 'OUT_OF_RANGE'))
    const spec = valid()
    const services = spec.services as Json[]
    for (const [name, role] of [['ai', 'ai'], ['extra', 'ai']]) services.push({ ...structuredClone(services[1]), name, role })
    expect(issuesOf(spec)).toEqual(only('services', 'OUT_OF_RANGE'))
  })

  it.each([null, {}, 'fe'])('rejects services that is not an array (%j)', (services) => {
    expect(issuesOf(make(['services', services]))).toEqual(only('services', 'INVALID_TYPE'))
  })

  it('rejects a service name used twice, at the second one', () => {
    expect(issuesOf(make(['services[1].name', 'fe']))).toEqual(only('services[1].name', 'DUPLICATE'))
  })

  it.each(['be', 'my-api', 'a1', 'a'.repeat(52)])('accepts name "%s"', (name) => {
    expect(issuesOf(make(['services[1].name', name]))).toEqual([])
  })

  it.each(['', 'Fe', '1fe', '-fe', 'fe-', 'fe_1', 'a'.repeat(53)])('rejects name "%s"', (name) => {
    expect(issuesOf(make(['services[1].name', name]))).toEqual(only('services[1].name', 'INVALID_VALUE'))
  })

  it('rejects a name that is not a string', () => {
    expect(issuesOf(make(['services[1].name', 5]))).toEqual(only('services[1].name', 'INVALID_TYPE'))
  })

  it.each(['db', 'FE', ''])('rejects role "%s"', (role) => {
    expect(issuesOf(make(['services[0].role', role]))).toEqual(only('services[0].role', 'INVALID_VALUE'))
  })

  it.each(['/etc', '..', 'a/../b', 'a//b', 'a/', 'FE\\x', '', 'a b', './a', 'a/./b', 'é', '-x', 'a/--out', '-'])('rejects dir "%s"', (dir) => {
    expect(issuesOf(make(['services[0].dir', dir]))).toEqual(only('services[0].dir', 'INVALID_VALUE'))
  })

  it.each(['.', 'FE', 'apps/web', 'a-b_c.d@1+x'])('accepts dir "%s"', (dir) => {
    expect(issuesOf(make(['services[0].dir', dir]))).toEqual([])
  })

  it('shares the path rule with isRelativePath', () => {
    expect(isRelativePath('.')).toBe(true)
    expect(isRelativePath('a/b')).toBe(true)
    expect(isRelativePath('a'.repeat(200))).toBe(true)
    expect(isRelativePath('a'.repeat(201))).toBe(false)
    expect(isRelativePath('../a')).toBe(false)
  })
})

describe('build', () => {
  it('needs a context that is a relative path', () => {
    expect(issuesOf(make(['services[0].build.context', null]))).toEqual(only('services[0].build.context', 'INVALID_TYPE'))
    expect(issuesOf(make(['services[0].build.context', '/']))).toEqual(only('services[0].build.context', 'INVALID_VALUE'))
  })

  it.each(['django', 'Next.js', ''])('rejects framework "%s"', (framework) => {
    expect(issuesOf(make(['services[0].build.framework', framework]))).toEqual(only('services[0].build.framework', 'INVALID_VALUE'))
  })

  it.each(['22', '22.1', '22.1.0', '8'])('accepts nodeVersion "%s"', (version) => {
    expect(issuesOf(make(['services[0].build.nodeVersion', version]))).toEqual([])
  })

  it.each(['>=22', 'latest', '022', '22.', 'v22', '22.1.0.1', ''])('rejects nodeVersion "%s"', (version) => {
    expect(issuesOf(make(['services[0].build.nodeVersion', version]))).toEqual(only('services[0].build.nodeVersion', 'INVALID_VALUE'))
  })

  it.each(['', '   ', 'a\nb', 'a\rb', 'a\0b', 'x'.repeat(1001)])('rejects the command %j', (cmd) => {
    expect(issuesOf(make(['services[0].build.install', cmd]))).toEqual(only('services[0].build.install', 'INVALID_VALUE'))
  })

  it('accepts a command of 1000 characters and rejects a non-string command', () => {
    expect(issuesOf(make(['services[0].build.install', 'x'.repeat(1000)]))).toEqual([])
    expect(issuesOf(make(['services[0].build.install', 5]))).toEqual(only('services[0].build.install', 'INVALID_TYPE'))
  })

  it('rejects a Dockerfile or output folder that is not a relative path', () => {
    expect(issuesOf(make(['services[1].build.dockerfile', '../Dockerfile']))).toEqual(only('services[1].build.dockerfile', 'INVALID_VALUE'))
    expect(issuesOf(make(['services[0].build.outputDir', '/dist']))).toEqual(only('services[0].build.outputDir', 'INVALID_VALUE'))
  })

  describe('buildEnv', () => {
    it.each(['1X', 'A-B', 'a b', '', '__proto__', 'A'.repeat(129)])('rejects the key "%s"', (key) => {
      const buildEnv = JSON.parse(JSON.stringify({ [key]: 'x' }).replace('"__proto__"', '"__proto__"')) as Json
      expect(issuesOf(make(['services[0].build.buildEnv', buildEnv]))).toEqual(only(`services[0].build.buildEnv.${key}`, 'INVALID_VALUE'))
    })

    it('rejects a __proto__ key that JSON.parse made an own property', () => {
      const buildEnv = JSON.parse('{"__proto__":"x"}') as Json
      expect(issuesOf(make(['services[0].build.buildEnv', buildEnv]))).toEqual(only('services[0].build.buildEnv.__proto__', 'INVALID_VALUE'))
    })

    it('rejects a value that is not a string or is too long', () => {
      expect(issuesOf(make(['services[0].build.buildEnv', { A: 5 }]))).toEqual(only('services[0].build.buildEnv.A', 'INVALID_TYPE'))
      expect(issuesOf(make(['services[0].build.buildEnv', { A: 'x'.repeat(4097) }]))).toEqual(only('services[0].build.buildEnv.A', 'INVALID_VALUE'))
      expect(issuesOf(make(['services[0].build.buildEnv', { A: 'x'.repeat(4096) }]))).toEqual([])
      expect(issuesOf(make(['services[0].build.buildEnv', { A: 'a\0b' }]))).toEqual(only('services[0].build.buildEnv.A', 'INVALID_VALUE'))
    })

    it('rejects more than 100 entries', () => {
      const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`K${i}`, 'v']))
      expect(issuesOf(make(['services[0].build.buildEnv', many]))).toEqual(only('services[0].build.buildEnv', 'OUT_OF_RANGE'))
      expect(issuesOf(make(['services[0].build.buildEnv', Object.fromEntries(Object.entries(many).slice(0, 100))]))).toEqual([])
    })

    it.each([[null], [[]], ['x']])('rejects buildEnv that is not an object (%j)', (value) => {
      expect(issuesOf(make(['services[0].build.buildEnv', value]))).toEqual(only('services[0].build.buildEnv', 'INVALID_TYPE'))
    })

    it('may not share a key with secretKeys (the build env is public)', () => {
      expect(issuesOf(make(['services[1].build.buildEnv', { DATABASE_URL: 'x' }]))).toEqual(
        only('services[1].build.buildEnv.DATABASE_URL', 'CONFLICT'),
      )
    })
  })
})

describe('Dockerfile rules', () => {
  it.each(['framework', 'nodeVersion', 'install', 'build', 'start', 'outputDir'])(
    'with a Dockerfile, %s must be null',
    (key) => {
      const value = { framework: 'nest', nodeVersion: '22', install: 'x', build: 'x', start: 'x', outputDir: 'dist' }[key]
      expect(issuesOf(make([`services[1].build.${key}`, value]))).toEqual(only(`services[1].build.${key}`, 'MUST_BE_NULL'))
    },
  )

  it.each(['framework', 'nodeVersion', 'install', 'build'])('without a Dockerfile, %s is required', (key) => {
    expect(issuesOf(make([`services[0].build.${key}`, null]))).toEqual(only(`services[0].build.${key}`, 'REQUIRED'))
  })

  it('without a Dockerfile, a server needs start and has no output folder', () => {
    expect(issuesOf(make(...beNoDockerfile, ['services[1].build.start', null]))).toEqual(only('services[1].build.start', 'REQUIRED'))
    expect(issuesOf(make(...beNoDockerfile, ['services[1].build.outputDir', 'dist']))).toEqual(
      only('services[1].build.outputDir', 'MUST_BE_NULL'),
    )
  })

  it('without a Dockerfile, a static site needs an output folder and has no start command', () => {
    expect(issuesOf(make(['services[0].build.outputDir', null]))).toEqual(only('services[0].build.outputDir', 'REQUIRED'))
    expect(issuesOf(make(['services[0].build.start', 'pnpm run start']))).toEqual(only('services[0].build.start', 'MUST_BE_NULL'))
  })

  it('does not apply the server/static rules before the kind is known', () => {
    // kind가 틀렸으면 그 칸만 알린다. start · outputDir 규칙까지 겹쳐 알리지 않는다.
    expect(issuesOf(make(['services[0].runtime.kind', 'job']))).toEqual(only('services[0].runtime.kind', 'INVALID_VALUE'))
  })

  it('does not stack a MUST_BE_NULL on a field that is already the wrong type', () => {
    expect(issuesOf(make(['services[1].build.install', 5]))).toEqual(only('services[1].build.install', 'INVALID_TYPE'))
  })
})

describe('runtime', () => {
  it.each(['job', 'Server', ''])('rejects kind "%s"', (kind) => {
    expect(issuesOf(make(['services[1].runtime.kind', kind]))).toEqual(only('services[1].runtime.kind', 'INVALID_VALUE'))
  })

  it.each([1, 80, 65535])('accepts port %d', (port) => {
    expect(issuesOf(make(['services[1].runtime.port', port]))).toEqual([])
  })

  it.each([0, 65536, -1])('rejects port %d as out of range', (port) => {
    expect(issuesOf(make(['services[1].runtime.port', port]))).toEqual(only('services[1].runtime.port', 'OUT_OF_RANGE'))
  })

  it.each([3000.5, '80', null, Number.NaN])('rejects port %j as the wrong type', (port) => {
    expect(issuesOf(make(['services[1].runtime.port', port]))).toEqual(only('services[1].runtime.port', 'INVALID_TYPE'))
  })

  it('fixes the port of a static site at 8080', () => {
    expect(issuesOf(make(['services[0].runtime.port', 3000]))).toEqual(only('services[0].runtime.port', 'CONFLICT'))
  })

  describe('health', () => {
    it.each(['udp', 'HTTP', ''])('rejects type "%s"', (type) => {
      expect(issuesOf(make(['services[1].runtime.health.type', type]))).toEqual(only('services[1].runtime.health.type', 'INVALID_VALUE'))
    })

    it.each(['health', 'a b', '/a b', ''])('rejects the http path "%s"', (path) => {
      expect(issuesOf(make(['services[1].runtime.health.path', path]))).toEqual(only('services[1].runtime.health.path', 'INVALID_VALUE'))
    })

    it('needs a string path for http and a null path for tcp', () => {
      expect(issuesOf(make(['services[1].runtime.health.path', null]))).toEqual(only('services[1].runtime.health.path', 'INVALID_TYPE'))
      expect(issuesOf(make(['services[1].runtime.health.type', 'tcp']))).toEqual(only('services[1].runtime.health.path', 'MUST_BE_NULL'))
      expect(issuesOf(make(['services[1].runtime.health', { type: 'tcp', path: null, startupTimeoutSeconds: 5 }]))).toEqual([])
    })

    it('limits the http path to 200 characters', () => {
      expect(issuesOf(make(['services[1].runtime.health.path', `/${'a'.repeat(199)}`]))).toEqual([])
      expect(issuesOf(make(['services[1].runtime.health.path', `/${'a'.repeat(200)}`]))).toEqual(
        only('services[1].runtime.health.path', 'INVALID_VALUE'),
      )
    })

    it.each([0, 601, -5])('rejects startupTimeoutSeconds %d as out of range', (seconds) => {
      expect(issuesOf(make(['services[1].runtime.health.startupTimeoutSeconds', seconds]))).toEqual(
        only('services[1].runtime.health.startupTimeoutSeconds', 'OUT_OF_RANGE'),
      )
    })

    it.each([1, 600])('accepts startupTimeoutSeconds %d', (seconds) => {
      expect(issuesOf(make(['services[1].runtime.health.startupTimeoutSeconds', seconds]))).toEqual([])
    })

    it('rejects startupTimeoutSeconds that is not an integer', () => {
      expect(issuesOf(make(['services[1].runtime.health.startupTimeoutSeconds', 1.5]))).toEqual(
        only('services[1].runtime.health.startupTimeoutSeconds', 'INVALID_TYPE'),
      )
    })
  })

  describe('env, secretKeys and links', () => {
    it('rejects a bad env name or value', () => {
      expect(issuesOf(make(['services[1].runtime.env', { '1A': 'x' }]))).toEqual(only('services[1].runtime.env.1A', 'INVALID_VALUE'))
      expect(issuesOf(make(['services[1].runtime.env', { A: 1 }]))).toEqual(only('services[1].runtime.env.A', 'INVALID_TYPE'))
    })

    it('rejects a secret key that repeats, at the repeat', () => {
      expect(issuesOf(make(['services[1].runtime.secretKeys', ['A', 'B', 'A']]))).toEqual(only('services[1].runtime.secretKeys[2]', 'DUPLICATE'))
    })

    it('rejects a bad secret key name and a non-array', () => {
      expect(issuesOf(make(['services[1].runtime.secretKeys', ['a-b']]))).toEqual(only('services[1].runtime.secretKeys[0]', 'INVALID_VALUE'))
      expect(issuesOf(make(['services[1].runtime.secretKeys', 'A']))).toEqual(only('services[1].runtime.secretKeys', 'INVALID_TYPE'))
      expect(issuesOf(make(['services[1].runtime.secretKeys', [5]]))).toEqual(only('services[1].runtime.secretKeys[0]', 'INVALID_TYPE'))
    })

    it('allows 100 secret keys and 30 links, and rejects one more', () => {
      const keys = (n: number) => Array.from({ length: n }, (_, i) => `K${i}`)
      const links = (n: number) => keys(n).map((env) => ({ env, service: 'fe' }))
      expect(issuesOf(make(['services[1].runtime.secretKeys', keys(100)]))).toEqual([])
      expect(issuesOf(make(['services[1].runtime.secretKeys', keys(101)]))).toEqual(only('services[1].runtime.secretKeys', 'OUT_OF_RANGE'))
      expect(issuesOf(make(['services[1].runtime.links', links(30)]))).toEqual([])
      expect(issuesOf(make(['services[1].runtime.links', links(31)]))).toEqual(only('services[1].runtime.links', 'OUT_OF_RANGE'))
    })

    it('rejects a plain env that is also a secret key, at the env', () => {
      expect(issuesOf(make(['services[1].runtime.env', { DATABASE_URL: 'postgres://x' }]))).toEqual(
        only('services[1].runtime.env.DATABASE_URL', 'CONFLICT'),
      )
    })

    it('rejects a link env that is also a plain env or a secret key, at the link', () => {
      expect(issuesOf(make(['services[1].runtime.env', { FE_URL: 'x' }]))).toEqual(only('services[1].runtime.links[0].env', 'CONFLICT'))
      expect(issuesOf(make(['services[1].runtime.secretKeys', ['FE_URL']]))).toEqual(only('services[1].runtime.links[0].env', 'CONFLICT'))
    })

    it('rejects a link to a service that does not exist', () => {
      expect(issuesOf(make(['services[1].runtime.links', [{ env: 'AI_URL', service: 'ai' }]]))).toEqual(
        only('services[1].runtime.links[0].service', 'UNKNOWN_SERVICE'),
      )
    })

    it('rejects a link env used twice, at the second one', () => {
      expect(
        issuesOf(make(['services[1].runtime.links', [{ env: 'U', service: 'fe' }, { env: 'U', service: 'be' }]])),
      ).toEqual(only('services[1].runtime.links[1].env', 'DUPLICATE'))
    })

    it('rejects a bad link env name or a non-string service', () => {
      expect(issuesOf(make(['services[1].runtime.links', [{ env: 'a-b', service: 'fe' }]]))).toEqual(
        only('services[1].runtime.links[0].env', 'INVALID_VALUE'),
      )
      expect(issuesOf(make(['services[1].runtime.links', [{ env: 'U', service: 3 }]]))).toEqual(
        only('services[1].runtime.links[0].service', 'INVALID_TYPE'),
      )
    })

    it('allows a link to a later service', () => {
      expect(issuesOf(make(['services[0].runtime.links', []], ['services[1].runtime.links', [{ env: 'FE_URL', service: 'fe' }]]))).toEqual([])
    })
  })

  describe('a static site', () => {
    it.each(['env', 'secretKeys', 'links'])('has no %s', (key) => {
      const value = { env: { A: 'x' }, secretKeys: ['A'], links: [{ env: 'U', service: 'be' }] }[key]
      expect(issuesOf(make([`services[0].runtime.${key}`, value]))).toEqual(only(`services[0].runtime.${key}`, 'CONFLICT'))
    })
  })

  describe('ingressPath', () => {
    it.each(['/', '/api', '/api/v1', '/a.b_c-d~e'])('accepts "%s"', (path) => {
      expect(issuesOf(make(['services[1].runtime.ingressPath', path]))).toEqual([])
    })

    it.each(['api', '/api/', '//', '/a b', '/a//b', '', '/a?b', '/'.padEnd(202, 'a')])('rejects "%s"', (path) => {
      expect(issuesOf(make(['services[1].runtime.ingressPath', path]))).toEqual(only('services[1].runtime.ingressPath', 'INVALID_VALUE'))
    })

    it('rejects an ingressPath that is not a string', () => {
      expect(issuesOf(make(['services[1].runtime.ingressPath', 5]))).toEqual(only('services[1].runtime.ingressPath', 'INVALID_TYPE'))
    })
  })

  it.each(['yes', 1, null])('rejects stripPrefix %j', (value) => {
    expect(issuesOf(make(['services[1].runtime.stripPrefix', value]))).toEqual(only('services[1].runtime.stripPrefix', 'INVALID_TYPE'))
  })

  it.each([{}, { cpu: '1' }, 'small', 0])('accepts only null for resources (%j)', (value) => {
    expect(issuesOf(make(['services[1].runtime.resources', value]))).toEqual(only('services[1].runtime.resources', 'INVALID_VALUE'))
  })
})

describe('reporting', () => {
  it('reports several fields at once, each with one code', () => {
    expect(issuesOf(make(['project.slug', 'Bad'], ['services[1].runtime.port', 0], ['services[0].build.install', null]))).toEqual([
      { path: 'project.slug', code: 'INVALID_VALUE' },
      { path: 'services[0].build.install', code: 'REQUIRED' },
      { path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' },
    ])
  })

  it(`reports at most ${MAX_ISSUES} fields`, () => {
    const spec = valid()
    const services = spec.services as Json[]
    for (let i = 0; i < 2; i += 1) services.push(structuredClone(services[1]))
    // 서비스 세 개의 칸을 모두 틀리게 해 20칸을 넘긴다.
    const bad = { name: 1, role: 1, dir: 1, build: 1, runtime: 1 }
    spec.services = [bad, bad, bad, bad, bad].map((s) => ({ ...s }))
    spec.project = { slug: 1, repo: 1 }
    const issues = issuesOf(spec)
    expect(MAX_ISSUES).toBe(20)
    expect(issues).toHaveLength(20)
    expect(new Set(issues.map((i) => i.path)).size).toBe(20)
  })

  it('does not change or fill the input', () => {
    const input = valid()
    const before = structuredClone(input)
    validateSpec(input)
    validateSpec(make(['project.slug', 'Bad']))
    expect(input).toEqual(before)
  })
})
