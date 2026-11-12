import { describe, expect, it } from 'vitest'
import { deployInput, digest } from './fixtures.js'
import { KubeError } from './kube.js'
import { fakeKube, list, ok, refused } from './kube-fake.js'
import { liveSlotOf, PODS_GONE_MAX_MS, PODS_GONE_POLL_MS, quotaMessage, runPrepare } from './prepare.js'

const NS = '/namespaces/proj-my-app'
const OPEN = `GET /apis/networking.k8s.io/v1${NS}/ingresses?labelSelector=wanggane%2Fingress%3Dopen`
const TEST = `GET /apis/networking.k8s.io/v1${NS}/ingresses?labelSelector=wanggane%2Fingress%3Dtest`
const slotList = (slot: string) => ({
  [`GET /apis/apps/v1${NS}/deployments?labelSelector=slot%3D${slot}`]: list({ metadata: { name: `fe-${slot}` } }, { metadata: { name: `be-${slot}` } }),
  [`GET /api/v1${NS}/services?labelSelector=slot%3D${slot}`]: list({ metadata: { name: `fe-${slot}` } }),
  [`GET /api/v1${NS}/configmaps?labelSelector=slot%3D${slot}`]: list(),
  [pods(slot)]: list(),
})
const pods = (slot: string) => `GET /api/v1${NS}/pods?labelSelector=slot%3D${slot}`
// 대기만 세는 시계. sleep은 바로 돌아오고 시간을 그만큼 넘긴다.
function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms)
      t += ms
      return Promise.resolve()
    },
  }
}
const ingress = (name: string, ...backends: string[]) => ({
  metadata: { name },
  spec: { rules: [{ host: 'h', http: { paths: backends.map((b) => ({ path: '/', backend: { service: { name: b, port: { number: 80 } } } })) } }] },
})
const built = () => {
  const i = deployInput()
  i.deploy_condition.services.fe.image = digest('d')
  i.deploy_condition.services.be.image = digest('e')
  return i
}

describe('liveSlotOf', () => {
  it('is null with no open Ingress (first deploy)', () => {
    expect(liveSlotOf([])).toBeNull()
  })
  it('is the slot every backend points to', () => {
    expect(liveSlotOf([ingress('open-fe', 'fe-a'), ingress('open-be', 'be-a')])).toBe('a')
  })
  it.each([
    ['backends on two slots (interrupted switch)', [ingress('open-fe', 'fe-b'), ingress('open-be', 'be-a')]],
    ['a backend that is not a slot Service', [ingress('open-fe', 'fe-b'), ingress('open-x', 'something')]],
    ['two slots inside one Ingress', [ingress('open-fe', 'fe-a', 'fe-b')]],
    ['only backends that are not slot Services', [ingress('open-x', 'something')]],
  ])('is mixed for %s', (_, ings) => {
    expect(liveSlotOf(ings)).toBe('mixed')
  })
})

describe('quotaMessage', () => {
  it('states each exceeded field with units, in one sentence', () => {
    expect(
      quotaMessage([
        { field: 'requests.cpu', used: 5, limit: 4 },
        { field: 'limits.memory', used: 34 * 2 ** 30, limit: 32 * 2 ** 30 },
        { field: 'pods', used: 12, limit: 10 },
      ]),
    ).toBe('resources of both slots exceed the project quota: requests.cpu 5 > 4, limits.memory 34Gi > 32Gi, pods 12 > 10')
  })
  it('says which service has an unreadable quantity', () => {
    expect(quotaMessage([{ field: 'services.be.resources', used: NaN, limit: NaN }])).toBe('resources of both slots exceed the project quota: services.be.resources unreadable')
  })
})

