import {
  DEFAULT_INGRESS,
  MAX_SERVICES,
  NAME_PATTERN,
  NODE_VERSION_PATTERN,
  RESERVED_SLUGS,
  ROLES,
  SLUG_MAX,
  SLUG_PATTERN,
  STATIC_PORT,
  TIMEOUT_MAX,
  TIMEOUT_MIN,
} from './limits.ts'
import type { DeploySpecDraft, DraftProject, EnvMap, Issue, ServiceSpec, Spec } from './types.ts'

// 화면이 들고 있는 입력값. 칸은 모두 문자열이고, 서버로 보낼 때 toSpec이 spec 모양으로 바꾼다.
export type EnvRow = { name: string; value: string }
export type LinkRow = { env: string; service: string }
// 초안이 알려 준 출처와 "골라 주세요" 표시. 칸 이름은 deploy-spec의 항목 이름이다.
export type Hint = { source: string | null; review: boolean; candidates?: string[] }
export type HintKey = 'framework' | 'install' | 'build' | 'start' | 'outputDir' | 'port'

export type ServiceForm = {
  id: number
  name: string
  role: string
  dir: string
  dockerfile: string // '' = Dockerfile 없음
  context: string
  framework: string
  nodeVersion: string
  nodeVersionRaw: string | null // 초안이 준 engines.node 원문. 안내로만 보인다.
  install: string
  build: string
  start: string
  outputDir: string
  buildEnv: EnvRow[]
  kind: 'server' | 'static'
  port: string
  healthType: 'http' | 'tcp'
  healthPath: string
  timeout: string
  ingressPath: string // '' = 내부 전용(null)
  env: EnvRow[]
  secretKeys: string[]
  links: LinkRow[]
  hints: Partial<Record<HintKey, Hint>>
}

export type SpecForm = { slug: string; repo: string; services: ServiceForm[] }

let nextId = 1

// 레포 이름을 소문자 · 하이픈으로 바꾼 값. 규칙에 맞는 글자가 남지 않으면 비운다.
export function slugFromRepo(repo: string): string {
  const name = repo.split('/').pop() ?? ''
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug
}

// engines.node 원문(`>=22`, `^22.22.0 || ^24`)에서 처음 나오는 "이 버전 이상 · 호환" 조건의 숫자 버전을 뽑는다. 서버는 `22` · `22.1` · `22.1.0`만 받는다.
// `<23` · `>22`처럼 그 버전을 포함하지 않는 조건은 건너뛴다(그 숫자는 범위를 만족하지 않을 수 있다).
// 범위를 하나로 줄이는 것은 추측이므로 화면에 원문을 함께 보여 사용자가 고치게 한다.
export function nodeVersionOf(range: string | null): string {
  for (const token of (range ?? '').split(/\s+|\|\|/)) {
    const match = /^(?:>=|\^|~|=|v)?(\d{1,2}(?:\.\d{1,3}){0,2})(?:\.[xX*])?$/.exec(token)
    if (match?.[1]) return match[1]
  }
  return ''
}

const dirnameOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')
const dockerfileIn = (dir: string) => (dir === '.' ? 'Dockerfile' : `${dir}/Dockerfile`)

function hintOf(project: DraftProject, key: HintKey): Hint {
  const detected = project[key]
  return {
    source: detected.source,
    review: project.needsReview.includes(key),
    candidates: detected.candidates,
  }
}

export function blankService(dir = '.'): ServiceForm {
  return {
    id: nextId++,
    name: '',
    role: '',
    dir,
    dockerfile: '',
    context: dir,
    framework: '',
    nodeVersion: '',
    nodeVersionRaw: null,
    install: '',
    build: '',
    start: '',
    outputDir: '',
    buildEnv: [],
    kind: 'server',
    port: '',
    healthType: 'http',
    healthPath: '/',
    timeout: '60',
    ingressPath: '',
    env: [],
    secretKeys: [],
    links: [],
    hints: {},
  }
}

