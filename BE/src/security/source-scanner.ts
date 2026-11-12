import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.js'
import { envFiles, type Finding, MAX_FINDINGS, parseGitleaks, parseTrivy } from './findings.js'

// 확정 commit의 파일 트리를 받아 gitleaks(비밀값) · Trivy(의존성 취약점)로 검사한다(UC-10, #45, ADR-010).
// 학생 코드는 읽기만 하고 실행하지 않는다. 레포 안의 설정(.gitleaks.toml · .gitleaksignore · trivy.yaml · .trivyignore)과
// `gitleaks:allow` 주석은 검사를 바꾸지 못한다. 도구에는 서버의 env(Supabase · GitHub 키 등)를 넘기지 않는다.

/** 받는 압축 파일과 푼 크기의 상한. 넘으면 검사하지 않고 실패로 남긴다. */
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
export const MAX_UNPACKED_BYTES = 300 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000
const TOOL_TIMEOUT_MS = 180_000
const TOOL_OUTPUT_BYTES = 20 * 1024 * 1024
// 우리 gitleaks 설정(기본 규칙 그대로). dist/security와 src/security 어디서 불러도 BE/security를 가리킨다.
const GITLEAKS_CONFIG = fileURLToPath(new URL('../../security/gitleaks.toml', import.meta.url))
// 도구 · tar · chmod에 넘기는 env는 이 PATH뿐이다(서버 키를 넘기지 않는다).
const PATH = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'

/** 검사가 끝나지 못한 이유(내부 코드. DB에만 남기고 학생에게는 SCAN_FAILED로 보인다). */
export class ScanError extends Error {
  constructor(readonly code: 'SOURCE_TOO_LARGE' | 'SOURCE_FETCH_FAILED' | 'GITLEAKS_FAILED' | 'TRIVY_FAILED') {
    super(code)
  }
}

export interface ScanTools {
  gitleaks: string
  trivy: string
  /** commit의 tar.gz 주소. 공개 레포만 받으므로 인증을 붙이지 않는다. */
  archiveUrl: (repo: string, commit: string) => string
}

const DEFAULT_TOOLS: ScanTools = {
  gitleaks: 'gitleaks',
  trivy: 'trivy',
  archiveUrl: (repo, commit) => `https://codeload.github.com/${repo}/tar.gz/${commit}`,
}

/** 흘려보내며 바이트를 센다. 상한을 넘으면 ScanError로 멈춘다. */
class Limit extends Transform {
  private seen = 0
  constructor(private readonly max: number) {
    super()
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.seen += chunk.length
    if (this.seen > this.max) return done(new ScanError('SOURCE_TOO_LARGE'))
    done(null, chunk)
  }
}

@Injectable()
export class SourceScanner {
  /** 도구와 받는 주소. 시험이 가짜로 바꾼다. */
  tools: ScanTools = DEFAULT_TOOLS
  /** Trivy 취약점 DB 폴더. 비어 있으면 이 서버는 검사하지 않는다(요청 중에는 DB를 받지 않는다). */
  readonly cacheDir: string | undefined

  constructor(config: ConfigService<Env, true>) {
    this.cacheDir = config.get('TRIVY_CACHE_DIR', { infer: true })
  }

  get enabled(): boolean {
    // 빈 문자열도 설정 안 함으로 본다(복사한 .env.example의 `TRIVY_CACHE_DIR=`).
    return Boolean(this.cacheDir)
  }

  /** repo(`owner/name`) · commit의 찾은 것. 받지 못하거나 도구가 실패하면 ScanError(그 밖의 오류는 그대로). */
  async scan(repo: string, commit: string): Promise<Finding[]> {
    if (!this.cacheDir) throw new Error('security scan is not configured (TRIVY_CACHE_DIR)')
    const work = await mkdtemp(join(tmpdir(), 'wcp-scan-'))
    const src = join(work, 'src')
    // 도구의 HOME · TMPDIR · 작업 폴더. 레포 밖이라 레포의 설정 파일을 읽지 않는다.
    const home = join(work, 'home')
    try {
      await mkdir(src)
      await mkdir(home)
      await this.fetchSource(repo, commit, src)
      const paths = await listFiles(src)
      // 푼 레포를 읽기 전용으로 둔다(도구는 읽기만 한다).
      await run('chmod', ['-R', 'a-w', src])
      const secrets = await this.gitleaks(src, home)
      const vulns = await this.trivy(src, home, this.cacheDir)
      return [...secrets, ...envFiles(paths), ...vulns].slice(0, MAX_FINDINGS)
    } finally {
      await run('chmod', ['-R', 'u+w', work]).catch(() => undefined)
      await rm(work, { recursive: true, force: true })
    }
  }

