import { describe, expect, it } from 'vitest'
import { beProject, draftOf, feProject, none } from './fixtures.ts'
import { blankService, formFromDraft, localIssues, nodeVersionOf, serviceFromProject, slugFromRepo, toSpec, withRole } from './spec-form.ts'
import type { SpecForm } from './spec-form.ts'

describe('slugFromRepo', () => {
  it.each([
    ['student/My_App.v2', 'my-app-v2'],
    ['student/--Hello--', 'hello'],
    ['student/가나다', ''],
    ['student/' + 'a'.repeat(60), 'a'.repeat(40)],
    ['student/' + 'a'.repeat(39) + '-bbb', 'a'.repeat(39)],
  ])('%s → %s', (repo, slug) => {
    expect(slugFromRepo(repo)).toBe(slug)
  })
})

describe('nodeVersionOf', () => {
  it.each([
    ['>=22', '22'],
    ['^22.22.0 || ^24.0.0', '22.22.0'],
    ['22.1', '22.1'],
    ['lts/*', ''],
    [null, ''],
  ])('%s → "%s"', (range, version) => {
    expect(nodeVersionOf(range)).toBe(version)
  })
})

describe('serviceFromProject', () => {
  it('fills a static Vite project from the draft and leaves unknown fields for the user', () => {
    const s = serviceFromProject(feProject, [])
    expect(s).toMatchObject({
      dir: 'FE',
      role: 'fe',
      name: 'fe',
      dockerfile: '',
      context: 'FE',
      framework: 'vite-react',
      nodeVersion: '22',
      nodeVersionRaw: '>=22',
      install: 'pnpm install --frozen-lockfile',
      outputDir: 'dist',
      kind: 'static',
      port: '8080',
      ingressPath: '/',
      timeout: '60',
      healthPath: '/',
    })
  })

  it('takes the Dockerfile found in the folder and leaves role, name and port to the user', () => {
    const s = serviceFromProject(beProject, ['BE/Dockerfile', 'Dockerfile'])
    expect(s).toMatchObject({ dockerfile: 'BE/Dockerfile', role: '', name: '', kind: 'server', port: '', ingressPath: '' })
    expect(s.hints.framework?.review).toBe(true)
    expect(s.hints.port?.review).toBe(true)
    expect(s.hints.install).toEqual({ source: 'lockfile', review: false, candidates: undefined })
  })

  it('looks for the Dockerfile at the root for a root project, and ignores one in another folder', () => {
    expect(serviceFromProject({ ...beProject, dir: '.', lockfile: 'pnpm-lock.yaml' }, ['Dockerfile']).dockerfile).toBe('Dockerfile')
    expect(serviceFromProject(beProject, ['Dockerfile']).dockerfile).toBe('')
  })

  it('builds from the folder that holds the lock file, the root when it is there', () => {
    expect(serviceFromProject({ ...feProject, lockfile: 'pnpm-lock.yaml' }, []).context).toBe('.')
    expect(serviceFromProject({ ...feProject, lockfile: null }, []).context).toBe('FE')
  })

  it('does not guess a role for a framework it cannot tell', () => {
    const s = serviceFromProject({ ...beProject, framework: { value: 'nextjs', source: 'package.json' }, port: { value: 3000, source: 'default' } }, [])
    expect(s).toMatchObject({ role: '', kind: 'server', port: '3000' })
  })
})

describe('formFromDraft', () => {
  it('starts with the first three folders and derives the slug from the repo name', () => {
    const projects = ['A', 'B', 'C', 'D'].map((dir) => ({ ...feProject, dir }))
    const form = formFromDraft(draftOf(projects), 'student/my-app', [])
    expect(form.slug).toBe('my-app')
    expect(form.services.map((s) => s.dir)).toEqual(['A', 'B', 'C'])
  })

  it('has no services for an empty list', () => {
    expect(formFromDraft(draftOf([]), 'student/my-app', []).services).toEqual([])
  })
})

describe('withRole', () => {
  it('follows an untouched name and public path to the new role', () => {
    const s = withRole(serviceFromProject(feProject, []), 'be')
    expect(s).toMatchObject({ role: 'be', name: 'be', ingressPath: '/api' })
  })

  it('keeps a name and a path the user wrote', () => {
    const edited = { ...serviceFromProject(feProject, []), name: 'web', ingressPath: '/app' }
    expect(withRole(edited, 'ai')).toMatchObject({ role: 'ai', name: 'web', ingressPath: '/app' })
  })

  it('gives the AI role an internal-only path', () => {
    expect(withRole(withRole(blankService(), 'be'), 'ai').ingressPath).toBe('')
  })
})