// 초안의 폴더 하나를 서비스 입력칸으로 옮긴다. 초안이 모르는 칸(이름 · 역할 · 시작 대기 시간 등)은 기본값이거나 비운다.
export function serviceFromProject(project: DraftProject, dockerfiles: string[]): ServiceForm {
  const framework = project.framework.value ?? ''
  const found = dockerfileIn(project.dir)
  const kind = framework === 'vite-react' ? 'static' : 'server'
  // 역할은 프레임워크로 추측할 수 있을 때만 채운다(vite-react → fe). 이름은 역할과 같게 시작한다.
  const role = framework === 'vite-react' ? 'fe' : ''
  return {
    ...blankService(project.dir),
    name: role,
    role,
    dockerfile: dockerfiles.includes(found) ? found : '',
    // 락 파일이 있는 폴더에서 설치해야 하므로 빌드 위치도 그 폴더다(루트에 있으면 `.`).
    context: project.lockfile ? dirnameOf(project.lockfile) : project.dir,
    framework,
    nodeVersion: nodeVersionOf(project.nodeVersion),
    nodeVersionRaw: project.nodeVersion,
    install: project.install.value ?? '',
    build: project.build.value ?? '',
    start: project.start.value ?? '',
    outputDir: project.outputDir.value ?? '',
    kind,
    // 정적이면 화면과 spec이 8080으로 고정하므로 입력값에는 초안의 값을 그대로 둔다(서버로 바꿨을 때 되살아난다).
    port: String(project.port.value ?? ''),
    ingressPath: role ? DEFAULT_INGRESS[role as (typeof ROLES)[number]] : '',
    hints: {
      framework: hintOf(project, 'framework'),
      install: hintOf(project, 'install'),
      build: hintOf(project, 'build'),
      start: hintOf(project, 'start'),
      outputDir: hintOf(project, 'outputDir'),
      port: hintOf(project, 'port'),
    },
  }
}

// 초안이 폴더를 3개보다 많이 찾아도 처음 3개로 시작하고, 나머지는 사용자가 추가한다.
export function formFromDraft(draft: DeploySpecDraft, repo: string, dockerfiles: string[]): SpecForm {
  return {
    slug: slugFromRepo(repo),
    repo,
    services: draft.projects.slice(0, MAX_SERVICES).map((p) => serviceFromProject(p, dockerfiles)),
  }
}

// 역할을 바꾸면 손대지 않은 이름 · 공개 경로를 새 역할의 기본값으로 따라 바꾼다.
export function withRole(service: ServiceForm, role: string): ServiceForm {
  const isRole = (value: string): value is (typeof ROLES)[number] => (ROLES as readonly string[]).includes(value)
  const oldIngress = isRole(service.role) ? DEFAULT_INGRESS[service.role] : ''
  return {
    ...service,
    role,
    name: service.name === service.role ? role : service.name,
    ingressPath: service.ingressPath === oldIngress && isRole(role) ? DEFAULT_INGRESS[role] : service.ingressPath,
  }
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim())
const toEnv = (rows: EnvRow[]): EnvMap => Object.fromEntries(rows.map((r) => [r.name.trim(), r.value]))

function toService(s: ServiceForm): ServiceSpec {
  const isStatic = s.kind === 'static'
  const hasDockerfile = s.dockerfile !== ''
  // Dockerfile이 있으면 framework ~ outputDir은 모두 null로 보낸다(칸이 화면에 남아 있어도).
  const own = <T,>(value: T): T | null => (hasDockerfile ? null : value)
  return {
    name: s.name.trim(),
    role: s.role,
    dir: s.dir.trim(),
    build: {
      context: s.context.trim(),
      dockerfile: orNull(s.dockerfile),
      framework: own(orNull(s.framework)),
      nodeVersion: own(orNull(s.nodeVersion)),
      install: own(orNull(s.install)),
      build: own(orNull(s.build)),
      start: own(isStatic ? null : orNull(s.start)),
      outputDir: own(isStatic ? orNull(s.outputDir) : null),
      buildEnv: toEnv(s.buildEnv),
    },
    runtime: {
      kind: s.kind,
      port: isStatic ? STATIC_PORT : Number(s.port),
      health: {
        type: s.healthType,
        path: s.healthType === 'http' ? s.healthPath.trim() : null,
        startupTimeoutSeconds: Number(s.timeout),
      },
      // 정적이면 env · secretKeys · links는 비어 있어야 한다.
      env: isStatic ? {} : toEnv(s.env),
      secretKeys: isStatic ? [] : s.secretKeys.map((k) => k.trim()),
      links: isStatic ? [] : s.links.map((l) => ({ env: l.env.trim(), service: l.service })),
      ingressPath: orNull(s.ingressPath),
      // #72가 정해질 때까지 고칠 수 없다.
      stripPrefix: false,
      resources: null,
    },
  }
}

export function toSpec(form: SpecForm): Spec {
  return { project: { slug: form.slug.trim(), repo: form.repo }, services: form.services.map(toService) }
}

const isInteger = (text: string) => /^\d+$/.test(text.trim())

