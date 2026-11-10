// 배포 설정 초안: package.json과 락 파일 이름으로 프레임워크 · 패키지 매니저 · 명령을 채운다. 규칙 코드이고 AI가 아니다.
// 규칙과 응답 모양은 docs/design/api.md의 `POST /api/repos/deploy-spec`.
import { isRecord } from '../common/is-record.js'

/** 한 번에 읽는 package.json 폴더 수. 큰 모노레포(vite 레포는 317개)가 호출 수를 키우지 못하게 한다. */
export const MAX_PACKAGES = 10

export type Source = 'package.json' | 'lockfile' | 'default'
type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
type Framework = 'nextjs' | 'vite-react'
/** 레포의 모든 파일 경로. 있는지 묻기만 한다. */
type Files = { has(path: string): boolean }

/** `value`가 null이면 모르거나 해당 없음이다. 사용자가 골라야 하면 `needsReview`에 이름이 있다. */
export interface Field<T> {
  value: T | null
  source: Source | null
  candidates?: string[]
}

export interface Command {
  value: string | null
  script: string | null
  source: Source | null
}

const REVIEW_ORDER = ['framework', 'language', 'packageManager', 'install', 'build', 'start', 'outputDir', 'port'] as const
type Reviewable = (typeof REVIEW_ORDER)[number]

export interface DeployProject {
  dir: string
  framework: Field<Framework>
  language: Field<'typescript' | 'javascript'>
  packageManager: Field<PackageManager>
  install: Field<string>
  build: Command
  start: Command
  outputDir: Field<string>
  port: Field<number>
  nodeVersion: string | null
  lockfile: string | null
  dockerfile: boolean
  needsReview: Reviewable[]
}

// 락 파일 이름이 가리키는 패키지 매니저. bun.lock(새 텍스트)이 bun.lockb(옛 바이너리)보다 앞에 온다.
const LOCKS: [name: string, pm: PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]
const INSTALL: Record<PackageManager, string> = {
  pnpm: 'pnpm install --frozen-lockfile',
  npm: 'npm ci',
  yarn: 'yarn install --frozen-lockfile',
  bun: 'bun install --frozen-lockfile',
}
// 프레임워크가 정해 주는 값은 출력 폴더 · 포트 · 시작 명령이 있는지뿐이다. 명령 자체는 프로젝트의 scripts에만 기댄다(없는 명령을 지어내지 않는다).
// 값이 null인 칸은 "해당 없음"이다(정적 사이트에는 시작 명령 · 포트가 없고, Next.js에는 출력 폴더가 없다).
const FRAMEWORKS: Record<Framework, { outputDir: string | null; port: number | null; hasStart: boolean }> = {
  'vite-react': { outputDir: 'dist', port: null, hasStart: false },
  nextjs: { outputDir: null, port: 3000, hasStart: true },
}

const none = { value: null, source: null } as const
const noCommand: Command = { value: null, script: null, source: null }

export const join = (dir: string, name: string) => (dir === '.' ? name : `${dir}/${name}`)
// 경로의 폴더. 폴더 이름에도 쓴다(레포 루트는 '.').
const parent = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')

/** 트리의 파일 경로에서 읽을 package.json 폴더를 고른다: node_modules 밖, 얕은 폴더부터 이름순, 최대 MAX_PACKAGES개. */
export function selectPackageDirs(paths: Iterable<string>): { dirs: string[]; truncated: boolean } {
  const depth = (dir: string) => (dir === '.' ? 0 : dir.split('/').length)
  const dirs = [...paths]
    .filter((p) => (p === 'package.json' || p.endsWith('/package.json')) && !p.startsWith('node_modules/') && !p.includes('/node_modules/'))
    .map(parent)
    // 기본 정렬은 코드 단위 순서이고 정렬은 안정적이라, 이름순으로 한 번 정렬한 뒤 얕은 순으로 다시 정렬하면 "얕은 순, 같으면 이름순"이다.
    .sort()
    .sort((a, b) => depth(a) - depth(b))
  return { dirs: dirs.slice(0, MAX_PACKAGES), truncated: dirs.length > MAX_PACKAGES }
}

/**
 * 폴더 하나의 초안. `pkg`는 읽어 파싱한 package.json이고 객체가 아니면 읽지 못한 것이다(그래도 락 파일 · Dockerfile은 알 수 있다).
 * `files`는 레포의 모든 파일 경로다. 배포 대상이 아닌 워크스페이스 루트는 null이다.
 */
