import { isRecord } from '../common/is-record.js'

// 배포 입력의 spec 검증. 규칙 코드이고 AI가 아니다. 칸 · 규칙 · 오류 코드는 docs/design/api.md의 "배포 입력 저장".
// 모르는 키는 거부하고, 어긋난 칸은 칸마다 { path, code }로 알린다(문장이 아니라 코드로 가를 수 있게).

export type IssueCode =
  | 'REQUIRED'
  | 'MUST_BE_NULL'
  | 'INVALID_TYPE'
  | 'INVALID_VALUE'
  | 'OUT_OF_RANGE'
  | 'DUPLICATE'
  | 'UNKNOWN_KEY'
  | 'UNKNOWN_SERVICE'
  | 'RESERVED'
  | 'CONFLICT'
  | 'MISMATCH'

export interface Issue {
  path: string
  code: IssueCode
}

/** 한 번에 알리는 칸 수. 터무니없는 입력이 응답을 키우지 못하게 한다. */
export const MAX_ISSUES = 20

export interface Spec {
  project: { slug: string; repo: string }
  services: Service[]
}

interface Service {
  name: string
  role: 'fe' | 'be' | 'ai'
  dir: string
  build: {
    context: string
    dockerfile: string | null
    framework: 'vite-react' | 'nextjs' | 'nest' | null
    nodeVersion: string | null
    install: string | null
    build: string | null
    start: string | null
    outputDir: string | null
    buildEnv: Record<string, string>
  }
  runtime: {
    kind: 'server' | 'static'
    port: number
    health: { type: 'http' | 'tcp'; path: string | null; startupTimeoutSeconds: number }
    env: Record<string, string>
    secretKeys: string[]
    links: { env: string; service: string }[]
    ingressPath: string | null
    stripPrefix: boolean
    resources: null
  }
}

// 공개 주소 <slug>.<도메인>의 예약 이름. 목록의 정본은 docs/design/cluster.md §9(예약 이름)이고, 그 목록과 같게 둔다.
const RESERVED_SLUGS = new Set([
  ...['app', 'api', 'www', 'admin', 'account', 'auth', 'login', 'platform', 'dashboard', 'status', 'docs', 'blog', 'cdn', 'static', 'grafana'],
  ...['mail', 'smtp', 'demo', 'test', 'dev', 'staging', 'default', 'kube-system'],
])
const MAX_SERVICES = 3
const MAX_MAP_ENTRIES = 100
const MAX_VALUE_LENGTH = 4096
const MAX_COMMAND_LENGTH = 1000
const MAX_PATH_LENGTH = 200
const MAX_LINKS = 30

export const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
export const SERVICE_NAME = /^[a-z]([a-z0-9-]{0,28}[a-z0-9])?$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const NODE_VERSION = /^\d{1,2}(\.\d{1,3}){0,2}$/
// 공개 경로는 `/` 하나이거나 `/api` · `/api/v1`처럼 끝 슬래시 없는 경로 조각이다.
const URL_PATH = /^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*)?$/
const HEALTH_PATH = /^\/\S*$/
const ROLES = ['fe', 'be', 'ai']
const KINDS = ['server', 'static']
const FRAMEWORKS = ['vite-react', 'nextjs', 'nest']
const HEALTH_TYPES = ['http', 'tcp']

// env 이름. `__proto__`는 모양은 맞지만 받지 않는다(받는 쪽이 객체에 그대로 합치면 prototype이 오염된다).
const isEnvName = (s: string) => ENV_NAME.test(s) && s !== '__proto__'

type Obj = Record<string, unknown>

/** 레포 안 상대 경로: `.` 하나이거나 `FE/dist`처럼 안전한 글자의 조각들(`/`로 시작 · `..` · `\` · 빈 조각 불가, 조각은 `-`로 시작할 수 없다: 명령 옵션으로 읽히지 않게). */
export function isRelativePath(v: string): boolean {
  if (v === '.') return true
  return v.length <= MAX_PATH_LENGTH && v.split('/').every((seg) => /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]*$/.test(seg) && seg !== '.' && seg !== '..')
}

