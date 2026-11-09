// 배포 설정 초안: package.json과 락 파일 이름으로 프레임워크 · 패키지 매니저 · 명령을 채운다. 규칙 코드이고 AI가 아니다.
// 규칙과 응답 모양은 docs/design/api.md의 `POST /api/repos/deploy-spec`.

/** 한 번에 읽는 package.json 폴더 수. 큰 모노레포(vite 레포는 317개)가 호출 수를 키우지 못하게 한다. */
export const MAX_PACKAGES = 10

export type Source = 'package.json' | 'lockfile' | 'default'
type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
type Framework = 'nextjs' | 'vite-react'

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
const PLAIN_INSTALL: Record<PackageManager, string> = {
  pnpm: 'pnpm install',
  npm: 'npm install',
  yarn: 'yarn install',
  bun: 'bun install',
}
// 프레임워크가 정해 주는 값은 출력 폴더와 포트뿐이다. 명령은 프로젝트의 scripts에만 기댄다(없는 명령을 지어내지 않는다).
const OUTPUT_DIR: Record<Framework, string | null> = { 'vite-react': 'dist', nextjs: null }
const PORT: Record<Framework, number | null> = { 'vite-react': null, nextjs: 3000 }

const none = { value: null, source: null } as const
const noCommand: Command = { value: null, script: null, source: null }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const join = (dir: string, name: string) => (dir === '.' ? name : `${dir}/${name}`)
const parent = (dir: string) => (dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.')

/** 트리의 파일 경로에서 읽을 package.json 폴더를 고른다: node_modules 밖, 얕은 폴더부터 이름순, 최대 MAX_PACKAGES개. */
export function selectPackageDirs(paths: string[]): { dirs: string[]; truncated: boolean } {
  const dirs = paths
    .filter((p) => (p === 'package.json' || p.endsWith('/package.json')) && !p.split('/').includes('node_modules'))
    .map((p) => (p === 'package.json' ? '.' : p.slice(0, -'/package.json'.length)))
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))
  return { dirs: dirs.slice(0, MAX_PACKAGES), truncated: dirs.length > MAX_PACKAGES }
}

const depth = (dir: string) => (dir === '.' ? 0 : dir.split('/').length)

/**
 * 폴더 하나의 초안. `pkg`는 읽어 파싱한 package.json이고 객체가 아니면 읽지 못한 것이다(그래도 락 파일 · Dockerfile은 알 수 있다).
 * `files`는 레포의 모든 파일 경로다. 배포 대상이 아닌 워크스페이스 루트는 null이다.
 */
export function buildProject(dir: string, pkg: unknown, files: ReadonlySet<string>): DeployProject | null {
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

  const install: Field<string> =
    lock && pm
      ? { value: pm === 'yarn' && declared?.name === 'yarn' && declared.major >= 2 ? 'yarn install --immutable' : INSTALL[pm], source: 'lockfile' }
      : !lock && pm
        ? { value: PLAIN_INSTALL[pm], source: manager.source }
        : none

  const outputDir = fw && OUTPUT_DIR[fw] ? ({ value: OUTPUT_DIR[fw], source: 'default' } as const) : none
  const port = fw && PORT[fw] ? ({ value: PORT[fw], source: 'default' } as const) : none
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
    // 정적 사이트(Vite + React)는 시작 명령이 없다.
    start: fw === 'vite-react' ? noCommand : command(scripts.start, 'start', pm),
    outputDir,
    port,
    nodeVersion: isRecord(p.engines) && typeof p.engines.node === 'string' ? p.engines.node : null,
    // 패키지 매니저가 정해지지 않았으면(락 파일이 여럿이거나 packageManager와 어긋남) 어느 락 파일인지도 정하지 않는다.
    lockfile: lock && pm ? lock.path : null,
    dockerfile: files.has(join(dir, 'Dockerfile')),
  }
  // 값이 없는데 해당 없음도 아니면 사용자가 골라야 한다. 해당 없음은 정적 사이트의 시작 명령 · 포트, Next.js의 출력 폴더다.
  const notApplicable: Reviewable[] = fw === 'vite-react' ? ['start', 'port'] : fw === 'nextjs' ? ['outputDir'] : []
  const needsReview = REVIEW_ORDER.filter((name) => result[name].value === null && !notApplicable.includes(name))
  return { ...result, needsReview }
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
function isWorkspaceRoot(dir: string, pkg: Record<string, unknown>, files: ReadonlySet<string>) {
  return Array.isArray(pkg.workspaces) || isRecord(pkg.workspaces) || files.has(join(dir, 'pnpm-workspace.yaml'))
}

// `pnpm@9.1.0+sha512…`처럼 버전 · 해시가 붙으므로 @ 앞의 이름만 쓴다. 네 가지 외의 이름은 없는 것으로 본다.
function declaredManager(value: unknown): { name: PackageManager; major: number } | undefined {
  if (typeof value !== 'string') return undefined
  const [name, version] = value.split('@')
  const pm = LOCKS.find(([, p]) => p === name)?.[1]
  return pm && { name: pm, major: Number.parseInt(version ?? '', 10) }
}

/** 이 폴더에서 시작해 가장 가까운 상위 폴더까지 올라가며 처음 락 파일이 나오는 곳. 한 폴더에서 나온 락 파일 이름만 모은다. */
function findLock(dir: string, files: ReadonlySet<string>): { path: string; managers: PackageManager[] } | undefined {
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
