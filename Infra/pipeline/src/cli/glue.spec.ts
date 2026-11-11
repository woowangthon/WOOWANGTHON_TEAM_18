import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildReport } from '../build.js'
import { deployInput, digest } from '../fixtures.js'
import { DEPLOY_ID, fakePlatform, TOKEN } from '../platform-fake.js'
import { RETRY_WAITS_MS } from '../platform-api.js'
import { run as fetchInputCli } from './fetch-input.js'
import { run as notifyCli } from './notify.js'

// 두 CLI를 진짜 loopback 서버에 대고 돌린다: 파일, 종료 코드, 출력.
describe('fetch-input and notify CLIs', () => {
  let dir: string
  let platform: Awaited<ReturnType<typeof fakePlatform>> | undefined
  let out: string
  const waits: number[] = []
  const sleep = (ms: number) => {
    waits.push(ms)
    return Promise.resolve()
  }
  const serve = async (answer: Parameters<typeof fakePlatform>[0]) => {
    platform = await fakePlatform(answer)
    return platform
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glue-'))
    out = ''
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void (out += `${a.join(' ')}\n`))
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void (out += `${a.join(' ')}\n`))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    waits.length = 0
    rmSync(dir, { recursive: true, force: true })
    await platform?.close()
    platform = undefined
    expect(out).not.toContain(TOKEN)
  })

  describe('fetch-input', () => {
    it('writes deploy-input.json and slot (without a newline), exit 0', async () => {
      const p = await serve(() => ({ status: 200, body: { deployId: DEPLOY_ID, slot: 'b', input: deployInput() } }))
      expect(await fetchInputCli([join(dir, 'out')], p.env, sleep)).toBe(0)
      expect(readdirSync(join(dir, 'out')).sort()).toEqual(['deploy-input.json', 'slot'])
      expect(readFileSync(join(dir, 'out', 'slot'), 'utf8')).toBe('b')
      expect(JSON.parse(readFileSync(join(dir, 'out', 'deploy-input.json'), 'utf8'))).toEqual(deployInput())
      expect(out).toContain('slot b')
    })

    it('exit 1 on a 4xx, and writes nothing', async () => {
      const p = await serve(() => ({ status: 404, body: { error: { code: 'DEPLOY_NOT_FOUND', message: 'x' } } }))
      expect(await fetchInputCli([join(dir, 'out')], p.env, sleep)).toBe(1)
      expect(() => readdirSync(join(dir, 'out'))).toThrow()
      expect(out).toContain('DEPLOY_NOT_FOUND')
    })

    it('exit 2 when 503 lasts after the tries', async () => {
      const p = await serve(() => ({ status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE' } } }))
      expect(await fetchInputCli([join(dir, 'out')], p.env, sleep)).toBe(2)
      expect(p.seen).toHaveLength(RETRY_WAITS_MS.length + 1)
      expect(waits).toEqual(RETRY_WAITS_MS)
    })

    it('exit 2 on an answer that is not a usable input', async () => {
      const p = await serve(() => ({ status: 200, body: { deployId: DEPLOY_ID, slot: 'x', input: deployInput() } }))
      expect(await fetchInputCli([join(dir, 'out')], p.env, sleep)).toBe(2)
    })

    it.each([[{ DEPLOY_ID: undefined }], [{ PIPELINE_NOTIFY_TOKEN: undefined }], [{ PLATFORM_API_URL: undefined }]])('exit 2 on a bad setting %j, before any request', async (over) => {
      const p = await serve(() => ({ status: 200 }))
      expect(await fetchInputCli([join(dir, 'out')], { ...p.env, ...over }, sleep)).toBe(2)
      expect(p.seen).toHaveLength(0)
    })

    it('exit 2 and a usage line without the output folder', async () => {
      const p = await serve(() => ({ status: 200 }))
      expect(await fetchInputCli([], p.env, sleep)).toBe(2)
      expect(out).toContain('usage: fetch-input <out-dir>')
    })
  })

  describe('notify', () => {
    const okBuild = (): BuildReport => {
      const input = deployInput()
      input.deploy_condition.services.fe.image = digest('1')
      input.deploy_condition.services.be.image = digest('2')
      return { ok: true, input, builds: {}, failures: [] }
    }
    const report = (value: unknown) => {
      const path = join(dir, 'report.json')
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
      return path
    }
    const sent = () => JSON.parse(platform!.seen[0].body) as unknown

    it('sends a passed build with the images, exit 0', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true, applied: true } }))
      expect(await notifyCli(['build', report(okBuild())], p.env, sleep)).toBe(0)
      expect(sent()).toEqual({ deployId: DEPLOY_ID, stage: 'build', result: 'passed', images: { fe: digest('1'), be: digest('2') } })
      expect(out).toContain('notified build passed')
    })

    it('sends a failed stage from its report', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      const failure = { kind: 'platform', code: 'SPACE_MISSING', service: null, message: 'no namespace' }
      expect(await notifyCli(['apply', report({ ok: false, failure })], p.env, sleep)).toBe(0)
      expect(sent()).toEqual({ deployId: DEPLOY_ID, stage: 'apply', result: 'failed', failure: { code: 'SPACE_MISSING', service: null, message: 'no namespace' } })
    })

    it('exit 0 and a note when the server did not change the run (applied: false)', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true, applied: false } }))
      expect(await notifyCli(['verify', report({ ok: true })], p.env, sleep)).toBe(0)
      expect(out).toContain('the server did not change the run')
    })

    it.each([
      ['no file', undefined],
      ['a file that is not JSON', '{"ok": tru'],
      ['an empty file', ''],
    ])('%s: sends STAGE_NO_REPORT as a failure of the stage, exit 0', async (_, content) => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      const path = content === undefined ? join(dir, 'missing.json') : report(content)
      expect(await notifyCli(['render', path], p.env, sleep)).toBe(0)
      expect(sent()).toEqual({ deployId: DEPLOY_ID, stage: 'render', result: 'failed', failure: { code: 'STAGE_NO_REPORT', service: null, message: 'the render stage left no readable report' } })
      expect(out).toContain('STAGE_NO_REPORT')
    })

    it('exit 1 on a 400, naming the fields to fix', async () => {
      const p = await serve(() => ({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'x', fields: [{ path: 'images.fe', code: 'INVALID_VALUE' }] } } }))
      expect(await notifyCli(['build', report(okBuild())], p.env, sleep)).toBe(1)
      expect(out).toContain('images.fe INVALID_VALUE')
      expect(p.seen).toHaveLength(1)
    })

    it.each([401, 404])('exit 1 on %i', async (status) => {
      const p = await serve(() => ({ status, body: { error: { code: 'X' } } }))
      expect(await notifyCli(['apply', report({ ok: true })], p.env, sleep)).toBe(1)
    })

    it('tries again on 503 and exit 0 when it goes through', async () => {
      const p = await serve((_, n) => (n === 0 ? { status: 503 } : { status: 200, body: { ok: true } }))
      expect(await notifyCli(['apply', report({ ok: true })], p.env, sleep)).toBe(0)
      expect(p.seen).toHaveLength(2)
      expect(waits).toEqual([1_000])
    })

    it('exit 2 when 503 lasts', async () => {
      const p = await serve(() => ({ status: 503 }))
      expect(await notifyCli(['apply', report({ ok: true })], p.env, sleep)).toBe(2)
      expect(p.seen).toHaveLength(RETRY_WAITS_MS.length + 1)
    })

    it.each([
      ['no ok', { stage: 'apply' }, 'apply report: has no boolean ok'],
      ['not ok and no failure', { ok: false }, 'apply report: is not ok but has no failure of kind platform or student'],
    ])('a report with the wrong shape (%s): sends STAGE_NO_REPORT with the reason, so the run does not wait for the timeout', async (_, content, why) => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await notifyCli(['apply', report(content)], p.env, sleep)).toBe(0)
      expect(sent()).toEqual({ deployId: DEPLOY_ID, stage: 'apply', result: 'failed', failure: { code: 'STAGE_NO_REPORT', service: null, message: `the apply stage left no readable report: ${why}` } })
      expect(out).toContain(why)
    })

    it('a passed build report that lacks its input is a wrong shape too', async () => {
      const p = await serve(() => ({ status: 200, body: { ok: true } }))
      expect(await notifyCli(['build', report({ ok: true, failures: [] })], p.env, sleep)).toBe(0)
      expect(sent()).toMatchObject({ stage: 'build', result: 'failed', failure: { code: 'STAGE_NO_REPORT' } })
    })

    it.each([[[]], [['deploy', 'x.json']], [['build']]])('exit 2 and a usage line for the arguments %j', async (args) => {
      const p = await serve(() => ({ status: 200 }))
      expect(await notifyCli(args, p.env, sleep)).toBe(2)
      expect(p.seen).toHaveLength(0)
    })

    it('exit 2 on a bad setting, before any request', async () => {
      const p = await serve(() => ({ status: 200 }))
      expect(await notifyCli(['apply', report({ ok: true })], { ...p.env, DEPLOY_ID: 'x' }, sleep)).toBe(2)
      expect(p.seen).toHaveLength(0)
    })
  })
})
