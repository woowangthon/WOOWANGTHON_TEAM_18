import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Infra/build/build.sh를 가짜 git · iptables · docker · aws로 돌린다. 가짜 명령은 부른 인자를 로그에 한 줄씩(인자는 \x1f로 구분) 남긴다.
const SCRIPT = fileURLToPath(new URL('../../build/build.sh', import.meta.url))
const DOCKERFILES = fileURLToPath(new URL('../../build/dockerfiles/', import.meta.url))
const REPO = 'ghcr.io/woowang-bot/student-apps'
const DIGEST = `${REPO}@sha256:${'d'.repeat(64)}`
const TOKEN = 'ghp_faketoken0123456789'

const FAKE = `#!/usr/bin/env bash
name="$(basename "$0")"
( IFS=$'\x1f'; printf '%s\x1f%s\n' "$name" "$*" ) >> "$FAKE_LOG"
case "$name" in
  git)
    [ "$1" = init ] && mkdir -p "$3"
    [ "$3" = fetch ] && [ -n "\${FAKE_FETCH_FAIL:-}" ] && exit 1
    exit 0 ;;
  iptables) exit "\${FAKE_IPTABLES:-0}" ;;
  aws) printf '%s\n' "$FAKE_TOKEN" ;;
  docker)
    case "$1" in
      build) exit "\${FAKE_BUILD:-0}" ;;
      image)
        case "$4" in
          '{{.Size}}') echo "$FAKE_SIZE" ;;
          '{{.Config.User}}') echo "$FAKE_USER" ;;
          '{{index .RepoDigests 0}}') echo "$FAKE_DIGEST" ;;
        esac ;;
      login) cat > "$FAKE_LOGIN"; exit "\${FAKE_LOGIN_FAIL:-0}" ;;
      push) exit "\${FAKE_PUSH:-0}" ;;
    esac ;;
esac
`

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-sh-'))
  for (const name of ['git', 'iptables', 'docker', 'aws']) {
    writeFileSync(join(dir, name), FAKE)
    chmodSync(join(dir, name), 0o755)
  }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const baseEnv = () => ({
  SOURCE_REPO: 'student/my-app',
  SOURCE_COMMIT: 'a'.repeat(40),
  BUILD_CONTEXT: 'FE',
  FRAMEWORK: 'vite-react',
  APP_DIR: '.',
  NODE_VERSION: '22',
  INSTALL_CMD: 'pnpm install --frozen-lockfile',
  BUILD_CMD: 'pnpm run build',
  OUTPUT_DIR: 'dist',
  BUILD_ENV_B64: Buffer.from('VITE_API_URL=/api\0VITE_TITLE=a b "c" =d').toString('base64'),
  IMAGE_REPO: REPO,
  IMAGE_TAG: 'my-app-fe-111111111111',
  GHCR_USER: 'woowang-bot',
  GHCR_TOKEN_SECRET_ID: 'ghcr-push-token',
  FAKE_TOKEN: TOKEN,
  FAKE_SIZE: '73695853',
  FAKE_USER: '101',
  FAKE_DIGEST: DIGEST,
})

function run(env: Record<string, string | undefined> = {}) {
  const merged = { ...baseEnv(), ...env }
  const clean = Object.fromEntries(Object.entries(merged).filter((e): e is [string, string] => e[1] !== undefined))
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, ...clean, FAKE_LOG: join(dir, 'log'), FAKE_LOGIN: join(dir, 'login'), DIGEST_FILE: join(dir, 'digest') },
  })
  let log: string[][] = []
  try {
    log = readFileSync(join(dir, 'log'), 'utf8').trimEnd().split('\n').map((l) => l.split('\x1f'))
  } catch {
    // 아무것도 부르지 않았다.
  }
  const calls = (name: string) => log.filter((l) => l[0] === name).map((l) => l.slice(1))
  const read = (file: string) => {
    try {
      return readFileSync(join(dir, file), 'utf8')
    } catch {
      return undefined
    }
  }
  return { status: result.status, out: result.stdout + result.stderr, calls, digest: read('digest'), login: read('login') }
}

const buildArgs = (call: string[]) => call.flatMap((a, i) => (call[i - 1] === '--build-arg' ? [a] : []))

