import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { PipelineClient } from './pipeline.client.js'

const BASE = 'https://gocd.test'
const settings: Partial<Env> = { GOCD_URL: BASE, GOCD_TOKEN: 'gocd_token_test', GOCD_PIPELINE: 'student-deploy', GOCD_TRIAL_PIPELINE: 'student-trial' }
const client = (overrides: Partial<Env> = {}) => {
  const env = { ...settings, ...overrides }
  return new PipelineClient({ get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>)
}

let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[]
let answer: (url: string, method: string) => Response

beforeEach(() => {
  calls = []
  answer = () => Response.json({})
  vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
    calls.push({ url: input, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined })
    return Promise.resolve(answer(input, init.method ?? 'GET'))
  })
})
afterEach(() => vi.unstubAllGlobals())

const instance = (counter: number, stages: [string, string, number | string][]) => ({
  counter,
  stages: stages.map(([name, status, c]) => ({ name, status, counter: c })),
})

describe('PipelineClient', () => {
  it('schedules the deploy pipeline with DEPLOY_ID only', async () => {
    await client().run('d1')
    expect(calls).toEqual([
      {
        url: `${BASE}/go/api/pipelines/student-deploy/schedule`,
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'application/vnd.go.cd.v1+json', 'X-GoCD-Confirm': 'true', Authorization: 'Bearer gocd_token_test' }) as unknown,
        body: { environment_variables: [{ name: 'DEPLOY_ID', value: 'd1' }], update_materials_before_scheduling: true },
      },
    ])
  })

  it('schedules the trial pipeline with DEPLOY_ID, TRIAL_ID and TRIAL_STAGES', async () => {
    await client().runTrial('d1', 'tr_0123456789ab', 'prepare,render,apply')
    expect(calls[0].url).toBe(`${BASE}/go/api/pipelines/student-trial/schedule`)
    expect(calls[0].body).toEqual({
      environment_variables: [
        { name: 'DEPLOY_ID', value: 'd1' },
        { name: 'TRIAL_ID', value: 'tr_0123456789ab' },
        { name: 'TRIAL_STAGES', value: 'prepare,render,apply' },
      ],
      update_materials_before_scheduling: true,
    })
  })

  it.each([
    ['no trial pipeline name', () => client({ GOCD_TRIAL_PIPELINE: undefined }).runTrial('d1', 'tr_0123456789ab', 'verify')],
    ['GoCD refusing', () => ((answer = () => new Response('{}', { status: 422 })), client().runTrial('d1', 'tr_0123456789ab', 'verify'))],
    ['GoCD unreachable', () => ((answer = () => { throw new TypeError('fetch failed') }), client().run('d1'))],
  ])('is 503 PIPELINE_UNAVAILABLE for %s', async (_label, act) => {
    await expect(act()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('cancels only the running stages of one trial instance', async () => {
    answer = (url) => (url.endsWith('/student-trial/7') ? Response.json(instance(7, [['prepare', 'Passed', 1], ['render', 'Building', '1'], ['apply', 'Unknown', 1]])) : Response.json({}))
    expect(await client().cancelTrial(7)).toBe(true)
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `${BASE}/go/api/pipelines/student-trial/7`],
      ['POST', `${BASE}/go/api/stages/student-trial/7/render/1/cancel`],
    ])
    expect(calls[1].headers).toMatchObject({ Accept: 'application/vnd.go.cd.v3+json', 'X-GoCD-Confirm': 'true' })
  })

  it('says the cancel is not confirmed when GoCD refuses it or cannot be read', async () => {
    answer = (url) => (url.endsWith('/cancel') ? new Response('{}', { status: 500 }) : Response.json(instance(7, [['verify', 'Building', 1]])))
    expect(await client().cancelTrial(7)).toBe(false)
    answer = () => new Response('{}', { status: 500 })
    expect(await client().cancelTrial(7)).toBe(false)
    expect(await client({ GOCD_TRIAL_PIPELINE: undefined }).cancelTrial(7)).toBe(false)
  })

  it('cancels every unfinished trial instance at start', async () => {
    answer = (url) =>
      url.includes('/history')
        ? Response.json({ pipelines: [instance(9, [['render', 'Building', 1]]), instance(8, [['render', 'Passed', 1], ['apply', 'Failed', 1]]), instance(6, [['verify', 'Building', 2]])] })
        : Response.json({})
    expect(await client().cancelAllTrials()).toBe(2)
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      `${BASE}/go/api/stages/student-trial/9/render/1/cancel`,
      `${BASE}/go/api/stages/student-trial/6/verify/2/cancel`,
    ])
    expect(calls[0].url).toBe(`${BASE}/go/api/pipelines/student-trial/history?page_size=20`)
    expect(await client({ GOCD_TRIAL_PIPELINE: undefined }).cancelAllTrials()).toBe(0)
  })

  it('never puts the GoCD token in a log', async () => {
    answer = () => new Response('{}', { status: 500 })
    const c = client()
    const spy = vi.spyOn((c as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
    await expect(c.run('d1')).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(spy).toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('gocd_token_test')
  })
})