export function buildProject(dir: string, pkg: unknown, files: Files): DeployProject | null {
  const readable = isRecord(pkg)
  const p = readable ? pkg : {}
  const deps = new Set([...Object.keys(asRecord(p.dependencies)), ...Object.keys(asRecord(p.devDependencies))])

  const framework = detectFramework(deps)
  if (readable && !framework.candidates && framework.value === null && isWorkspaceRoot(dir, p, files)) return null

  const declared = declaredManager(p.packageManager)
  const lock = findLock(dir, files)
  const manager = resolveManager(lock?.managers ?? [], declared?.name)
  const pm = manager.value
  const fw = framework.value

  // 락 파일이 있으면 고정 설치(Yarn 2 이상은 --immutable), 없으면 그냥 설치. 출처는 패키지 매니저의 출처와 같다.
  const berry = (declared?.major ?? 0) >= 2
  const install: Field<string> = pm
    ? { value: lock ? (pm === 'yarn' && berry ? 'yarn install --immutable' : INSTALL[pm]) : `${pm} install`, source: manager.source }
    : none

  const defaults = fw ? FRAMEWORKS[fw] : undefined
  const outputDir: Field<string> = defaults?.outputDir ? { value: defaults.outputDir, source: 'default' } : none
  const port: Field<number> = defaults?.port ? { value: defaults.port, source: 'default' } : none
  const scripts = asRecord(p.scripts)

  const result: Omit<DeployProject, 'needsReview'> = {
    dir,
    framework,
    language: readable
      ? { value: deps.has('typescript') ? 'typescript' : 'javascript', source: 'package.json' }
      : none,
    packageManager: manager,
    install,
    build: command(scripts.build, 'build', pm),
    start: defaults && !defaults.hasStart ? noCommand : command(scripts.start, 'start', pm),
    outputDir,
    port,
    nodeVersion: isRecord(p.engines) && typeof p.engines.node === 'string' ? p.engines.node : null,
    // 패키지 매니저가 정해지지 않았으면(락 파일이 여럿이거나 packageManager와 어긋남) 어느 락 파일인지도 정하지 않는다.
    lockfile: lock && pm ? lock.path : null,
    dockerfile: files.has(join(dir, 'Dockerfile')),
  }
  // 값이 없는데 해당 없음도 아니면 사용자가 골라야 한다. 프레임워크를 알면 FRAMEWORKS의 null 칸이 해당 없음이다.
  const notApplicable: Reviewable[] = []
  if (defaults && !defaults.hasStart) notApplicable.push('start')
  if (defaults?.outputDir === null) notApplicable.push('outputDir')
  if (defaults?.port === null) notApplicable.push('port')
  const needsReview = REVIEW_ORDER.filter((name) => result[name].value === null && !notApplicable.includes(name))
  return { ...result, needsReview }
}

/** 읽은 package.json들(dirs와 같은 순서)로 폴더마다 초안을 만든다. 배포 대상이 아닌 워크스페이스 루트는 뺀다. */
export function buildProjects(dirs: string[], packages: unknown[], files: Files): DeployProject[] {
  return dirs.flatMap((dir, i) => buildProject(dir, packages[i], files) ?? [])
}

const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

function detectFramework(deps: ReadonlySet<string>): Field<Framework> {
  const found: Framework[] = []
  if (deps.has('next')) found.push('nextjs')
  if (deps.has('vite') && deps.has('react')) found.push('vite-react')
  if (found.length === 1) return { value: found[0], source: 'package.json' }
  return found.length === 0 ? { ...none } : { ...none, candidates: found }
}

// workspaces를 배열이나 객체(yarn의 { packages })로 선언했거나 pnpm-workspace.yaml이 곁에 있으면 패키지를 묶는 루트다.
function isWorkspaceRoot(dir: string, pkg: Record<string, unknown>, files: Files) {
  return (typeof pkg.workspaces === 'object' && pkg.workspaces !== null) || files.has(join(dir, 'pnpm-workspace.yaml'))
}

// `pnpm@9.1.0+sha512…`처럼 버전 · 해시가 붙으므로 @ 앞의 이름만 쓴다. 네 가지 외의 이름은 없는 것으로 본다.
function declaredManager(value: unknown): { name: PackageManager; major: number } | undefined {
  if (typeof value !== 'string') return undefined
  const [name, version] = value.split('@')
  const pm = LOCKS.find(([, p]) => p === name)?.[1]
  return pm && { name: pm, major: Number.parseInt(version ?? '', 10) }
}

/** 이 폴더에서 시작해 가장 가까운 상위 폴더까지 올라가며 처음 락 파일이 나오는 곳. 한 폴더에서 나온 락 파일 이름만 모은다. */
function findLock(dir: string, files: Files): { path: string; managers: PackageManager[] } | undefined {
  for (let d = dir; ; d = parent(d)) {
    const found = LOCKS.filter(([name]) => files.has(join(d, name)))
    if (found.length > 0) {
      return { path: join(d, found[0][0]), managers: [...new Set(found.map(([, pm]) => pm))] }
    }
    if (d === '.') return undefined
  }
}

function resolveManager(locked: PackageManager[], declared: PackageManager | undefined): Field<PackageManager> {
  if (locked.length === 0) {
    return declared ? { value: declared, source: 'package.json' } : { value: 'npm', source: 'default' }
  }
  const all = [...new Set([...locked, ...(declared ? [declared] : [])])].sort()
  // 락 파일이 여럿이거나 packageManager와 어긋나면 사용자가 고른다.
  if (all.length > 1) return { ...none, candidates: all }
  return { value: locked[0], source: 'lockfile' }
}

function command(script: unknown, name: 'build' | 'start', pm: PackageManager | null): Command {
  if (typeof script !== 'string' || script.trim() === '') return noCommand
  return { value: pm ? `${pm} run ${name}` : null, script, source: 'package.json' }
}
