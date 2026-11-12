import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DeploysStore } from '../deploys/deploys.store.js'
import type { PipelineClient } from '../deploys/pipeline.client.js'
import { checkTrialResult, GatewayTrials } from './trials.js'

const TICKET = { deployId: 'd1', ticketId: 't_1', slug: 'my-app', targetSlot: 'b' as const }
const INPUT = { commitSha: 'a'.repeat(40), spec: {}, deploy_condition: { services: {} } }

// 가짜 GoCD: runTrial을 기록하고, 취소는 cancelOk에 따라 성공 · 실패한다.
let scheduled: { deployId: string; trialId: string; stages: string }[]
let cancelled: number[]
let cancelOk: boolean
let runFails: boolean
let run: { status: string; ticket_id: string | null }
let trials: GatewayTrials

const pipeline = {
  runTrial: (deployId: string, trialId: string, stages: string) => {
    if (runFails) return Promise.reject(new Error('down'))
    scheduled.push({ deployId, trialId, stages })
    return Promise.resolve()
  },
  cancelTrial: (counter: number) => {
    cancelled.push(counter)
    return Promise.resolve(cancelOk)
  },
  cancelAllTrials: () => Promise.resolve(0),
}
const store: { findRun: () => Promise<typeof run> } = { findRun: () => Promise.resolve(run) }

beforeEach(() => {
  scheduled = []
  cancelled = []
  cancelOk = true
  runFails = false
  run = { status: 'fixing', ticket_id: 't_1' }
  store.findRun = () => Promise.resolve(run)
  trials = new GatewayTrials(pipeline as unknown as PipelineClient, store as unknown as DeploysStore)
})

const tick = () => new Promise((r) => setTimeout(r, 0))
const deployResult = { ok: true, services: [{ service: 'be', ready: true, reason: null }], pods: [], events: [], failure: null }