describe('runPrepare', () => {
  it('on the first deploy clears the target slot by label, one object at a time, and drops test Ingresses not in this deploy', async () => {
    const { call, calls } = fakeKube({
      [OPEN]: list(),
      ...slotList('a'),
      [TEST]: list({ metadata: { name: 'test-fe' } }, { metadata: { name: 'test-old' } }),
      [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: ok(),
      [`DELETE /apis/apps/v1${NS}/deployments/be-a`]: refused(404, { kind: 'Status', code: 404 }),
      [`DELETE /api/v1${NS}/services/fe-a`]: ok(),
      [`DELETE /apis/networking.k8s.io/v1${NS}/ingresses/test-old`]: ok(),
    })
    const report = await runPrepare(built(), 'a', call, fakeClock())
    expect(report).toEqual({
      ok: true,
      slot: 'a',
      live: null,
      deleted: ['Deployment/fe-a', 'Deployment/be-a', 'Service/fe-a', 'Ingress/test-old'],
      failure: null,
    })
    // 지우기는 DELETE 하나씩(deletecollection 권한이 없다). Middleware · Secret · open Ingress는 건드리지 않는다.
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      `/apis/apps/v1${NS}/deployments/fe-a`,
      `/apis/apps/v1${NS}/deployments/be-a`,
      `/api/v1${NS}/services/fe-a`,
      `/apis/networking.k8s.io/v1${NS}/ingresses/test-old`,
    ])
  })

  it('keeps every test Ingress of a public service', async () => {
    const { call } = fakeKube({ [OPEN]: list(), ...slotList('b'), [TEST]: list({ metadata: { name: 'test-fe' } }, { metadata: { name: 'test-be' } }), [`DELETE /apis/apps/v1${NS}/deployments/fe-b`]: ok(), [`DELETE /apis/apps/v1${NS}/deployments/be-b`]: ok(), [`DELETE /api/v1${NS}/services/fe-b`]: ok() })
    expect((await runPrepare(built(), 'b', call, fakeClock())).deleted).not.toContain('Ingress/test-fe')
  })

  it('reports the live slot it read and clears the other one', async () => {
    const { call } = fakeKube({ [OPEN]: list(ingress('open-fe', 'fe-a'), ingress('open-be', 'be-a')), ...slotList('b'), [TEST]: list(), [`DELETE /apis/apps/v1${NS}/deployments/fe-b`]: ok(), [`DELETE /apis/apps/v1${NS}/deployments/be-b`]: ok(), [`DELETE /api/v1${NS}/services/fe-b`]: ok() })
    expect(await runPrepare(built(), 'b', call, fakeClock())).toMatchObject({ ok: true, live: 'a' })
  })

  it('refuses to clear the slot the open Ingresses point to, and deletes nothing', async () => {
    const { call, calls } = fakeKube({ [OPEN]: list(ingress('open-fe', 'fe-a')) })
    expect(await runPrepare(built(), 'a', call, fakeClock())).toEqual({
      ok: false,
      slot: 'a',
      live: 'a',
      deleted: [],
      failure: { kind: 'platform', code: 'LIVE_SLOT_PROTECTED', service: null, message: 'slot a is live (open Ingresses point to it); refusing to clear it' },
    })
    expect(calls).toHaveLength(1)
  })

  it('stops on open Ingresses that point to different slots (an interrupted switch)', async () => {
    const { call, calls } = fakeKube({ [OPEN]: list(ingress('open-fe', 'fe-b'), ingress('open-be', 'be-a')) })
    const report = await runPrepare(built(), 'b', call, fakeClock())
    expect(report.failure).toMatchObject({ kind: 'platform', code: 'LIVE_SLOT_PROTECTED', message: expect.stringContaining('interrupted switch') as string })
    expect(report.live).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('fails the quota check as a student problem with no Status, before clearing anything', async () => {
    const input = built()
    input.spec.services[0].runtime.resources = { cpu: '3', memory: '1Gi' }
    const { call, calls } = fakeKube({ [OPEN]: list() })
    const report = await runPrepare(input, 'a', call, fakeClock())
    expect(report.failure).toEqual({
      kind: 'student',
      service: null,
      errorMessage: 'resources of both slots exceed the project quota: requests.cpu 7 > 4, limits.cpu 10 > 8',
      raw: { pod: null, events: [], status: null },
    })
    expect(calls).toHaveLength(1)
  })

  it('reports a missing space as a platform problem', async () => {
    const status = { kind: 'Status', code: 404, reason: 'NotFound', message: 'namespaces "proj-my-app" not found', details: { name: 'proj-my-app', kind: 'namespaces' } }
    const { call } = fakeKube({ [OPEN]: refused(404, status) })
    expect((await runPrepare(built(), 'a', call, fakeClock())).failure).toEqual({ kind: 'platform', code: 'SPACE_MISSING', service: null, message: status.message, detail: status })
  })

  it('reports any other refusal as an unexpected platform refusal', async () => {
    const { call } = fakeKube({ [OPEN]: list(), ...slotList('a'), [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: refused(500, { kind: 'Status', code: 500, message: 'etcd timeout' }) })
    const report = await runPrepare(built(), 'a', call, fakeClock())
    expect(report.failure).toMatchObject({ kind: 'platform', code: 'UNEXPECTED_REFUSAL', message: 'etcd timeout' })
    expect(report.deleted).toEqual([])
  })

  it('reports an unreachable API as a platform problem', async () => {
    const { call } = fakeKube({ [OPEN]: new KubeError('K8S_TIMEOUT', 'GET x did not answer in 10s') })
    expect((await runPrepare(built(), 'a', call, fakeClock())).failure).toEqual({ kind: 'platform', code: 'K8S_TIMEOUT', service: null, message: 'GET x did not answer in 10s' })
  })

  it('waits until the Pods of the cleared slot are gone (terminating Pods still use the quota, #117)', async () => {
    let n = 0
    const terminating = { metadata: { name: 'be-a-7d9f-x', deletionTimestamp: '2026-11-12T00:00:00Z' } }
    const { call, calls } = fakeKube({
      [OPEN]: list(),
      ...slotList('a'),
      [TEST]: list(),
      [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: ok(),
      [`DELETE /apis/apps/v1${NS}/deployments/be-a`]: ok(),
      [`DELETE /api/v1${NS}/services/fe-a`]: ok(),
      [pods('a')]: () => (++n <= 3 ? list(terminating) : list()),
    })
    const clock = fakeClock()
    expect(await runPrepare(built(), 'a', call, clock)).toMatchObject({ ok: true, failure: null })
    expect(clock.sleeps).toEqual([PODS_GONE_POLL_MS, PODS_GONE_POLL_MS, PODS_GONE_POLL_MS])
    // 기다리기는 맨 끝이다: 지우기가 모두 끝난 뒤에 Pod를 본다.
    const podCalls = calls.map((c, i) => [c, i] as const).filter(([c]) => c.path.includes('/pods?'))
    expect(podCalls).toHaveLength(4)
    expect(podCalls[0][1]).toBeGreaterThan(calls.findLastIndex((c) => c.method === 'DELETE'))
  })

  it('does not sleep when the slot has no Pods', async () => {
    const { call } = fakeKube({ [OPEN]: list(), ...slotList('a'), [TEST]: list(), [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: ok(), [`DELETE /apis/apps/v1${NS}/deployments/be-a`]: ok(), [`DELETE /api/v1${NS}/services/fe-a`]: ok() })
    const clock = fakeClock()
    await runPrepare(built(), 'a', call, clock)
    expect(clock.sleeps).toEqual([])
  })

  it('fails as platform problem SLOT_PODS_LINGERING when Pods stay past the limit, naming them', async () => {
    const { call, calls } = fakeKube({
      [OPEN]: list(),
      ...slotList('a'),
      [TEST]: list(),
      [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: ok(),
      [`DELETE /apis/apps/v1${NS}/deployments/be-a`]: ok(),
      [`DELETE /api/v1${NS}/services/fe-a`]: ok(),
      [pods('a')]: list({ metadata: { name: 'fe-a-1' } }, { metadata: { name: 'be-a-2' } }),
    })
    const report = await runPrepare(built(), 'a', call, fakeClock())
    expect(report).toMatchObject({
      ok: false,
      deleted: ['Deployment/fe-a', 'Deployment/be-a', 'Service/fe-a'],
      failure: { kind: 'platform', code: 'SLOT_PODS_LINGERING', service: null, message: 'pods of slot a were still there 90s after clearing it: fe-a-1, be-a-2' },
    })
    // 2초마다 90초까지: 처음 한 번 + 45번 더 본다.
    expect(calls.filter((c) => c.path.includes('/pods?'))).toHaveLength(PODS_GONE_MAX_MS / PODS_GONE_POLL_MS + 1)
  })

  it('reports an unreachable API while waiting as a platform problem', async () => {
    const { call } = fakeKube({ [OPEN]: list(), ...slotList('a'), [TEST]: list(), [`DELETE /apis/apps/v1${NS}/deployments/fe-a`]: ok(), [`DELETE /apis/apps/v1${NS}/deployments/be-a`]: ok(), [`DELETE /api/v1${NS}/services/fe-a`]: ok(), [pods('a')]: new KubeError('K8S_TIMEOUT', 'GET pods did not answer in 10s') })
    expect((await runPrepare(built(), 'a', call, fakeClock())).failure).toEqual({ kind: 'platform', code: 'K8S_TIMEOUT', service: null, message: 'GET pods did not answer in 10s' })
  })
})
