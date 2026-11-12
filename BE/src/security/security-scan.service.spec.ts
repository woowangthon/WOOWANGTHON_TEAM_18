import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeployRow, DeploysStore, ScanRow } from '../deploys/deploys.store.js'
import type { Finding } from './findings.js'
import { SCAN_FAILED, SCAN_RUNNING, SCAN_UNAVAILABLE, STALE_SCAN_MS, SecurityScanService } from './security-scan.service.js'
import { ScanError, type SourceScanner } from './source-scanner.js'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const SECRET: Finding = { kind: 'secret', file: 'backend/config.js', line: 3, rule: 'aws-access-token' }

let rows: Map<string, ScanRow>
let saved: ScanRow[]
let scan: (repo: string, commit: string) => Promise<Finding[]>
let enabled: boolean

const store = {
  findScan: vi.fn((repo: string, commit: string) => Promise.resolve(rows.get(`${repo}@${commit}`))),
  saveScan: vi.fn((row: ScanRow) => {
    saved.push({ ...row })
    rows.set(`${row.repo}@${row.commit_sha}`, { ...row })
    return Promise.resolve()
  }),
}
const scanner = {
  get enabled() {
    return enabled
  },
  scan: vi.fn((repo: string, commit: string) => scan(repo, commit)),
}
const service = () => new SecurityScanService(store as unknown as DeploysStore, scanner as unknown as SourceScanner)
const deploy = (commit = SHA): DeployRow =>
  ({ id: 'd', user_id: 'u', slug: 'my-app', repo: 'Student/My-App', commit_sha: commit, spec: { project: { slug: 'my-app', repo: 'student/my-app' }, services: [{ name: 'be', dir: 'backend' }] }, created_at: '' }) as unknown as DeployRow
const row = (over: Partial<ScanRow>): ScanRow => ({
  repo: 'Student/My-App',
  commit_sha: SHA,
  status: 'done',
  findings: [],
  error: null,
  started_at: new Date().toISOString(),
  finished_at: null,
  ...over,
})

beforeEach(() => {
  rows = new Map()
  saved = []
  enabled = true
  scan = () => Promise.resolve([SECRET])
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('request', () => {
  it('records running, then the findings, without making the caller wait', async () => {
    let finish!: () => void
    scan = () => new Promise((resolve) => (finish = () => resolve([SECRET])))
    const s = service()
    s.request('Student/My-App', SHA)
    await vi.waitFor(() => expect(scanner.scan).toHaveBeenCalledOnce())
    expect(saved.map((r) => r.status)).toEqual(['running'])
    finish()
    await s.idle()
    expect(saved.at(-1)).toMatchObject({ status: 'done', findings: [SECRET], error: null })
    expect(saved.at(-1)?.finished_at).toEqual(expect.any(String))
  })

  it('runs one scan at a time, in the order they were asked', async () => {
    const order: string[] = []
    let running = 0
    let most = 0
    scan = async (_, commit) => {
      most = Math.max(most, ++running)
      order.push(commit)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return []
    }
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', OTHER_SHA)
    await s.idle()
    expect(most).toBe(1)
    expect(order).toEqual([SHA, OTHER_SHA])
  })

  it('asks once for the same repo and commit while it is queued or running', async () => {
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', SHA)
    await s.idle()
    expect(scanner.scan).toHaveBeenCalledOnce()
  })

  it('does not scan a commit that is done, or running and fresh', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'done' }))
    rows.set(`Student/My-App@${OTHER_SHA}`, row({ commit_sha: OTHER_SHA, status: 'running' }))
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', OTHER_SHA)
    await s.idle()
    expect(scanner.scan).not.toHaveBeenCalled()
  })

  it('scans again a commit that failed, or whose running record is stale (the server stopped mid-scan)', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'failed', error: 'TRIVY_FAILED' }))
    rows.set(`Student/My-App@${OTHER_SHA}`, row({ commit_sha: OTHER_SHA, status: 'running', started_at: new Date(Date.now() - STALE_SCAN_MS - 1000).toISOString() }))
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', OTHER_SHA)
    await s.idle()
    expect(scanner.scan).toHaveBeenCalledTimes(2)
  })

  it('records a failed scan with its internal code and keeps going with the next one', async () => {
    scan = (_, commit) => (commit === SHA ? Promise.reject(new ScanError('SOURCE_TOO_LARGE')) : Promise.resolve([]))
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', OTHER_SHA)
    await s.idle()
    expect(rows.get(`Student/My-App@${SHA}`)).toMatchObject({ status: 'failed', error: 'SOURCE_TOO_LARGE', findings: [] })
    expect(rows.get(`Student/My-App@${OTHER_SHA}`)).toMatchObject({ status: 'done' })
  })

  it('records an unexpected error as SCAN_ERROR', async () => {
    scan = () => Promise.reject(new Error('EACCES'))
    const s = service()
    s.request('Student/My-App', SHA)
    await s.idle()
    expect(rows.get(`Student/My-App@${SHA}`)).toMatchObject({ status: 'failed', error: 'SCAN_ERROR' })
  })

  it('does nothing when the server has no scanner set up', async () => {
    enabled = false
    const s = service()
    s.request('Student/My-App', SHA)
    await s.idle()
    expect(store.findScan).not.toHaveBeenCalled()
    expect(scanner.scan).not.toHaveBeenCalled()
  })

  it('keeps the queue going when the database cannot be reached', async () => {
    store.findScan.mockRejectedValueOnce(new Error('503'))
    const s = service()
    s.request('Student/My-App', SHA)
    s.request('Student/My-App', OTHER_SHA)
    await s.idle()
    expect(scanner.scan).toHaveBeenCalledExactlyOnceWith('Student/My-App', OTHER_SHA)
  })
})