// docs/design/api.md의 요청 예시와 같은 입력
function exampleForm(): SpecForm {
  const fe = { ...serviceFromProject(feProject, []), buildEnv: [{ name: 'VITE_API_URL', value: '/api' }], timeout: '10' }
  const be = {
    ...serviceFromProject({ ...beProject, port: { value: 3000, source: 'package.json' } }, ['BE/Dockerfile']),
    name: 'be',
    role: 'be',
    context: '.',
    port: '3000',
    healthPath: '/api/health',
    ingressPath: '/api',
    env: [{ name: 'NODE_ENV', value: 'production' }],
    secretKeys: ['DATABASE_URL'],
  }
  return { slug: 'my-app', repo: 'student/my-app', services: [fe, be] }
}

describe('toSpec', () => {
  it('turns the form into the request example of api.md', () => {
    expect(toSpec(exampleForm())).toEqual({
      project: { slug: 'my-app', repo: 'student/my-app' },
      services: [
        {
          name: 'fe',
          role: 'fe',
          dir: 'FE',
          build: { context: 'FE', dockerfile: null, framework: 'vite-react', nodeVersion: '22', install: 'pnpm install --frozen-lockfile', build: 'pnpm run build', start: null, outputDir: 'dist', buildEnv: { VITE_API_URL: '/api' } },
          runtime: { kind: 'static', port: 8080, health: { type: 'http', path: '/', startupTimeoutSeconds: 10 }, env: {}, secretKeys: [], links: [], ingressPath: '/', stripPrefix: false, resources: null },
        },
        {
          name: 'be',
          role: 'be',
          dir: 'BE',
          build: { context: '.', dockerfile: 'BE/Dockerfile', framework: null, nodeVersion: null, install: null, build: null, start: null, outputDir: null, buildEnv: {} },
          runtime: { kind: 'server', port: 3000, health: { type: 'http', path: '/api/health', startupTimeoutSeconds: 60 }, env: { NODE_ENV: 'production' }, secretKeys: ['DATABASE_URL'], links: [], ingressPath: '/api', stripPrefix: false, resources: null },
        },
      ],
    })
  })

  it('sends null, not a missing key, for empty values, and nulls the build fields when a Dockerfile is chosen', () => {
    const form = exampleForm()
    // 입력칸에는 값이 남아 있어도(Dockerfile을 골랐다 풀었다 한 경우) Dockerfile이 있으면 null로 보낸다.
    const be = { ...form.services[1], framework: 'nest', nodeVersion: '22', install: 'npm ci', build: 'npm run build', start: 'node dist/main' }
    const { build } = toSpec({ ...form, services: [be] }).services[0]
    expect(build).toMatchObject({ dockerfile: 'BE/Dockerfile', framework: null, nodeVersion: null, install: null, build: null, start: null, outputDir: null })
  })

  it('drops the server-only fields for a static service and the output folder for a server', () => {
    const form = exampleForm()
    const fe = { ...form.services[0], env: [{ name: 'A', value: '1' }], secretKeys: ['S'], links: [{ env: 'X', service: 'be' }], port: '3000', start: 'node x' }
    const staticSpec = toSpec({ ...form, services: [fe] }).services[0]
    expect(staticSpec.runtime).toMatchObject({ port: 8080, env: {}, secretKeys: [], links: [] })
    expect(staticSpec.build.start).toBeNull()
    const server = { ...fe, kind: 'server' as const, start: 'node x', outputDir: 'dist' }
    expect(toSpec({ ...form, services: [server] }).services[0].build).toMatchObject({ start: 'node x', outputDir: null })
  })

  it('sends a null health path for tcp and a null ingress path when empty', () => {
    const form = exampleForm()
    const be = { ...form.services[1], healthType: 'tcp' as const, ingressPath: '' }
    expect(toSpec({ ...form, services: [be] }).services[0].runtime).toMatchObject({ health: { type: 'tcp', path: null, startupTimeoutSeconds: 60 }, ingressPath: null })
  })

  it('trims text and keeps the repo as it came from check', () => {
    const form = { ...exampleForm(), slug: ' my-app ' }
    expect(toSpec(form).project).toEqual({ slug: 'my-app', repo: 'student/my-app' })
  })
})

