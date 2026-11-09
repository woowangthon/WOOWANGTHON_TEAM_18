import { describe, expect, it } from 'vitest'
import { buildProject, MAX_PACKAGES, selectPackageDirs } from './deploy-spec.js'

const files = (...paths: string[]) => new Set(paths)
// 실제 Vite 템플릿(react-ts)과 Next.js 예제의 모양을 따른다.
const vite = (extra: object = {}) => ({
  scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
  dependencies: { react: '^19.3.1', 'react-dom': '^19.3.1' },
  devDependencies: { typescript: '~7.0.2', vite: '^8.3.6' },
  ...extra,
})
const next = (extra: object = {}) => ({
  scripts: { dev: 'next dev --turbopack', build: 'next build', start: 'next start' },
  dependencies: { next: 'latest', react: '^18.2.0', 'react-dom': '^18.2.0' },
  devDependencies: { typescript: '^5.3.3' },
  ...extra,
})
const project = (dir: string, pkg: unknown, ...paths: string[]) => {
  const result = buildProject(dir, pkg, files(...paths))
  if (!result) throw new Error('expected a project')
  return result
}

describe('selectPackageDirs', () => {
  it('lists the folder of every package.json, shallowest first, then by name', () => {
    const { dirs, truncated } = selectPackageDirs(['b/x/package.json', 'package.json', 'z/package.json', 'a/package.json', 'README.md'])
    expect(dirs).toEqual(['.', 'a', 'z', 'b/x'])
    expect(truncated).toBe(false)
  })

  it.each(['node_modules/left-pad/package.json', 'FE/node_modules/react/package.json', 'a/node_modules/b/node_modules/c/package.json'])(
    'skips a package.json inside node_modules (%s)',
    (path) => {
      expect(selectPackageDirs([path, 'package.json']).dirs).toEqual(['.'])
    },
  )

  it.each(['package.json.bak', 'mypackage.json', 'FE/package-lock.json', 'package.jsonc', 'FE/package.json/x.js'])('ignores %s', (path) => {
    expect(selectPackageDirs([path]).dirs).toEqual([])
  })

  it('keeps node_modules as a whole name only, not as a part of one', () => {
    expect(selectPackageDirs(['my_node_modules/package.json', 'node_modules2/package.json']).dirs).toEqual(['my_node_modules', 'node_modules2'])
  })

  it('reads at most MAX_PACKAGES folders and says the list is cut', () => {
    const many = Array.from({ length: MAX_PACKAGES + 1 }, (_, i) => `p${String(i).padStart(2, '0')}/package.json`)
    expect(selectPackageDirs(many)).toEqual({ dirs: many.slice(0, MAX_PACKAGES).map((p) => p.replace('/package.json', '')), truncated: true })
    expect(selectPackageDirs(many.slice(0, MAX_PACKAGES)).truncated).toBe(false)
  })

  it('cuts the deepest folders first, so a real app is not pushed out by fixtures', () => {
    const fixtures = Array.from({ length: 12 }, (_, i) => `packages/x/test/fixtures/f${i}/package.json`)
    const { dirs } = selectPackageDirs([...fixtures, 'FE/package.json', 'BE/package.json'])
    expect(dirs.slice(0, 2)).toEqual(['BE', 'FE'])
  })
})