// 명백한 것만 서버에 보내기 전에 거른다. 어긋난 칸을 서버와 같은 { path, code }로 알려 같은 화면 경로로 보여 준다.
export function localIssues(form: SpecForm): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, code: string) => issues.push({ path, code })
  const slug = form.slug.trim()
  if (slug === '') add('project.slug', 'REQUIRED')
  else if (!SLUG_PATTERN.test(slug)) add('project.slug', 'INVALID_VALUE')
  else if (RESERVED_SLUGS.includes(slug)) add('project.slug', 'RESERVED')

  if (form.services.length === 0) add('services', 'OUT_OF_RANGE')
  const names = new Set<string>()
  const roles = new Set<string>()
  const ingress = new Set<string>()
  form.services.forEach((s, i) => {
    const at = `services[${i}]`
    const name = s.name.trim()
    if (name === '') add(`${at}.name`, 'REQUIRED')
    else if (!NAME_PATTERN.test(name)) add(`${at}.name`, 'INVALID_VALUE')
    else if (names.has(name)) add(`${at}.name`, 'DUPLICATE')
    names.add(name)
    if (s.role === '') add(`${at}.role`, 'REQUIRED')
    else if (roles.has(s.role)) add(`${at}.role`, 'DUPLICATE')
    roles.add(s.role)
    if (s.dir.trim() === '') add(`${at}.dir`, 'REQUIRED')
    if (s.context.trim() === '') add(`${at}.build.context`, 'REQUIRED')

    if (s.dockerfile === '') {
      const need = (key: 'framework' | 'install' | 'build', value: string) => {
        if (value.trim() === '') add(`${at}.build.${key}`, 'REQUIRED')
      }
      need('framework', s.framework)
      need('install', s.install)
      need('build', s.build)
      if (s.nodeVersion.trim() === '') add(`${at}.build.nodeVersion`, 'REQUIRED')
      else if (!NODE_VERSION_PATTERN.test(s.nodeVersion.trim())) add(`${at}.build.nodeVersion`, 'INVALID_VALUE')
      if (s.kind === 'server' && s.start.trim() === '') add(`${at}.build.start`, 'REQUIRED')
      if (s.kind === 'static' && s.outputDir.trim() === '') add(`${at}.build.outputDir`, 'REQUIRED')
    }

    if (s.kind === 'server') {
      if (s.port.trim() === '') add(`${at}.runtime.port`, 'REQUIRED')
      else if (!isInteger(s.port)) add(`${at}.runtime.port`, 'INVALID_TYPE')
      else if (Number(s.port) < 1 || Number(s.port) > 65535) add(`${at}.runtime.port`, 'OUT_OF_RANGE')
    }
    if (s.healthType === 'http') {
      const path = s.healthPath.trim()
      if (path === '') add(`${at}.runtime.health.path`, 'REQUIRED')
      else if (!/^\/\S*$/.test(path)) add(`${at}.runtime.health.path`, 'INVALID_VALUE')
    }
    if (!isInteger(s.timeout)) add(`${at}.runtime.health.startupTimeoutSeconds`, 'INVALID_TYPE')
    else if (Number(s.timeout) < TIMEOUT_MIN || Number(s.timeout) > TIMEOUT_MAX) {
      add(`${at}.runtime.health.startupTimeoutSeconds`, 'OUT_OF_RANGE')
    }
    const path = s.ingressPath.trim()
    if (path !== '' && !path.startsWith('/')) add(`${at}.runtime.ingressPath`, 'INVALID_VALUE')
    else if (path !== '') {
      if (ingress.has(path)) add(`${at}.runtime.ingressPath`, 'DUPLICATE')
      ingress.add(path)
    }

    envIssues(s.buildEnv, `${at}.build.buildEnv`, add)
    if (s.kind === 'server') {
      envIssues(s.env, `${at}.runtime.env`, add)
      const seen = new Set<string>()
      s.secretKeys.forEach((key, j) => {
        if (key.trim() === '') add(`${at}.runtime.secretKeys[${j}]`, 'REQUIRED')
        else if (seen.has(key.trim())) add(`${at}.runtime.secretKeys[${j}]`, 'DUPLICATE')
        seen.add(key.trim())
      })
      s.links.forEach((link, j) => {
        if (link.env.trim() === '') add(`${at}.runtime.links[${j}].env`, 'REQUIRED')
        if (link.service === '') add(`${at}.runtime.links[${j}].service`, 'REQUIRED')
      })
    }
  })
  return issues
}

// 환경변수 줄: 이름이 비었거나 같은 이름이 둘이면 알린다. 이름 칸의 오류 경로는 서버와 같이 `<목록>.<이름>`이다.
function envIssues(rows: EnvRow[], path: string, add: (path: string, code: string) => void) {
  const seen = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '') add(path, 'REQUIRED')
    else if (seen.has(name)) add(`${path}.${name}`, 'DUPLICATE')
    seen.add(name)
  }
}