describe('build.sh', () => {
  it('fetches the commit, builds with the default Dockerfile and the build values, pushes and writes the digest', () => {
    const r = run()
    expect(r.status).toBe(0)
    expect(r.digest).toBe(DIGEST)
    expect(r.out).toContain(`pushed ${REPO}:my-app-fe-111111111111 as ${DIGEST}`)

    const [init, fetch] = r.calls('git')
    expect(init.slice(0, 2)).toEqual(['init', '-q'])
    const src = init[2]
    expect(fetch).toEqual(['-C', src, 'fetch', '-q', '--depth', '1', 'https://github.com/student/my-app.git', 'a'.repeat(40)])

    const build = r.calls('docker').find((c) => c[0] === 'build')!
    expect(build.slice(0, 6)).toEqual(['build', '--pull', '-f', `${DOCKERFILES}vite-react.Dockerfile`, '-t', `${REPO}:my-app-fe-111111111111`])
    expect(build.at(-1)).toBe(`${src}/FE`)
    expect(buildArgs(build)).toEqual([
      'VITE_API_URL=/api',
      'VITE_TITLE=a b "c" =d',
      'NODE_VERSION=22',
      'APP_DIR=.',
      'INSTALL_CMD=pnpm install --frozen-lockfile',
      'BUILD_CMD=pnpm run build',
      'START_CMD=',
      'OUTPUT_DIR=dist',
      `BUILD_ENV_B64=${baseEnv().BUILD_ENV_B64}`,
    ])
    expect(r.calls('docker').map((c) => c[0])).toEqual(['build', 'image', 'image', 'login', 'push', 'logout', 'image'])
  })

  it('builds with the student Dockerfile, passing only buildEnv as build args', () => {
    const r = run({ DOCKERFILE: 'BE/Dockerfile', BUILD_CONTEXT: '.', FRAMEWORK: undefined, INSTALL_CMD: undefined, BUILD_CMD: undefined, OUTPUT_DIR: undefined, NODE_VERSION: undefined, BUILD_ENV_B64: Buffer.from('A=1').toString('base64') })
    expect(r.status).toBe(0)
    const src = r.calls('git')[0][2]
    const build = r.calls('docker').find((c) => c[0] === 'build')!
    expect(build.slice(0, 4)).toEqual(['build', '--pull', '-f', `${src}/BE/Dockerfile`])
    expect(buildArgs(build)).toEqual(['A=1'])
    expect(build.at(-1)).toBe(`${src}/.`)
  })

  it('passes no buildEnv build args when there is none', () => {
    const r = run({ DOCKERFILE: 'BE/Dockerfile', BUILD_ENV_B64: undefined })
    expect(buildArgs(r.calls('docker').find((c) => c[0] === 'build')!)).toEqual([])
  })

  it('blocks the link-local metadata addresses before building', () => {
    const r = run()
    expect(r.calls('iptables')[0]).toEqual(['-I', 'DOCKER-USER', '-d', '169.254.0.0/16', '-j', 'DROP'])
  })

  it('does not build when the metadata addresses cannot be blocked', () => {
    const r = run({ FAKE_IPTABLES: '1' })
    expect(r.status).toBe(1)
    expect(r.out).toContain('PLATFORM_ERROR METADATA_BLOCK')
    expect(r.calls('docker')).toEqual([])
  })

  it('gives the token to docker login on stdin only, and never prints it', () => {
    const r = run()
    expect(r.calls('aws')).toEqual([['secretsmanager', 'get-secret-value', '--secret-id', 'ghcr-push-token', '--query', 'SecretString', '--output', 'text']])
    expect(r.login).toBe(`${TOKEN}\n`)
    expect(r.calls('docker').find((c) => c[0] === 'login')).toEqual(['login', 'ghcr.io', '-u', 'woowang-bot', '--password-stdin'])
    expect(r.out).not.toContain(TOKEN)
    expect(JSON.stringify(r.calls('docker'))).not.toContain(TOKEN)
  })

  it('stops before reading the token when the student build fails', () => {
    const r = run({ FAKE_BUILD: '1' })
    expect(r.status).not.toBe(0)
    expect(r.calls('aws')).toEqual([])
    expect(r.digest).toBeUndefined()
  })

  it('stops with SOURCE_FETCH when the commit cannot be fetched', () => {
    const r = run({ FAKE_FETCH_FAIL: '1' })
    expect(r.status).toBe(1)
    expect(r.out).toContain('PLATFORM_ERROR SOURCE_FETCH')
    expect(r.calls('docker')).toEqual([])
  })

  it('refuses an image over 2 GiB before pushing', () => {
    const r = run({ FAKE_SIZE: String(2 * 1024 ** 3 + 1) })
    expect(r.status).toBe(1)
    expect(r.out).toContain(`IMAGE_TOO_LARGE ${2 * 1024 ** 3 + 1} bytes > ${2 * 1024 ** 3} bytes`)
    expect(r.calls('aws')).toEqual([])
  })

  it('accepts an image of exactly 2 GiB', () => {
    expect(run({ FAKE_SIZE: String(2 * 1024 ** 3) }).status).toBe(0)
  })

  it.each(['', 'root', '0'])('warns, but still pushes, when the image runs as root (user "%s")', (user) => {
    const r = run({ FAKE_USER: user })
    expect(r.status).toBe(0)
    expect(r.out).toContain('WARNING IMAGE_RUNS_AS_ROOT')
  })

  it('does not warn for a non-root user', () => {
    expect(run({ FAKE_USER: 'node' }).out).not.toContain('WARNING')
  })

  it.each([
    ['GHCR_LOGIN', { FAKE_LOGIN_FAIL: '1' }],
    ['GHCR_PUSH', { FAKE_PUSH: '1' }],
    ['NO_IMAGE_DIGEST', { FAKE_DIGEST: `ghcr.io/other/student-apps@sha256:${'d'.repeat(64)}` }],
    ['NO_IMAGE_DIGEST', { FAKE_DIGEST: '' }],
  ])('reports PLATFORM_ERROR %s', (code, env) => {
    const r = run(env)
    expect(r.status).toBe(1)
    expect(r.out).toContain(`PLATFORM_ERROR ${code}`)
    expect(r.digest).toBeUndefined()
  })
})