describe('localIssues', () => {
  const issuesOf = (edit: (form: SpecForm) => SpecForm) => localIssues(edit(exampleForm()))
  const first = (form: SpecForm, patch: Partial<SpecForm['services'][number]>): SpecForm => ({ ...form, services: [{ ...form.services[0], ...patch }, form.services[1]] })

  it('finds nothing wrong with the example', () => {
    expect(localIssues(exampleForm())).toEqual([])
  })

  it.each([
    ['empty slug', (f: SpecForm) => ({ ...f, slug: '' }), 'project.slug', 'REQUIRED'],
    ['uppercase slug', (f: SpecForm) => ({ ...f, slug: 'My-App' }), 'project.slug', 'INVALID_VALUE'],
    ['41-character slug', (f: SpecForm) => ({ ...f, slug: 'a'.repeat(41) }), 'project.slug', 'INVALID_VALUE'],
    ['reserved slug', (f: SpecForm) => ({ ...f, slug: 'mail' }), 'project.slug', 'RESERVED'],
    ['no service', (f: SpecForm) => ({ ...f, services: [] }), 'services', 'OUT_OF_RANGE'],
    ['empty name', (f: SpecForm) => first(f, { name: '' }), 'services[0].name', 'REQUIRED'],
    ['name starting with a digit', (f: SpecForm) => first(f, { name: '1fe' }), 'services[0].name', 'INVALID_VALUE'],
    ['31-character name', (f: SpecForm) => first(f, { name: 'a'.repeat(31) }), 'services[0].name', 'INVALID_VALUE'],
    ['same name twice', (f: SpecForm) => first(f, { name: 'be' }), 'services[1].name', 'DUPLICATE'],
    ['no role', (f: SpecForm) => first(f, { role: '' }), 'services[0].role', 'REQUIRED'],
    ['same role twice', (f: SpecForm) => first(f, { role: 'be' }), 'services[1].role', 'DUPLICATE'],
    ['same public path twice', (f: SpecForm) => first(f, { ingressPath: '/api' }), 'services[1].runtime.ingressPath', 'DUPLICATE'],
    ['public path without slash', (f: SpecForm) => first(f, { ingressPath: 'api' }), 'services[0].runtime.ingressPath', 'INVALID_VALUE'],
    ['timeout 4', (f: SpecForm) => first(f, { timeout: '4' }), 'services[0].runtime.health.startupTimeoutSeconds', 'OUT_OF_RANGE'],
    ['timeout 301', (f: SpecForm) => first(f, { timeout: '301' }), 'services[0].runtime.health.startupTimeoutSeconds', 'OUT_OF_RANGE'],
    ['timeout text', (f: SpecForm) => first(f, { timeout: 'x' }), 'services[0].runtime.health.startupTimeoutSeconds', 'INVALID_TYPE'],
    ['empty health path', (f: SpecForm) => first(f, { healthPath: '' }), 'services[0].runtime.health.path', 'REQUIRED'],
    ['no framework', (f: SpecForm) => first(f, { framework: '' }), 'services[0].build.framework', 'REQUIRED'],
    ['range as node version', (f: SpecForm) => first(f, { nodeVersion: '>=22' }), 'services[0].build.nodeVersion', 'INVALID_VALUE'],
    ['static without output folder', (f: SpecForm) => first(f, { outputDir: '' }), 'services[0].build.outputDir', 'REQUIRED'],
  ])('%s', (_name, edit, path, code) => {
    expect(localIssues(edit(exampleForm()))).toContainEqual({ path, code })
  })

  it('asks for a port and start command on a server, but not for a static site', () => {
    const be = issuesOf((f) => ({ ...f, services: [f.services[0], { ...f.services[1], dockerfile: '', framework: 'nest', nodeVersion: '22', install: 'a', build: 'b', start: '', port: '' }] }))
    expect(be).toContainEqual({ path: 'services[1].runtime.port', code: 'REQUIRED' })
    expect(be).toContainEqual({ path: 'services[1].build.start', code: 'REQUIRED' })
    expect(localIssues(exampleForm()).some((i) => i.path === 'services[0].runtime.port')).toBe(false)
  })

  it('does not ask for the build fields a Dockerfile replaces', () => {
    expect(issuesOf((f) => ({ ...f, services: [f.services[0], { ...f.services[1], framework: '', nodeVersion: '', install: '', build: '' }] }))).toEqual([])
  })

  it('rejects port 0, 65536 and a decimal', () => {
    for (const port of ['0', '65536', '30.5']) {
      expect(issuesOf((f) => ({ ...f, services: [f.services[0], { ...f.services[1], port }] })).some((i) => i.path === 'services[1].runtime.port')).toBe(true)
    }
  })

  it('flags empty and repeated rows at the path the server would use', () => {
    const issues = issuesOf((f) => ({
      ...f,
      services: [f.services[0], { ...f.services[1], env: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }, { name: '', value: 'x' }], secretKeys: ['K', 'K', ''], links: [{ env: '', service: '' }] }],
    }))
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: 'services[1].runtime.env.A', code: 'DUPLICATE' },
        { path: 'services[1].runtime.env', code: 'REQUIRED' },
        { path: 'services[1].runtime.secretKeys[1]', code: 'DUPLICATE' },
        { path: 'services[1].runtime.secretKeys[2]', code: 'REQUIRED' },
        { path: 'services[1].runtime.links[0].env', code: 'REQUIRED' },
        { path: 'services[1].runtime.links[0].service', code: 'REQUIRED' },
      ]),
    )
  })

  it('treats a missing detected value as an empty field to fill', () => {
    const s = serviceFromProject({ ...feProject, install: none, build: none, outputDir: none }, [])
    const issues = localIssues({ slug: 'my-app', repo: 'student/my-app', services: [s] })
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['services[0].build.install', 'services[0].build.build', 'services[0].build.outputDir']))
  })
})
