import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Infra/aws/deploy-ai.sh · deploy-be.sh(플랫폼 EC2 배포)를 임시 git 저장소에서 그대로 돌린다. aws · docker · curl은 PATH 앞의 가짜다.
// 가짜 docker build가 받은 빌드 컨텍스트의 권한을 기록한다: 스크립트는 env 파일을 위해 umask 077을 걸고, root가 아닌 tar는 풀 때 umask를
// 적용하므로, 풀기를 umask 022로 하지 않으면 컨텍스트가 0600 · 0700이 되어 이미지의 root가 아닌 사용자가 읽지 못한다(EC2에서 wcp-ai가 죽었다).
// root의 tar는 아카이브의 권한을 그대로 두어 이 차이가 드러나지 않으므로 root로는 돌리지 않는다(GitHub Actions 러너는 root가 아니다).
const AWS_DIR = fileURLToPath(new URL('../../aws/', import.meta.url))
const asRoot = process.getuid?.() === 0

// 가짜 aws: get-parameters-by-path의 Parameters[].[Name,Value]만 탭으로 답한다(여러 줄 값 질의에는 빈 답).
const FAKE_AWS = `#!/usr/bin/env bash
path= query=
while [[ $# -gt 0 ]]; do case $1 in --path) path=$2; shift;; --query) query=$2; shift;; esac; shift; done
[[ $query == *contains* ]] && exit 0
while IFS='=' read -r k v; do [[ -n $k ]] && printf '%s/%s\\t%s\\n' "$path" "$k" "$v"; done < "$FAKE_SSM/\${path##*/}.env"
`
// 가짜 docker: build는 컨텍스트 안 모든 파일 · 폴더의 권한(8진수)과 경로를 기록한다. 컨테이너 · 이전 컨테이너는 없는 것으로, 나머지는 성공한다.
const FAKE_DOCKER = `#!/usr/bin/env bash
case $1 in
  build) (cd "$4" && find . -mindepth 1 -printf '%m %y %P\\n') > "$FAKE_LOG.context" ;;
  container|stop) exit 1 ;;
esac
exit 0
`

let root: string
let home: string

function write(path: string, text: string, mode = 0o644) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  chmodSync(path, mode)
}
const git = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deploy-scripts-'))
  home = join(root, '.home')
  for (const name of ['deploy-ai.sh', 'deploy-be.sh']) {
    mkdirSync(join(root, 'Infra/aws'), { recursive: true })
    copyFileSync(join(AWS_DIR, name), join(root, 'Infra/aws', name))
  }
  // 이미지가 컨텍스트에서 바로 COPY하는 파일과 하위 폴더(AI ai_server/, BE security/).
  write(join(root, 'AI/Dockerfile'), 'FROM scratch\n')
  write(join(root, 'AI/ai_server/__init__.py'), '')
  write(join(root, 'BE/Dockerfile'), 'FROM scratch\n')
  write(join(root, 'BE/security/gitleaks.toml'), '[extend]\n')
  write(join(root, '.gitignore'), '.home/\n.bin/\n.ssm/\n.log*\n')
  for (const [name, text] of [
    ['aws', FAKE_AWS],
    ['docker', FAKE_DOCKER],
    ['curl', '#!/usr/bin/env bash\nexit 0\n'],
  ]) write(join(root, '.bin', name), text, 0o755)
  write(join(root, '.ssm/ai.env'), 'AGENT_API_TOKEN=test-token-not-a-secret\nGATEWAY_URL=http://wcp-be:3100/mcp\n')
  write(join(root, '.ssm/be.env'), 'SUPABASE_SECRET_KEY=test-key-not-a-secret\n')
  git('init', '-q', '-b', 'main')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '.')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init')
  // 스크립트는 git fetch origin 뒤 origin/main을 빌드한다. origin은 이 저장소 자신이다.
  git('remote', 'add', 'origin', root)
  mkdirSync(home)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function deploy(name: 'deploy-ai.sh' | 'deploy-be.sh') {
  const r = spawnSync('bash', [join(root, 'Infra/aws', name)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${join(root, '.bin')}:${process.env.PATH ?? ''}`,
      HOME: home,
      XDG_RUNTIME_DIR: home,
      TRIVY_DIR: join(home, 'trivy'),
      FAKE_SSM: join(root, '.ssm'),
      FAKE_LOG: join(root, '.log'),
    },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const context = () =>
  readFileSync(join(root, '.log.context'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(' ') as [string, string, string])

describe.skipIf(asRoot)('Infra/aws deploy scripts (as a non-root user)', () => {
  it.each([
    ['deploy-ai.sh', 'ai', ['Dockerfile', 'ai_server', 'ai_server/__init__.py']],
    ['deploy-be.sh', 'be', ['Dockerfile', 'security', 'security/gitleaks.toml']],
  ] as const)('%s unpacks the build context readable to every user (files 0644, folders 0755) and keeps the env file 0600', (script, env, paths) => {
    const r = deploy(script)
    expect(r.out).toContain('is up')
    expect(r.code).toBe(0)
    const modes = Object.fromEntries(context().map(([mode, type, path]) => [path, `${type} ${mode}`]))
    expect(modes).toEqual(Object.fromEntries(paths.map((p) => [p, p.includes('.') || p === 'Dockerfile' ? 'f 644' : 'd 755'])))
    expect(statSync(join(home, `.config/wcp/${env}.env`)).mode & 0o777).toBe(0o600)
  })
})
