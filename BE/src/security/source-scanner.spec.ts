import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConfigService } from '@nestjs/config'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import { MAX_UNPACKED_BYTES, ScanError, SourceScanner } from './source-scanner.js'

// 가짜 gitleaks · trivy(셸 스크립트)와 loopback HTTP 서버의 tar.gz로 받기 · 풀기 · 도구 부르기를 본다.
// 실제 도구의 결과 모양은 findings.spec.ts가, 실제 도구 실행은 PR의 로컬 docker 시험이 본다.

const SHA = 'c'.repeat(40)
const CACHE = '/var/cache/trivy-test'
let dir: string
let out: string
let server: Server
let base: string
// 경로마다 돌려줄 답: tar.gz 파일 경로 또는 상태 코드.
const answers = new Map<string, string | number>()

function tarball(name: string, files: Record<string, string>, extra?: (root: string) => void): string {
  const root = join(dir, `${name}-src`)
  const top = join(root, `my-app-${SHA}`)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(top, path, '..'), { recursive: true })
    writeFileSync(join(top, path), text)
  }
  extra?.(top)
  const file = join(dir, `${name}.tar.gz`)
  execFileSync('tar', ['-czf', file, '-C', root, `my-app-${SHA}`])
  return file
}

function script(name: string, body: string): string {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/bash\nout=${out}\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

const GITLEAKS = `
printf '%s\\n' "$@" > $out/gitleaks.args
env > $out/gitleaks.env
pwd > $out/gitleaks.cwd
find "$2" -name .gitleaksignore > $out/gitleaks.ignorefiles
( : > "$2/new-file" ) 2>/dev/null && echo yes > $out/gitleaks.writable
printf '[{"RuleID":"aws-access-token","File":"%s/backend/config.js","StartLine":1,"Secret":"AKIAQYLPMN5HHHFPZAM2","Match":"k=AKIAQYLPMN5HHHFPZAM2"}]' "$2"`
const TRIVY = `
printf '%s\\n' "$@" > $out/trivy.args
env > $out/trivy.env
echo '{"SchemaVersion":2,"Results":[{"Target":"backend/package-lock.json","Vulnerabilities":[{"VulnerabilityID":"CVE-2021-23337","PkgName":"lodash","InstalledVersion":"4.17.15","FixedVersion":"4.17.21","Severity":"HIGH"}]}]}'`

const config = (cacheDir: string | undefined) => ({ get: () => cacheDir }) as unknown as ConfigService<Env, true>
function scanner(tools: { gitleaks?: string; trivy?: string } = {}) {
  const s = new SourceScanner(config(CACHE))
  s.tools = {
    gitleaks: tools.gitleaks ?? script('gitleaks', GITLEAKS),
    trivy: tools.trivy ?? script('trivy', TRIVY),
    archiveUrl: (repo, commit) => `${base}/${repo}/tar.gz/${commit}`,
  }
  return s
}
const scanDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith('wcp-scan-'))
// 한 줄에 하나. 빈 인자(`--config ''`)도 빈 줄로 남는다.
const lines = (name: string) => {
  const text = readFileSync(join(out, name), 'utf8')
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'scanner-spec-'))
  server = createServer((req, res) => {
    const answer = answers.get(req.url ?? '')
    if (typeof answer === 'string') {
      res.writeHead(200, { 'Content-Type': 'application/x-gzip' })
      res.end(readFileSync(answer))
    } else {
      res.writeHead(answer ?? 404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  answers.set(
    `/Student/My-App/tar.gz/${SHA}`,
    tarball('app', {
      'backend/config.js': 'const k = "AKIAQYLPMN5HHHFPZAM2"\n',
      'backend/.env': 'DB_PASSWORD=hunter2\n',
      'frontend/.env.example': 'X=\n',
      '.gitleaksignore': 'backend/config.js:aws-access-token:1\n',
      'backend/.gitleaksignore': 'x\n',
      'backend/package-lock.json': '{}\n',
    }),
  )
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  out = mkdtempSync(join(dir, 'out-'))
})

describe('SourceScanner.scan', () => {
  it('fetches the commit, runs both tools and returns secrets, committed .env files and vulnerabilities', async () => {
    const before = scanDirs()
    const found = await scanner().scan('Student/My-App', SHA)
    expect(found).toEqual([
      { kind: 'secret', file: 'backend/config.js', line: 1, rule: 'aws-access-token' },
      { kind: 'env_file', file: 'backend/.env' },
      { kind: 'vuln', target: 'backend/package-lock.json', pkg: 'lodash', version: '4.17.15', id: 'CVE-2021-23337', severity: 'HIGH', fixed: '4.17.21' },
    ])
    expect(JSON.stringify(found)).not.toContain('AKIA')
    // 작업 폴더는 남지 않는다.
    expect(scanDirs()).toEqual(before)
  })

  it("gives the tools no server settings: only PATH, HOME and TMPDIR, and a folder outside the repo", async () => {
    await scanner().scan('Student/My-App', SHA)
    for (const name of ['gitleaks.env', 'trivy.env']) {
      const keys = lines(name).map((l) => l.split('=')[0]).filter((k) => !['PWD', 'SHLVL', '_', 'OLDPWD'].includes(k))
      expect(keys.sort()).toEqual(['HOME', 'PATH', 'TMPDIR'])
      expect(readFileSync(join(out, name), 'utf8')).not.toContain('sb_secret_test')
    }
    const src = lines('gitleaks.args')[1]
    expect(lines('gitleaks.cwd')[0].startsWith(src)).toBe(false)
  })

  it('makes the repo read-only, leaves out .gitleaksignore and passes our config instead of the repo settings', async () => {
    await scanner().scan('Student/My-App', SHA)
    expect(() => readFileSync(join(out, 'gitleaks.writable'))).toThrow()
    expect(lines('gitleaks.ignorefiles')).toEqual([])
    const g = lines('gitleaks.args')
    expect(g[g.indexOf('--config') + 1]).toMatch(/\/security\/gitleaks\.toml$/)
    expect(g).toContain('--ignore-gitleaks-allow')
    expect(g).toContain('--redact')
    const t = lines('trivy.args')
    expect(t).toEqual(expect.arrayContaining(['--skip-db-update', '--offline-scan', '--cache-dir', CACHE, '--ignorefile', '--config']))
    expect(t[t.indexOf('--ignorefile') + 1]).toBe('')
    expect(t[t.indexOf('--config') + 1]).toBe('')
  })

  it.each([
    ['the commit cannot be fetched', 404, 'SOURCE_FETCH_FAILED'],
    ['the archive is not a gzip file', 'not-gzip', 'SOURCE_FETCH_FAILED'],
  ])('fails with a code when %s', async (_, answer, code) => {
    const sha = 'd'.repeat(40)
    if (answer === 'not-gzip') {
      const file = join(dir, 'plain.txt')
      writeFileSync(file, 'hello')
      answers.set(`/Student/My-App/tar.gz/${sha}`, file)
    } else answers.set(`/Student/My-App/tar.gz/${sha}`, answer)
    const before = scanDirs()
    await expect(scanner().scan('Student/My-App', sha)).rejects.toEqual(new ScanError(code as 'SOURCE_FETCH_FAILED'))
    expect(scanDirs()).toEqual(before)
  })

  it('stops a repo that unpacks larger than the limit', { timeout: 30_000 }, async () => {
    const sha = 'e'.repeat(40)
    answers.set(
      `/Student/My-App/tar.gz/${sha}`,
      tarball('big', { 'a.txt': 'a' }, (top) => execFileSync('truncate', ['-s', String(MAX_UNPACKED_BYTES + 1024 * 1024), join(top, 'zeros.bin')])),
    )
    await expect(scanner().scan('Student/My-App', sha)).rejects.toEqual(new ScanError('SOURCE_TOO_LARGE'))
  })

  it.each([
    ['gitleaks exits with an error', { gitleaks: 'exit 2' }, 'GITLEAKS_FAILED'],
    ['gitleaks prints something that is not its report', { gitleaks: 'echo "{}"' }, 'GITLEAKS_FAILED'],
    ['trivy exits with an error (no DB)', { trivy: 'echo "FATAL db" >&2; exit 1' }, 'TRIVY_FAILED'],
    ['trivy prints another schema', { trivy: `echo '{"SchemaVersion":3}'` }, 'TRIVY_FAILED'],
    ['a tool is missing', { trivy: null }, 'TRIVY_FAILED'],
  ])('fails with a code (not "nothing found") when %s', async (_, bodies, code) => {
    const tools = Object.fromEntries(
      Object.entries(bodies).map(([name, body]) => [name, body === null ? join(dir, 'no-such-tool') : script(`${name}-bad`, body)]),
    )
    await expect(scanner(tools).scan('Student/My-App', SHA)).rejects.toEqual(new ScanError(code as 'TRIVY_FAILED'))
  })

  it('is off without a Trivy DB folder', () => {
    expect(new SourceScanner(config(undefined)).enabled).toBe(false)
    expect(new SourceScanner(config('')).enabled).toBe(false)
    expect(new SourceScanner(config(CACHE)).enabled).toBe(true)
  })
})