/**
 * `input`이 배포 입력의 spec 모양과 규칙을 지키는지 본다. 지키면 입력을 그대로 돌려주고(고치거나 채우지 않는다),
 * 아니면 어긋난 칸을 칸마다(한 칸에 코드 하나, 최대 MAX_ISSUES칸) 알린다.
 */
export function validateSpec(input: unknown): { ok: true; spec: Spec } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = []
  const seen = new Set<string>()
  const add = (path: string, code: IssueCode) => {
    if (issues.length >= MAX_ISSUES || seen.has(path)) return
    seen.add(path)
    issues.push({ path, code })
  }

  // 객체이고 모든 키가 정확히 keys와 같은지 본다. 없는 키는 REQUIRED, 모르는 키는 UNKNOWN_KEY.
  const shape = (v: unknown, path: string, keys: string[]): Obj | undefined => {
    if (!isRecord(v)) return void add(path || 'spec', 'INVALID_TYPE')
    for (const k of Object.keys(v)) if (!keys.includes(k)) add(at(path, k), 'UNKNOWN_KEY')
    for (const k of keys) if (!Object.hasOwn(v, k)) add(at(path, k), 'REQUIRED')
    return v
  }
  const text = (v: unknown, path: string, ok: (s: string) => boolean): string | undefined => {
    if (typeof v !== 'string') return void add(path, 'INVALID_TYPE')
    if (!ok(v)) return void add(path, 'INVALID_VALUE')
    return v
  }
  // 서로 달라야 하는 값. 읽지 못한 칸(undefined)은 세지 않고, 겹치면 뒤에 나온 쪽 칸에 알린다.
  const unique = (seen: Set<string>, v: string | undefined, path: string) => {
    if (v === undefined) return
    if (seen.has(v)) add(path, 'DUPLICATE')
    seen.add(v)
  }
  const oneOf = (v: unknown, path: string, allowed: string[]) => text(v, path, (s) => allowed.includes(s))
  const int = (v: unknown, path: string, min: number, max: number): number | undefined => {
    if (typeof v !== 'number' || !Number.isInteger(v)) return void add(path, 'INVALID_TYPE')
    if (v < min || v > max) return void add(path, 'OUT_OF_RANGE')
    return v
  }
  const command = (v: unknown, path: string) =>
    text(v, path, (s) => s.trim() !== '' && s.length <= MAX_COMMAND_LENGTH && !/[\r\n\0]/.test(s))
  const relPath = (v: unknown, path: string) => text(v, path, isRelativePath)
  const envName = (v: unknown, path: string) => text(v, path, isEnvName)
  const stringMap = (v: unknown, path: string): Obj | undefined => {
    if (!isRecord(v)) return void add(path, 'INVALID_TYPE')
    const entries = Object.entries(v)
    if (entries.length > MAX_MAP_ENTRIES) add(path, 'OUT_OF_RANGE')
    for (const [k, value] of entries) {
      if (!isEnvName(k)) add(at(path, k), 'INVALID_VALUE')
      else text(value, at(path, k), (s) => s.length <= MAX_VALUE_LENGTH && !s.includes('\0'))
    }
    return v
  }
  const list = (v: unknown, path: string, max: number): unknown[] | undefined => {
    if (!Array.isArray(v)) return void add(path, 'INVALID_TYPE')
    if (v.length > max) add(path, 'OUT_OF_RANGE')
    return v as unknown[]
  }

  const root = shape(input, '', ['project', 'services'])
  if (root) {
    const project = shape(root.project, 'project', ['slug', 'repo'])
    if (project) {
      const slug = text(project.slug, 'project.slug', (s) => SLUG.test(s))
      if (slug !== undefined && RESERVED_SLUGS.has(slug)) add('project.slug', 'RESERVED')
      text(project.repo, 'project.repo', (s) => REPO.test(s))
    }

    const services = list(root.services, 'services', MAX_SERVICES)
    if (services?.length === 0) add('services', 'OUT_OF_RANGE')
    // links의 service가 가리킬 수 있는 이름. 문자열이 아닌 name은 칸 검사에서 이미 걸린다.
    const names = new Set(services?.map((s) => (isRecord(s) && typeof s.name === 'string' ? s.name : '')))
    const taken = new Set<string>()
    const roles = new Set<string>()
    const ingressPaths = new Set<string>()
    services?.forEach((raw, i) => {
      const path = `services[${i}]`
      const svc = shape(raw, path, ['name', 'role', 'dir', 'build', 'runtime'])
      if (!svc) return
      const name = text(svc.name, `${path}.name`, (s) => SERVICE_NAME.test(s))
      unique(taken, name, `${path}.name`)
      unique(roles, oneOf(svc.role, `${path}.role`, ROLES), `${path}.role`)
      relPath(svc.dir, `${path}.dir`)

      const { kind, secretKeys } = runtimeOf(svc.runtime, `${path}.runtime`, names, ingressPaths)
      buildOf(svc.build, `${path}.build`, kind, secretKeys)
    })
  }

  return issues.length === 0 ? { ok: true, spec: input as Spec } : { ok: false, issues }

  // runtime 칸. build의 규칙이 kind와 secretKeys를 보므로 그 두 값을 돌려준다(읽지 못했으면 undefined).
  function runtimeOf(raw: unknown, path: string, names: Set<string>, ingressPaths: Set<string>): { kind?: string; secretKeys?: unknown[] } {
    const runtime = shape(raw, path, ['kind', 'port', 'health', 'env', 'secretKeys', 'links', 'ingressPath', 'stripPrefix', 'resources'])
    if (!runtime) return {}
    const kind = oneOf(runtime.kind, `${path}.kind`, KINDS)
    const port = int(runtime.port, `${path}.port`, 1, 65535)
    if (kind === 'static' && port !== undefined && port !== 8080) add(`${path}.port`, 'CONFLICT')

    const health = shape(runtime.health, `${path}.health`, ['type', 'path', 'startupTimeoutSeconds'])
    if (health) {
      const type = oneOf(health.type, `${path}.health.type`, HEALTH_TYPES)
      if (type === 'http') text(health.path, `${path}.health.path`, (s) => HEALTH_PATH.test(s) && s.length <= MAX_PATH_LENGTH)
      else if (type === 'tcp' && health.path !== null) add(`${path}.health.path`, 'MUST_BE_NULL')
      int(health.startupTimeoutSeconds, `${path}.health.startupTimeoutSeconds`, 5, 300)
    }

    const env = stringMap(runtime.env, `${path}.env`)
    const secretKeys = list(runtime.secretKeys, `${path}.secretKeys`, MAX_MAP_ENTRIES)
    // secretKeys의 값은 따로 들어가므로, 같은 이름의 평문 env가 spec에 저장되면 안 된다.
    if (env && secretKeys) for (const k of Object.keys(env)) if (secretKeys.includes(k)) add(`${path}.env.${k}`, 'CONFLICT')
    secretKeys?.forEach((k, j) => {
      const key = envName(k, `${path}.secretKeys[${j}]`)
      if (key !== undefined && secretKeys.indexOf(key) !== j) add(`${path}.secretKeys[${j}]`, 'DUPLICATE')
    })
    const links = list(runtime.links, `${path}.links`, MAX_LINKS)
    const linkEnvs = new Set<string>()
    links?.forEach((l, j) => {
      const linkPath = `${path}.links[${j}]`
      const link = shape(l, linkPath, ['env', 'service'])
      if (!link) return
      const linkEnv = envName(link.env, `${linkPath}.env`)
      if (linkEnv !== undefined) {
        if (linkEnvs.has(linkEnv)) add(`${linkPath}.env`, 'DUPLICATE')
        else if ((env && Object.hasOwn(env, linkEnv)) || secretKeys?.includes(linkEnv)) add(`${linkPath}.env`, 'CONFLICT')
        linkEnvs.add(linkEnv)
      }
      if (typeof link.service !== 'string') add(`${linkPath}.service`, 'INVALID_TYPE')
      else if (!names.has(link.service)) add(`${linkPath}.service`, 'UNKNOWN_SERVICE')
    })
    if (kind === 'static') {
      if (env && Object.keys(env).length > 0) add(`${path}.env`, 'CONFLICT')
      if (secretKeys && secretKeys.length > 0) add(`${path}.secretKeys`, 'CONFLICT')
      if (links && links.length > 0) add(`${path}.links`, 'CONFLICT')
    }

    if (runtime.ingressPath !== null) {
      const ingressPath = text(runtime.ingressPath, `${path}.ingressPath`, (s) => URL_PATH.test(s) && s.length <= MAX_PATH_LENGTH)
      // 같은 문자열만 겹침으로 본다. 앞부분이 겹치는 경로(`/`와 `/api`, `/api`와 `/api/v1`)는 deploy-handoff.md대로 허용한다.
      unique(ingressPaths, ingressPath, `${path}.ingressPath`)
    }
    if (typeof runtime.stripPrefix !== 'boolean') add(`${path}.stripPrefix`, 'INVALID_TYPE')
    // 모양이 정해지지 않았다. 정해지면 이 검사를 넓힌다.
    if (runtime.resources !== null) add(`${path}.resources`, 'INVALID_VALUE')
    return { kind, secretKeys }
  }

  // build 칸과, Dockerfile · kind에 따라 있어야 하는 칸 · 없어야 하는 칸. 값이 있으면 그 칸의 모양 검사는 위에서 끝났다.
  function buildOf(raw: unknown, path: string, kind: string | undefined, secretKeys: unknown[] | undefined) {
    const build = shape(raw, path, ['context', 'dockerfile', 'framework', 'nodeVersion', 'install', 'build', 'start', 'outputDir', 'buildEnv'])
    if (!build) return
    relPath(build.context, `${path}.context`)
    if (build.dockerfile !== null) relPath(build.dockerfile, `${path}.dockerfile`)
    if (build.framework !== null) oneOf(build.framework, `${path}.framework`, FRAMEWORKS)
    if (build.nodeVersion !== null) text(build.nodeVersion, `${path}.nodeVersion`, (s) => NODE_VERSION.test(s))
    for (const k of ['install', 'build', 'start']) if (build[k] !== null) command(build[k], `${path}.${k}`)
    if (build.outputDir !== null) relPath(build.outputDir, `${path}.outputDir`)
    const buildEnv = stringMap(build.buildEnv, `${path}.buildEnv`)

    // 빠진 키(undefined)는 shape가 이미 REQUIRED로 알렸고, 한 칸에 코드는 하나라 아래에서 겹쳐 알리지 않는다.
    const mustBeNull = (k: string) => {
      if (build[k] !== null) add(`${path}.${k}`, 'MUST_BE_NULL')
    }
    const required = (k: string) => {
      if (build[k] === null) add(`${path}.${k}`, 'REQUIRED')
    }
    if (Object.hasOwn(build, 'dockerfile')) {
      if (build.dockerfile !== null) {
        for (const k of ['framework', 'nodeVersion', 'install', 'build', 'start', 'outputDir']) mustBeNull(k)
      } else {
        for (const k of ['framework', 'nodeVersion', 'install', 'build']) required(k)
        if (kind === 'server') {
          required('start')
          mustBeNull('outputDir')
        } else if (kind === 'static') {
          required('outputDir')
          mustBeNull('start')
        }
      }
    }
    if (buildEnv && secretKeys) {
      for (const k of Object.keys(buildEnv)) if (secretKeys.includes(k)) add(`${path}.buildEnv.${k}`, 'CONFLICT')
    }
  }
}

const at = (path: string, key: string) => (path === '' ? key : `${path}.${key}`)