describe('GatewayTrials', () => {
  it('schedules the trial pipeline with the stages of the tool and returns the posted result', async () => {
    const pending = trials.run(TICKET, 'run_deploy', INPUT, 60_000)
    await tick()
    expect(scheduled).toEqual([{ deployId: 'd1', trialId: expect.stringMatching(/^tr_[0-9a-f]{12}$/) as string, stages: 'prepare,render,apply' }])
    const { trialId } = scheduled[0]
    expect(trials.busy('t_1')).toBe(true)
    expect(await trials.input(trialId, '7')).toEqual({ deployId: 'd1', slot: 'b', input: INPUT, buildOverrides: null })
    expect(await trials.result(trialId, { stage: 'apply', result: deployResult })).toEqual({ ok: true, applied: true })
    expect(await pending).toEqual({ result: deployResult })
    expect(trials.busy('t_1')).toBe(false)
    // run_verify가 쓸 입력으로 남는다. 같은 결과를 다시 보내도 아무것도 바뀌지 않는다.
    expect(trials.lastDeployInput('t_1')).toBe(INPUT)
    expect(await trials.result(trialId, { stage: 'apply', result: deployResult })).toEqual({ ok: true, applied: false })
    expect(cancelled).toEqual([])
  })

  it('does not keep the input of a failed run_deploy for run_verify', async () => {
    const pending = trials.run(TICKET, 'run_deploy', INPUT, 60_000)
    await tick()
    await trials.result(scheduled[0].trialId, { stage: 'render', result: { ...deployResult, ok: false, services: [], failure: { stage: 'render', code: null, message: 'bad port' } } })
    await pending
    expect(trials.lastDeployInput('t_1')).toBeUndefined()
  })

  it('times out, cancels the running stages of the instance it read and refuses later reads and results', async () => {
    const pending = trials.run(TICKET, 'run_verify', INPUT, 20)
    await tick()
    const { trialId } = scheduled[0]
    await trials.input(trialId, '12')
    expect(await pending).toEqual({ failure: { stage: null, code: 'TRIAL_TIMEOUT', message: expect.any(String) as string } })
    expect(cancelled).toEqual([12])
    await expect(trials.input(trialId, '12')).rejects.toBeInstanceOf(NotFoundException)
    expect(await trials.result(trialId, { stage: 'verify', result: { ok: true, ready: [], requests: [], failure: null } })).toEqual({ ok: true, applied: false })
  })

  it('does not call GoCD to cancel when no job read the input yet (a later read is 404, so the slot is untouched)', async () => {
    const pending = trials.run(TICKET, 'run_render', INPUT, 20)
    await tick()
    await pending
    expect(cancelled).toEqual([])
    await expect(trials.input(scheduled[0].trialId, '1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers TRIAL_STILL_RUNNING while an earlier trial of the project could not be cancelled, and goes on once it is', async () => {
    cancelOk = false
    const first = trials.run(TICKET, 'run_render', INPUT, 20)
    await tick()
    await trials.input(scheduled[0].trialId, '3')
    await first
    expect(await trials.run(TICKET, 'run_render', INPUT, 20)).toEqual({ failure: { stage: null, code: 'TRIAL_STILL_RUNNING', message: expect.any(String) as string } })
    expect(scheduled).toHaveLength(1)
    expect(cancelled).toEqual([3, 3])
    cancelOk = true
    const third = trials.run(TICKET, 'run_render', INPUT, 20)
    await tick()
    expect(scheduled).toHaveLength(2)
    await third
  })

  it('answers PIPELINE_UNAVAILABLE when GoCD does not take the trial', async () => {
    runFails = true
    expect(await trials.run(TICKET, 'run_render', INPUT, 20)).toEqual({ failure: { stage: null, code: 'PIPELINE_UNAVAILABLE', message: expect.any(String) as string } })
    expect(trials.busy('t_1')).toBe(false)
  })

  it('does not take a result once the run is no longer open for that ticket', async () => {
    const pending = trials.run(TICKET, 'run_deploy', INPUT, 20)
    await tick()
    run = { status: 'needs_user', ticket_id: 't_1' }
    expect(await trials.result(scheduled[0].trialId, { stage: 'apply', result: deployResult })).toEqual({ ok: true, applied: false })
    expect(await pending).toMatchObject({ failure: { code: 'TRIAL_TIMEOUT' } })
  })

  it('does not schedule a trial for a ticket that already ended', async () => {
    await trials.endTicket('t_1')
    expect(await trials.run(TICKET, 'run_render', INPUT, 20)).toMatchObject({ failure: { code: 'TICKET_CLOSED' } })
    expect(scheduled).toEqual([])
  })

  it('waits for the start-up cancel and answers TRIAL_STILL_RUNNING while it could not be confirmed', async () => {
    let allOk = false
    const boot = { ...pipeline, cancelAllTrials: () => (allOk ? Promise.resolve(0) : Promise.reject(new Error('GoCD down'))) }
    const t = new GatewayTrials(boot as unknown as PipelineClient, store as unknown as DeploysStore)
    t.onApplicationBootstrap()
    expect(await t.run(TICKET, 'run_render', INPUT, 20)).toMatchObject({ failure: { code: 'TRIAL_STILL_RUNNING' } })
    expect(scheduled).toEqual([])
    // 다음 시험에서 한 번 더 취소해 보고, 되면 시작한다.
    allOk = true
    await t.run(TICKET, 'run_render', INPUT, 20)
    expect(scheduled).toHaveLength(1)
  })

  it('cancels the waiting trial when the ticket ends', async () => {
    const pending = trials.run(TICKET, 'run_deploy', INPUT, 60_000)
    await tick()
    await trials.input(scheduled[0].trialId, '5')
    await trials.endTicket('t_1')
    expect(await pending).toMatchObject({ failure: { code: 'TICKET_CLOSED' } })
    expect(cancelled).toEqual([5])
  })

  describe('input route', () => {
    it.each([['not a trial id', 'tr_xyz'], ['an unknown trial', 'tr_000000000000']])('is 404 for %s', async (_label, id) => {
      await expect(trials.input(id, '1')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('is 404 when the trial no longer belongs to the open ticket of its run', async () => {
      void trials.run(TICKET, 'run_render', INPUT, 60_000)
      await tick()
      run = { status: 'fixing', ticket_id: 't_2' }
      await expect(trials.input(scheduled[0].trialId, '1')).rejects.toBeInstanceOf(NotFoundException)
      run = { status: 'failed', ticket_id: 't_1' }
      await expect(trials.input(scheduled[0].trialId, '1')).rejects.toBeInstanceOf(NotFoundException)
      await trials.endTicket('t_1')
    })

    it('requires the counter of the pipeline run', async () => {
      void trials.run(TICKET, 'run_render', INPUT, 60_000)
      await tick()
      await expect(trials.input(scheduled[0].trialId, undefined)).rejects.toBeInstanceOf(BadRequestException)
      await trials.endTicket('t_1')
    })

    it('is 404 when the trial ended while the run was being read', async () => {
      void trials.run(TICKET, 'run_render', INPUT, 60_000)
      await tick()
      let release!: () => void
      store.findRun = () => new Promise((r) => (release = () => r(run)))
      const reading = trials.input(scheduled[0].trialId, '1')
      await trials.endTicket('t_1')
      release()
      await expect(reading).rejects.toBeInstanceOf(NotFoundException)
    })

    it('keeps the same counter, refuses another one and a bad one', async () => {
      void trials.run(TICKET, 'run_render', INPUT, 60_000)
      await tick()
      const { trialId } = scheduled[0]
      await trials.input(trialId, '4')
      await trials.input(trialId, '4')
      await expect(trials.input(trialId, '5')).rejects.toBeInstanceOf(BadRequestException)
      await expect(trials.input(trialId, 'x')).rejects.toBeInstanceOf(BadRequestException)
      await trials.endTicket('t_1')
      expect(cancelled).toEqual([4])
    })
  })
})

describe('checkTrialResult', () => {
  it('accepts each tool shape with or without a failure', () => {
    expect(checkTrialResult('run_render', { stage: 'render', result: { ok: false, status: { code: 422 }, failure: { stage: 'render', code: null, message: 'x' } } })).toEqual([])
    expect(checkTrialResult('run_deploy', { stage: 'prepare', result: { ok: false, services: [], pods: [], events: [], failure: { stage: 'prepare', code: 'LIVE_SLOT_PROTECTED', message: 'x' } } })).toEqual([])
    expect(checkTrialResult('run_verify', { stage: 'verify', result: { ok: true, ready: [{ service: 'fe', ready: true }], requests: [{ service: 'fe', path: '/', status: 200, ms: 12, error: null }], failure: null } })).toEqual([])
  })

  it.each([
    ['a stage outside the tool', 'run_verify', { stage: 'apply', result: { ok: true, ready: [], requests: [], failure: null } }, 'stage'],
    ['another tool shape', 'run_render', { stage: 'render', result: { ok: true, services: [], failure: null } }, 'result.services'],
    ['a missing field', 'run_deploy', { stage: 'apply', result: { ok: true, services: [], pods: [], failure: null } }, 'result.events'],
    ['a bad platform code', 'run_render', { stage: 'render', result: { ok: false, status: null, failure: { stage: 'render', code: 'x y', message: 'm' } } }, 'result.failure'],
    ['an unknown top key', 'run_render', { stage: 'render', result: { ok: true, status: null, failure: null }, extra: 1 }, 'extra'],
    ['ok from a stage before the last', 'run_deploy', { stage: 'render', result: { ok: true, services: [], pods: [], events: [], failure: null } }, 'stage'],
    ['ok with a failure', 'run_verify', { stage: 'verify', result: { ok: true, ready: [], requests: [], failure: { stage: 'verify', code: null, message: 'x' } } }, 'result.failure'],
    ['a failure without the failure field', 'run_render', { stage: 'render', result: { ok: false, status: null, failure: null } }, 'result.failure'],
  ])('reports %s', (_label, tool, body, path) => {
    expect(checkTrialResult(tool as 'run_render', body).map((i) => i.path)).toContain(path)
  })
})
