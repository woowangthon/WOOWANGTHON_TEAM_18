import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from './switch.js'

describe('switch CLI', () => {
  let dir: string
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  // 입력 · open.yaml 경로는 없는 파일이고 k3s 접속 env도 없다: 가드가 그 어느 것보다 먼저 멈춘다는 뜻이다.
  it('in a trial run writes a TRIAL_SWITCH_REFUSED report and exits 1 before reading the input or the cluster', async () => {
    dir = mkdtempSync(join(tmpdir(), 'switch-cli-'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const code = await main([join(dir, 'missing-input.json'), 'a', join(dir, 'missing-open.yaml'), join(dir, 'out')], { TRIAL_ID: 'tr_0123456789ab' })
    expect(code).toBe(1)
    const report = JSON.parse(readFileSync(join(dir, 'out', 'switch-report.json'), 'utf8')) as unknown
    expect(report).toMatchObject({ ok: false, slot: 'a', applied: [], deleted: [], failure: { kind: 'platform', code: 'TRIAL_SWITCH_REFUSED' } })
  })

  it('without TRIAL_ID goes on to read the input', async () => {
    dir = mkdtempSync(join(tmpdir(), 'switch-cli-'))
    await expect(main([join(dir, 'missing-input.json'), 'a', join(dir, 'missing-open.yaml'), join(dir, 'out')], {})).rejects.toThrow('ENOENT')
  })
})
