import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deployInput } from '../fixtures.js'
import { DEPLOY_ID, fakePlatform, TOKEN } from '../platform-fake.js'
import { run as fetchInputCli } from './fetch-input.js'
import { run as trialReportCli } from './trial-report.js'

// 시험 실행(student-trial)에서 두 CLI를 진짜 loopback 서버에 대고 돌린다: 파일, 종료 코드, 출력, 보낸 본문.
const TRIAL = 'tr_0123456789ab'

describe('student-trial CLIs', () => {
  let dir: string
  let platform: Awaited<ReturnType<typeof fakePlatform>> | undefined
  let out: string
  const sleep = () => Promise.resolve()
  const serve = async (answer: Parameters<typeof fakePlatform>[0]) => {
    platform = await fakePlatform(answer)
    return platform
  }
  const trialEnv = (p: { env: Record<string, string> }, stages = 'prepare,render,apply') => ({ ...p.env, TRIAL_ID: TRIAL, TRIAL_STAGES: stages, GO_PIPELINE_COUNTER: '17' })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trial-'))
    out = ''
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void (out += `${a.join(' ')}\n`))
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void (out += `${a.join(' ')}\n`))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    await platform?.close()
    platform = undefined
    expect(out).not.toContain(TOKEN)
  })

  describe('fetch-input with TRIAL_ID', () => {
    const answer = (buildOverrides: unknown) => ({ status: 200, body: { deployId: DEPLOY_ID, slot: 'b', input: deployInput(), buildOverrides } })

    it('reads the trial input with the GoCD counter and writes build-overrides.json (null for a non-build trial)', async () => {
      const p = await serve(() => answer(null))
      expect(await fetchInputCli([join(dir, 'work')], trialEnv(p), sleep)).toBe(0)
      expect(p.seen[0]).toMatchObject({ method: 'GET', url: `/api/pipeline/trials/${TRIAL}/input?counter=17` })
      expect(readdirSync(join(dir, 'work')).sort()).toEqual(['build-overrides.json', 'deploy-input.json', 'slot'])
      expect(readFileSync(join(dir, 'work', 'slot'), 'utf8')).toBe('b')
      expect(JSON.parse(readFileSync(join(dir, 'work', 'deploy-input.json'), 'utf8'))).toEqual(deployInput())
      expect(readFileSync(join(dir, 'work', 'build-overrides.json'), 'utf8')).toBe('null\n')
      expect(out).toContain(`trial ${TRIAL}`)
    })

    it('writes the overrides of a run_build trial', async () => {
      const p = await serve(() => answer({ computeType: 'BUILD_GENERAL1_MEDIUM', timeoutMinutes: 20, cache: false }))
      expect(await fetchInputCli([join(dir, 'work')], trialEnv(p, 'build'), sleep)).toBe(0)
      expect(JSON.parse(readFileSync(join(dir, 'work', 'build-overrides.json'), 'utf8'))).toEqual({ computeType: 'BUILD_GENERAL1_MEDIUM', timeoutMinutes: 20, cache: false })
    })

    it('takes an answer without the buildOverrides field as none', async () => {
      const p = await serve(() => ({ status: 200, body: { deployId: DEPLOY_ID, slot: 'a', input: deployInput() } }))
      expect(await fetchInputCli([join(dir, 'work')], trialEnv(p), sleep)).toBe(0)
      expect(readFileSync(join(dir, 'work', 'build-overrides.json'), 'utf8')).toBe('null\n')
    })

    it('exit 2 and no files for overrides the Build CLI would refuse', async () => {
      const p = await serve(() => answer({ timeoutMinutes: 30 }))
      expect(await fetchInputCli([join(dir, 'work')], trialEnv(p, 'build'), sleep)).toBe(2)
      expect(() => readdirSync(join(dir, 'work'))).toThrow()
      expect(out).toContain('timeoutMinutes must be an integer from 1 to 20')
    })

    it('exit 1 on 404 TRIAL_NOT_FOUND (an ended trial): no files, so the stage CLI does not touch the slot', async () => {
      const p = await serve(() => ({ status: 404, body: { error: { code: 'TRIAL_NOT_FOUND', message: 'x' } } }))
      expect(await fetchInputCli([join(dir, 'work')], trialEnv(p), sleep)).toBe(1)
      expect(() => readdirSync(join(dir, 'work'))).toThrow()
      expect(out).toContain('TRIAL_NOT_FOUND')
    })

    it.each([
      [{ TRIAL_ID: '' }, 'TRIAL_ID must look like'],
      [{ TRIAL_ID: 'tr_../../x' }, 'TRIAL_ID must look like'],
      [{ GO_PIPELINE_COUNTER: undefined }, 'GO_PIPELINE_COUNTER must look like'],
      [{ GO_PIPELINE_COUNTER: '0' }, 'GO_PIPELINE_COUNTER must look like'],
      [{ GO_PIPELINE_COUNTER: '1a' }, 'GO_PIPELINE_COUNTER must look like'],
    ])('exit 2 on %j, before any request', async (over, why) => {
      const p = await serve(() => answer(null))
      expect(await fetchInputCli([join(dir, 'work')], { ...trialEnv(p), ...over }, sleep)).toBe(2)
      expect(p.seen).toHaveLength(0)
      expect(out).toContain(why)
    })

    it('without TRIAL_ID reads the deploy input as before and writes no build-overrides.json', async () => {
      const p = await serve(() => ({ status: 200, body: { deployId: DEPLOY_ID, slot: 'b', input: deployInput() } }))
      expect(await fetchInputCli([join(dir, 'work')], p.env, sleep)).toBe(0)
      expect(p.seen[0].url).toBe(`/api/pipeline/deploys/${DEPLOY_ID}/input`)
      expect(readdirSync(join(dir, 'work')).sort()).toEqual(['deploy-input.json', 'slot'])
    })
  })

  describe('trial-report', () => {
    const file = (name: string, value: unknown) => {
      const path = join(dir, name)
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
      return path
    }
    const input = () => file('deploy-input.json', deployInput())
    const sent = (n = 0) => JSON.parse(platform!.seen[n].body) as unknown

    it('a passed middle stage sends nothing, exit 0', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await trialReportCli(['prepare', file('prepare-report.json', { ok: true, failure: null }), input()], trialEnv(p), sleep)).toBe(0)
      expect(p.seen).toHaveLength(0)
      expect(out).toContain('nothing to send yet')
    })

    it('the last stage sends the tool result to the trial, exit 0', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true, applied: true } }))
      const report = file('apply-report.json', { ok: true, slot: 'b', ready: ['ai', 'be', 'fe'], failure: null })
      expect(await trialReportCli(['apply', report, input()], trialEnv(p), sleep)).toBe(0)
      expect(p.seen[0]).toMatchObject({ method: 'POST', url: `/api/pipeline/trials/${TRIAL}/result` })
      expect(sent()).toMatchObject({ stage: 'apply', result: { ok: true, failure: null, pods: [], events: [] } })
      expect(out).toContain(`sent trial ${TRIAL} apply passed`)
    })

    it('a failed middle stage sends its failure', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      const report = file('prepare-report.json', { ok: false, failure: { kind: 'platform', code: 'LIVE_SLOT_PROTECTED', service: null, message: 'x' } })
      expect(await trialReportCli(['prepare', report, input()], trialEnv(p), sleep)).toBe(0)
      expect(sent()).toMatchObject({ stage: 'prepare', result: { ok: false, failure: { stage: 'prepare', code: 'LIVE_SLOT_PROTECTED' } } })
    })

    it.each([
      ['no report', () => join(dir, 'missing.json'), () => input()],
      ['a report that is not JSON', () => file('r.json', '{"ok": tru'), () => input()],
      ['no input', () => file('r.json', { ok: true }), () => join(dir, 'missing-input.json')],
    ])('%s: STAGE_NO_REPORT even at a middle stage, so the gateway does not wait 30 minutes', async (_, report, inputPath) => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await trialReportCli(['prepare', report(), inputPath()], trialEnv(p), sleep)).toBe(0)
      expect(sent()).toEqual({
        stage: 'prepare',
        result: { ok: false, services: [], pods: [], events: [], failure: { stage: 'prepare', code: 'STAGE_NO_REPORT', message: 'the prepare stage left no readable report' } },
      })
    })

    it('a report of the wrong shape: STAGE_NO_REPORT with the reason', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await trialReportCli(['render', file('r.json', { stage: 'render' }), input()], trialEnv(p, 'render'), sleep)).toBe(0)
      expect(sent()).toMatchObject({ result: { ok: false, status: null, failure: { code: 'STAGE_NO_REPORT', message: 'the render stage left no readable report: render report: has no boolean ok' } } })
    })

    const refused = { error: { code: 'BAD_REQUEST', message: 'x', fields: [{ path: 'result.services', code: 'INVALID_VALUE' }] } }

    it('a 400 is answered once with STAGE_NO_REPORT naming the fields, exit 0 when that goes through', async () => {
      const p = await serve((_, n) => (n === 0 ? { status: 400, body: refused } : { status: 200, body: { ok: true } }))
      const report = file('apply-report.json', { ok: true, slot: 'b', ready: ['ai', 'be', 'fe'], failure: null })
      expect(await trialReportCli(['apply', report, input()], trialEnv(p), sleep)).toBe(0)
      expect(p.seen).toHaveLength(2)
      const second = sent(1) as { result: { failure: { code: string; message: string } } }
      expect(second.result.failure.code).toBe('STAGE_NO_REPORT')
      expect(second.result.failure.message).toContain('result.services INVALID_VALUE')
    })

    it('exit 1 when the second is refused too, and no third try', async () => {
      const p = await serve(() => ({ status: 400, body: refused }))
      const report = file('apply-report.json', { ok: true, slot: 'b', ready: ['ai', 'be', 'fe'], failure: null })
      expect(await trialReportCli(['apply', report, input()], trialEnv(p), sleep)).toBe(1)
      expect(p.seen).toHaveLength(2)
    })

    it('exit 0 and a note for a late result (applied: false)', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true, applied: false } }))
      expect(await trialReportCli(['verify', file('v.json', { ok: true, ready: [], requests: [], failure: null }), input()], trialEnv(p, 'verify'), sleep)).toBe(0)
      expect(out).toContain('the trial already ended')
    })

    it('a stage outside TRIAL_STAGES sends nothing', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await trialReportCli(['apply', file('a.json', { ok: false }), input()], trialEnv(p, 'render'), sleep)).toBe(0)
      expect(p.seen).toHaveLength(0)
    })

    it.each([
      [['apply'], {}],
      [['switch', 'r.json', 'i.json'], {}],
      [['apply', 'r.json', 'i.json'], { TRIAL_ID: undefined }],
      [['apply', 'r.json', 'i.json'], { TRIAL_STAGES: 'apply' }],
      [['apply', 'r.json', 'i.json'], { PIPELINE_NOTIFY_TOKEN: 'short' }],
    ])('exit 2 for %j with %j, before any request', async (args, over) => {
      const p = await serve(() => ({ status: 200 }))
      expect(await trialReportCli(args, { ...trialEnv(p), ...over }, sleep)).toBe(2)
      expect(p.seen).toHaveLength(0)
    })
  })
})
