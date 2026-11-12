import { Injectable, Logger } from '@nestjs/common'
import { type DeployRow, DeploysStore, type ScanRow } from '../deploys/deploys.store.js'
import { type DeployWarning, readFindings, toWarnings } from './findings.js'
import { ScanError, SourceScanner } from './source-scanner.js'

/** 이보다 오래 running인 기록은 서버가 검사 중에 멈춘 것으로 본다(도구 · 받기 상한의 합보다 길다). */
export const STALE_SCAN_MS = 15 * 60_000

const warning = (code: string, message: string): DeployWarning => ({ code, message, service: null })
export const SCAN_RUNNING = warning('SCAN_RUNNING', '보안 검사가 아직 끝나지 않았어요. 잠시 뒤 새로 고침하면 결과가 보여요.')
// "문제 없음"으로 대신하지 않는다(FR-096).
export const SCAN_FAILED = warning('SCAN_FAILED', '보안 검사를 끝내지 못했어요. 문제가 없다는 뜻은 아니에요.')
export const SCAN_UNAVAILABLE = warning('SCAN_UNAVAILABLE', '이 서버에는 보안 검사가 설정되어 있지 않아 검사하지 못했어요.')

const isStale = (row: ScanRow, now: number) => now - Date.parse(row.started_at) > STALE_SCAN_MS

/**
 * 보안 검사(UC-10, #45). 배포와 따로 돌고 배포를 막지 않는다(FR-097): 요청은 기다리지 않고, 결과는 진행 상태의 `warnings`로 보인다.
 * 같은 레포 · commit은 한 번만 검사한다. EC2 메모리를 GoCD 등과 같이 쓰므로 한 번에 하나만 돈다.
 */
@Injectable()
export class SecurityScanService {
  private readonly logger = new Logger(SecurityScanService.name)
  private queue: Promise<void> = Promise.resolve()
  private readonly queued = new Set<string>()

  constructor(
    private readonly store: DeploysStore,
    private readonly scanner: SourceScanner,
  ) {}

  /** 검사를 줄에 세운다. 기다리지 않는다. 이미 끝났거나 도는 중이면 아무것도 하지 않는다. */
  request(repo: string, commit: string): void {
    const key = `${repo}@${commit}`
    if (!this.scanner.enabled || this.queued.has(key)) return
    this.queued.add(key)
    this.queue = this.queue
      .then(() => this.run(repo, commit))
      .catch((err: unknown) => this.logger.error(`security scan of ${key} stopped: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => this.queued.delete(key))
  }

  /** 줄에 선 검사가 모두 끝날 때까지(시험용). */
  idle(): Promise<void> {
    return this.queue
  }

  /** 배포의 경고. 기록을 읽지 못해도 진행 상태 응답은 그대로 내고 SCAN_FAILED로 알린다. */
  async warningsFor(deploy: DeployRow): Promise<DeployWarning[]> {
    let row: ScanRow | undefined
    try {
      row = await this.store.findScan(deploy.repo, deploy.commit_sha)
    } catch {
      return [SCAN_FAILED]
    }
    if (row?.status === 'done') {
      const findings = readFindings(row.findings)
      return findings ? toWarnings(findings, deploy.spec) : [SCAN_FAILED]
    }
    // 실패는 다시 저장할 때 다시 검사한다(읽을 때마다 받으면 늘 실패하는 레포를 3초마다 다시 받는다).
    if (row?.status === 'failed') return [SCAN_FAILED]
    if (row && !isStale(row, Date.now())) return [SCAN_RUNNING]
    // 기록이 없거나(이 기능 전에 만든 배포 · 저장 직후 요청이 실패함) running이 오래됐으면 지금 검사를 시작한다.
    if (!this.scanner.enabled) return [row ? SCAN_FAILED : SCAN_UNAVAILABLE]
    this.request(deploy.repo, deploy.commit_sha)
    return [SCAN_RUNNING]
  }

  private async run(repo: string, commit: string): Promise<void> {
    const row = await this.store.findScan(repo, commit)
    const now = Date.now()
    if (row && (row.status === 'done' || (row.status === 'running' && !isStale(row, now)))) return
    const startedAt = new Date(now).toISOString()
    const base = { repo, commit_sha: commit, started_at: startedAt }
    await this.store.saveScan({ ...base, status: 'running', findings: [], error: null, finished_at: null })
    try {
      const findings = await this.scanner.scan(repo, commit)
      await this.store.saveScan({ ...base, status: 'done', findings, error: null, finished_at: new Date().toISOString() })
      this.logger.log(`security scan of ${repo}@${commit}: ${findings.length} findings in ${Date.now() - now}ms`)
    } catch (err) {
      const code = err instanceof ScanError ? err.code : 'SCAN_ERROR'
      if (!(err instanceof ScanError)) this.logger.error(err)
      await this.store.saveScan({ ...base, status: 'failed', findings: [], error: code, finished_at: new Date().toISOString() })
      this.logger.warn(`security scan of ${repo}@${commit} failed: ${code}`)
    }
  }
}