  private async fetchSource(repo: string, commit: string, dest: string): Promise<void> {
    let res: Response
    try {
      // 다른 곳으로 넘겨 주는 답은 따라가지 않는다.
      res = await fetch(this.tools.archiveUrl(repo, commit), {
        headers: { 'User-Agent': 'woowangthon-platform' },
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      throw new ScanError('SOURCE_FETCH_FAILED')
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel()
      throw new ScanError('SOURCE_FETCH_FAILED')
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_ARCHIVE_BYTES) {
      await res.body.cancel()
      throw new ScanError('SOURCE_TOO_LARGE')
    }
    // GNU tar는 절대 경로와 `..`를 지우고 푼다. 첫 폴더(`<repo>-<sha>/`)는 벗긴다. .gitleaksignore는 풀지 않는다.
    const tar = spawn('tar', ['-x', '-f', '-', '-C', dest, '--strip-components=1', '--no-same-owner', '--no-same-permissions', '--exclude=.gitleaksignore'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { PATH },
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      tar.on('error', reject)
      tar.on('close', resolve)
    })
    try {
      await pipeline(
        Readable.fromWeb(res.body),
        new Limit(MAX_ARCHIVE_BYTES),
        createGunzip(),
        new Limit(MAX_UNPACKED_BYTES),
        tar.stdin,
      )
    } catch (err) {
      tar.kill('SIGKILL')
      await exited.catch(() => undefined)
      throw err instanceof ScanError ? err : new ScanError('SOURCE_FETCH_FAILED')
    }
    if ((await exited) !== 0) throw new ScanError('SOURCE_FETCH_FAILED')
  }

  private async gitleaks(src: string, home: string): Promise<Finding[]> {
    const args = [
      'dir', src,
      '--config', GITLEAKS_CONFIG,
      // .gitleaksignore를 레포가 아닌 빈 폴더에서 찾게 한다.
      '--gitleaks-ignore-path', home,
      '--ignore-gitleaks-allow',
      '--redact',
      '--no-banner',
      '--log-level', 'error',
      '--exit-code', '0',
      '--max-target-megabytes', '5',
      '--report-format', 'json',
      '--report-path', '-',
    ]
    // 실행 실패와 모양이 틀린 보고서 모두 실패다("찾은 것 없음"이 아니다).
    try {
      return parseGitleaks(JSON.parse(await tool(this.tools.gitleaks, home, args)), src)
    } catch {
      throw new ScanError('GITLEAKS_FAILED')
    }
  }

  private async trivy(src: string, home: string, cacheDir: string): Promise<Finding[]> {
    const args = [
      'fs',
      '--scanners', 'vuln',
      '--severity', 'HIGH,CRITICAL',
      // 요청 중에는 DB를 받지 않는다(Infra/aws/deploy-be.sh가 배포할 때 받아 둔다).
      '--skip-db-update', '--skip-java-db-update', '--offline-scan',
      '--skip-version-check', '--disable-telemetry',
      '--cache-dir', cacheDir,
      '--cache-backend', 'memory',
      // 레포나 작업 폴더의 trivy.yaml · .trivyignore를 읽지 않는다.
      '--config', '',
      '--ignorefile', '',
      '--list-all-pkgs=false',
      '--timeout', '3m',
      '--quiet',
      '--format', 'json',
      src,
    ]
    try {
      return parseTrivy(JSON.parse(await tool(this.tools.trivy, home, args)))
    } catch {
      throw new ScanError('TRIVY_FAILED')
    }
  }
}

/** 검사한 폴더 기준 파일 경로(링크 · 폴더 제외). */
async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter((e) => e.isFile()).map((e) => relative(root, join(e.parentPath, e.name)))
}

const execFileAsync = promisify(execFile)

/** 도구를 서버 env 없이 돌린다: PATH · HOME · TMPDIR만 넘기고, 작업 폴더는 레포 밖의 빈 폴더다. */
async function tool(cmd: string, home: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd: home,
    env: { PATH, HOME: home, TMPDIR: home },
    timeout: TOOL_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: TOOL_OUTPUT_BYTES,
  })
  return stdout
}

async function run(cmd: string, args: string[]): Promise<void> {
  await execFileAsync(cmd, args, { env: { PATH } })
}