describe('framework', () => {
  it.each([
    ['next', { dependencies: { next: '15' } }, 'nextjs'],
    ['vite + react', { dependencies: { react: '19' }, devDependencies: { vite: '8' } }, 'vite-react'],
    ['vite + react, both in dependencies', { dependencies: { react: '19', vite: '8' } }, 'vite-react'],
    ['next found in devDependencies', { devDependencies: { next: '15' } }, 'nextjs'],
  ])('%s', (_name, pkg, expected) => {
    expect(project('.', pkg).framework).toEqual({ value: expected, source: 'package.json' })
  })

  it.each([
    ['vite without react', { devDependencies: { vite: '8', vue: '3' } }],
    ['react alone', { dependencies: { react: '19' } }],
    ['nothing recognizable', { dependencies: { express: '5' } }],
    ['no dependencies at all', {}],
  ])('is left for the student when %s (no candidates)', (_name, pkg) => {
    expect(project('.', pkg).framework).toEqual({ value: null, source: null })
  })

  it('names both candidates when next and vite + react are both there', () => {
    const fw = project('.', { dependencies: { next: '15', react: '19' }, devDependencies: { vite: '8' } }).framework
    expect(fw).toEqual({ value: null, source: null, candidates: ['nextjs', 'vite-react'] })
  })

  it.each([
    ['dependencies is a string', { dependencies: 'next' }],
    ['dependencies is an array', { dependencies: ['next'] }],
    ['dependencies is null', { dependencies: null }],
  ])('ignores a malformed field (%s)', (_name, pkg) => {
    expect(project('.', pkg).framework.value).toBeNull()
  })
})

describe('language', () => {
  it.each([
    ['typescript in devDependencies', { devDependencies: { typescript: '5' } }, 'typescript'],
    ['typescript in dependencies', { dependencies: { typescript: '5' } }, 'typescript'],
    ['no typescript', { dependencies: { react: '19' } }, 'javascript'],
    ['@types/node only', { devDependencies: { '@types/node': '22' } }, 'javascript'],
  ])('%s', (_name, pkg, expected) => {
    expect(project('.', pkg).language).toEqual({ value: expected, source: 'package.json' })
  })
})