describe('warningsFor', () => {
  it('turns stored findings into warnings for the deploy, with the service from its spec', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'done', findings: [SECRET] }))
    expect(await service().warningsFor(deploy())).toEqual([expect.objectContaining({ code: 'SECRET_FOUND', service: 'be' })])
  })

  it('is empty for a clean repo', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'done', findings: [] }))
    expect(await service().warningsFor(deploy())).toEqual([])
  })

  it('says the scan is running while it runs', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'running' }))
    expect(await service().warningsFor(deploy())).toEqual([SCAN_RUNNING])
    expect(scanner.scan).not.toHaveBeenCalled()
  })

  it('says the scan failed (never "nothing found") when it failed, its findings are unreadable, or the record cannot be read', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'failed', error: 'TRIVY_FAILED' }))
    expect(await service().warningsFor(deploy())).toEqual([SCAN_FAILED])
    rows.set(`Student/My-App@${SHA}`, row({ status: 'done', findings: [{ kind: 'secret' }] }))
    expect(await service().warningsFor(deploy())).toEqual([SCAN_FAILED])
    store.findScan.mockRejectedValueOnce(new Error('503'))
    expect(await service().warningsFor(deploy())).toEqual([SCAN_FAILED])
  })

  it('starts the scan of a deploy that has none (made before this feature) and says it is running', async () => {
    const s = service()
    expect(await s.warningsFor(deploy())).toEqual([SCAN_RUNNING])
    await s.idle()
    expect(scanner.scan).toHaveBeenCalledExactlyOnceWith('Student/My-App', SHA)
  })

  it('starts again a scan whose running record is stale', async () => {
    rows.set(`Student/My-App@${SHA}`, row({ status: 'running', started_at: new Date(Date.now() - STALE_SCAN_MS - 1000).toISOString() }))
    const s = service()
    expect(await s.warningsFor(deploy())).toEqual([SCAN_RUNNING])
    await s.idle()
    expect(scanner.scan).toHaveBeenCalledOnce()
  })

  it('says the server has no scanner when it has none, and a stale scan failed', async () => {
    enabled = false
    expect(await service().warningsFor(deploy())).toEqual([SCAN_UNAVAILABLE])
    rows.set(`Student/My-App@${SHA}`, row({ status: 'running', started_at: new Date(Date.now() - STALE_SCAN_MS - 1000).toISOString() }))
    expect(await service().warningsFor(deploy())).toEqual([SCAN_FAILED])
  })
})