describe('package manager and install command', () => {
  it.each([
    ['pnpm-lock.yaml', undefined, 'pnpm', 'pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
    ['package-lock.json', undefined, 'npm', 'npm ci', 'package-lock.json'],
    ['yarn.lock', undefined, 'yarn', 'yarn install --frozen-lockfile', 'yarn.lock'],
    ['yarn.lock', 'yarn@1.22.19', 'yarn', 'yarn install --frozen-lockfile', 'yarn.lock'],
    ['yarn.lock', 'yarn@2.4.3', 'yarn', 'yarn install --immutable', 'yarn.lock'],
    ['yarn.lock', 'yarn@4.1.0+sha256.abc', 'yarn', 'yarn install --immutable', 'yarn.lock'],
    ['yarn.lock', 'yarn@10.0.0', 'yarn', 'yarn install --immutable', 'yarn.lock'],
    ['bun.lock', undefined, 'bun', 'bun install --frozen-lockfile', 'bun.lock'],
    ['bun.lockb', undefined, 'bun', 'bun install --frozen-lockfile', 'bun.lockb'],
    // 같은 bun의 새 락 파일과 옛 락 파일은 충돌이 아니다. 새 쪽을 가리킨다.
    ['bun.lock bun.lockb', undefined, 'bun', 'bun install --frozen-lockfile', 'bun.lock'],
    // packageManager에는 버전 · 해시가 붙는다. 이름만 비교한다.
    ['pnpm-lock.yaml', 'pnpm@9.1.0+sha512.0123abcd', 'pnpm', 'pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
    // 알 수 없는 이름 · 모양은 없는 것으로 본다.
    ['pnpm-lock.yaml', 'deno@1.0.0', 'pnpm', 'pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
    ['pnpm-lock.yaml', 'pnpm', 'pnpm', 'pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
    ['pnpm-lock.yaml', '', 'pnpm', 'pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
  ])('lock %s + packageManager %j → %s', (lock, declared, pm, install, lockfile) => {
    const p = project('.', { ...(declared === undefined ? {} : { packageManager: declared }) }, ...lock.split(' '))
    expect(p.packageManager).toEqual({ value: pm, source: 'lockfile' })
    expect(p.install).toEqual({ value: install, source: 'lockfile' })
    expect(p.lockfile).toBe(lockfile)
  })

  it.each([
    ['two lock files of different managers', 'pnpm-lock.yaml package-lock.json', undefined, ['npm', 'pnpm']],
    ['three lock files', 'yarn.lock pnpm-lock.yaml package-lock.json', undefined, ['npm', 'pnpm', 'yarn']],
    ['packageManager that disagrees with the lock', 'pnpm-lock.yaml', 'npm@10.2.0', ['npm', 'pnpm']],
    ['packageManager that picks one of two lock files', 'pnpm-lock.yaml yarn.lock', 'pnpm@9.0.0', ['pnpm', 'yarn']],
  ])('is left for the student with %s', (_name, locks, declared, candidates) => {
    const p = project('.', { ...(declared ? { packageManager: declared } : {}), scripts: { build: 'x' } }, ...locks.split(' '))
    expect(p.packageManager).toEqual({ value: null, source: null, candidates })
    expect(p.install).toEqual({ value: null, source: null })
    expect(p.lockfile).toBeNull()
    expect(p.needsReview).toEqual(expect.arrayContaining(['packageManager', 'install']))
  })

  describe('without a lock file', () => {
    it('uses the packageManager field and a plain install', () => {
      const p = project('.', { packageManager: 'pnpm@9.1.0' })
      expect(p.packageManager).toEqual({ value: 'pnpm', source: 'package.json' })
      expect(p.install).toEqual({ value: 'pnpm install', source: 'package.json' })
      expect(p.lockfile).toBeNull()
      expect(p.needsReview).toEqual(expect.not.arrayContaining(['packageManager', 'install']))
    })

    it('falls back to npm and says it is a default', () => {
      const p = project('.', {})
      expect(p.packageManager).toEqual({ value: 'npm', source: 'default' })
      expect(p.install).toEqual({ value: 'npm install', source: 'default' })
      expect(p.lockfile).toBeNull()
    })

    it('falls back to npm when packageManager names something unknown', () => {
      expect(project('.', { packageManager: 'deno@1' }).packageManager).toEqual({ value: 'npm', source: 'default' })
    })
  })

  describe('which lock file belongs to a folder', () => {
    it('finds one in a parent folder (workspaces keep it at the root)', () => {
      const p = project('FE', {}, 'pnpm-lock.yaml')
      expect(p.packageManager).toEqual({ value: 'pnpm', source: 'lockfile' })
      expect(p.lockfile).toBe('pnpm-lock.yaml')
    })

    it('takes the nearest folder going up, not the root', () => {
      const p = project('a/b', {}, 'pnpm-lock.yaml', 'a/yarn.lock')
      expect(p.packageManager).toEqual({ value: 'yarn', source: 'lockfile' })
      expect(p.lockfile).toBe('a/yarn.lock')
    })

    it('prefers the folder itself over a parent', () => {
      const p = project('FE', {}, 'yarn.lock', 'FE/package-lock.json')
      expect(p.packageManager).toEqual({ value: 'npm', source: 'lockfile' })
      expect(p.lockfile).toBe('FE/package-lock.json')
    })

    it('does not look in a sibling folder', () => {
      const p = project('FE', {}, 'BE/pnpm-lock.yaml')
      expect(p.lockfile).toBeNull()
      expect(p.packageManager).toEqual({ value: 'npm', source: 'default' })
    })

    it('does not mix the lock files of two levels', () => {
      const p = project('FE', {}, 'FE/yarn.lock', 'pnpm-lock.yaml')
      expect(p.packageManager.candidates).toBeUndefined()
      expect(p.packageManager.value).toBe('yarn')
    })

    it('does not take a lock file whose name only contains a known one', () => {
      expect(project('.', {}, 'old-pnpm-lock.yaml', 'pnpm-lock.yaml.bak', 'yarn.lock/x').lockfile).toBeNull()
    })
  })
})

describe('build and start commands', () => {
  it('shows the run command and keeps the script text beside it', () => {
    const p = project('.', next(), 'pnpm-lock.yaml')
    expect(p.build).toEqual({ value: 'pnpm run build', script: 'next build', source: 'package.json' })
    expect(p.start).toEqual({ value: 'pnpm run start', script: 'next start', source: 'package.json' })
  })

  it('keeps a long real script as it is', () => {
    expect(project('.', vite(), 'package-lock.json').build).toEqual({ value: 'npm run build', script: 'tsc -b && vite build', source: 'package.json' })
  })

  it('does not invent a command the project does not define', () => {
    const p = project('.', next({ scripts: { dev: 'next dev' } }))
    expect(p.build).toEqual({ value: null, script: null, source: null })
    expect(p.start).toEqual({ value: null, script: null, source: null })
    expect(p.needsReview).toEqual(expect.arrayContaining(['build', 'start']))
  })

  it.each([
    ['an empty string', { build: '' }],
    ['a blank string', { build: '   ' }],
    ['a number', { build: 1 }],
    ['null', { build: null }],
  ])('treats %s as no script', (_name, scripts) => {
    expect(project('.', next({ scripts })).build.value).toBeNull()
  })

  it('treats a scripts field that is not an object as no scripts', () => {
    expect(project('.', next({ scripts: 'next build' })).build.value).toBeNull()
  })

  it('has no start command for a static site, even if a start script exists, and does not ask about it', () => {
    const p = project('.', vite({ scripts: { build: 'vite build', start: 'vite' } }))
    expect(p.start).toEqual({ value: null, script: null, source: null })
    expect(p.needsReview).not.toContain('start')
  })

  it('still reads scripts when the framework is not known', () => {
    const p = project('.', { scripts: { build: 'nest build', start: 'node dist/main' } }, 'pnpm-lock.yaml')
    expect(p.build.value).toBe('pnpm run build')
    expect(p.start).toEqual({ value: 'pnpm run start', script: 'node dist/main', source: 'package.json' })
  })

  it('shows the script but not the command while the package manager is open', () => {
    const p = project('.', next(), 'pnpm-lock.yaml', 'package-lock.json')
    expect(p.build).toEqual({ value: null, script: 'next build', source: 'package.json' })
    expect(p.start).toEqual({ value: null, script: 'next start', source: 'package.json' })
    expect(p.needsReview).toEqual(expect.arrayContaining(['build', 'start']))
  })

  it.each([
    ['yarn', 'yarn run build'],
    ['bun', 'bun run build'],
    ['npm', 'npm run build'],
  ])('uses the %s run form', (pm, expected) => {
    const lock = { yarn: 'yarn.lock', bun: 'bun.lock', npm: 'package-lock.json' }[pm] as string
    expect(project('.', next(), lock).build.value).toBe(expected)
  })
})

describe('output folder and port', () => {
  it('Vite + React: dist, and no port (static)', () => {
    const p = project('.', vite())
    expect(p.outputDir).toEqual({ value: 'dist', source: 'default' })
    expect(p.port).toEqual({ value: null, source: null })
    expect(p.needsReview).toEqual([])
  })

  it('Next.js: port 3000, and no output folder', () => {
    const p = project('.', next())
    expect(p.port).toEqual({ value: 3000, source: 'default' })
    expect(p.outputDir).toEqual({ value: null, source: null })
    expect(p.needsReview).toEqual([])
  })

  it('unknown framework: both are left for the student', () => {
    const p = project('.', { dependencies: { express: '5' } })
    expect(p.outputDir).toEqual({ value: null, source: null })
    expect(p.port).toEqual({ value: null, source: null })
    expect(p.needsReview).toEqual(expect.arrayContaining(['framework', 'outputDir', 'port']))
  })

  it('ambiguous framework: both are left for the student', () => {
    const p = project('.', { dependencies: { next: '15', react: '19' }, devDependencies: { vite: '8' } })
    expect(p.needsReview).toEqual(expect.arrayContaining(['framework', 'outputDir', 'port']))
  })
})

describe('node version', () => {
  it.each([
    [{ engines: { node: '>=22' } }, '>=22'],
    [{ engines: { npm: '>=10' } }, null],
    [{ engines: { node: 22 } }, null],
    [{ engines: '>=22' }, null],
    [{}, null],
  ])('%j → %j', (pkg, expected) => {
    expect(project('.', pkg).nodeVersion).toBe(expected)
  })
})

describe('dockerfile', () => {
  it.each([
    ['.', ['Dockerfile'], true],
    ['FE', ['FE/Dockerfile'], true],
    ['FE', ['BE/Dockerfile'], false],
    ['FE', ['Dockerfile'], false],
    ['FE', ['FE/sub/Dockerfile'], false],
    ['FE', ['FE/Dockerfile.prod'], false],
    ['.', [], false],
  ])('folder %s with %j → %s', (dir, paths, expected) => {
    expect(project(dir, {}, ...paths).dockerfile).toBe(expected)
  })
})

describe('workspace roots', () => {
  it.each([
    ['workspaces array', { workspaces: ['packages/*'] }, []],
    ['workspaces object (yarn)', { workspaces: { packages: ['packages/*'] } }, []],
    ['pnpm-workspace.yaml beside it', {}, ['pnpm-workspace.yaml']],
  ])('are not a project: %s', (_name, pkg, paths) => {
    expect(buildProject('.', pkg, files(...paths))).toBeNull()
  })

  it('is decided per folder: pnpm-workspace.yaml elsewhere does not count', () => {
    expect(buildProject('FE', {}, files('pnpm-workspace.yaml'))).not.toBeNull()
  })

  it('stays a project when it is itself a recognized app', () => {
    expect(buildProject('.', next({ workspaces: ['packages/*'] }), files())?.framework.value).toBe('nextjs')
    expect(buildProject('.', vite(), files('pnpm-workspace.yaml'))?.framework.value).toBe('vite-react')
  })

  it('stays a project when the framework is ambiguous (the student must choose)', () => {
    const both = { workspaces: ['x'], dependencies: { next: '15', react: '19' }, devDependencies: { vite: '8' } }
    expect(buildProject('.', both, files())?.framework.candidates).toEqual(['nextjs', 'vite-react'])
  })

  it.each([null, 'packages/*', 1, true])('stays a project when workspaces is not an array or object (%j)', (workspaces) => {
    expect(buildProject('BE', { workspaces, scripts: { start: 'node dist/main' } }, files())?.dir).toBe('BE')
  })

  it('stays a project when package.json could not be read', () => {
    expect(buildProject('.', undefined, files('pnpm-workspace.yaml'))).not.toBeNull()
  })
})

describe('a package.json that could not be read as an object', () => {
  it.each([undefined, null, 'text', 42, ['a']])('%j', (pkg) => {
    const p = project('FE', pkg, 'pnpm-lock.yaml', 'FE/Dockerfile')
    expect(p.framework).toEqual({ value: null, source: null })
    expect(p.language).toEqual({ value: null, source: null })
    expect(p.build).toEqual({ value: null, script: null, source: null })
    expect(p.outputDir.value).toBeNull()
    expect(p.needsReview).toEqual(['framework', 'language', 'build', 'start', 'outputDir', 'port'])
    // 락 파일과 Dockerfile은 package.json과 상관없이 알 수 있다.
    expect(p.packageManager).toEqual({ value: 'pnpm', source: 'lockfile' })
    expect(p.dockerfile).toBe(true)
  })
})

describe('needsReview', () => {
  it('lists open items in a fixed order', () => {
    const p = project('.', { dependencies: { express: '5' } }, 'pnpm-lock.yaml', 'package-lock.json')
    expect(p.needsReview).toEqual(['framework', 'packageManager', 'install', 'build', 'start', 'outputDir', 'port'])
  })
})

describe('a whole monorepo answer', () => {
  it('Vite + React front end with pnpm, a Dockerfile in the front end only', () => {
    expect(project('FE', vite({ engines: { node: '>=22' } }), 'FE/pnpm-lock.yaml', 'FE/Dockerfile')).toEqual({
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
    })
  })
})
