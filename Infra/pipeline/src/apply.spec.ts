import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { deploymentReady, groupDocs, podSignal, quotaEvent, runApply, waitLimitSeconds } from './apply.js'
import type { DeployInput } from './deploy-input.js'
import { deployInput, digest } from './fixtures.js'
import { KubeError, splitManifest } from './kube.js'
import { fakeKube, list, ok, refused, type Route } from './kube-fake.js'

const NS = '/namespaces/proj-my-app'
// 진짜 helm으로 렌더한 슬롯 B manifest(fe · be · ai, BE는 stripPrefix).
const MANIFEST = readFileSync(new URL('__snapshots__/chart-slot-b.yaml', import.meta.url), 'utf8')

const built = (): DeployInput => {
  const i = deployInput()
  i.deploy_condition.services.fe.image = digest('d')
  i.deploy_condition.services.be.image = digest('e')
  return i
}

function fakeClock() {
  let t = 0
  return {
    sleep: vi.fn((ms: number) => {
      t += ms
      return Promise.resolve()
    }),
    now: () => t,
  }
}

const readyDep = { metadata: { generation: 1 }, status: { observedGeneration: 1, updatedReplicas: 1, readyReplicas: 1 } }
const notReady = { metadata: { generation: 1 }, status: { observedGeneration: 1, updatedReplicas: 1 } }
const pod = (name: string, containerStatuses: unknown[] = []) => ({
  metadata: { name, managedFields: [{ manager: 'k3s' }], annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}', keep: 'me' } },
  status: { phase: 'Pending', containerStatuses },
})
const waiting = (reason: string) => [{ name: 'c', state: { waiting: { reason } } }]

const pods = (svc: string) => `GET /api/v1${NS}/pods?labelSelector=app%3D${svc}%2Cslot%3Db`
const events = `GET /api/v1${NS}/events`
const dep = (svc: string) => `GET /apis/apps/v1${NS}/deployments/${svc}-b`

// 모든 PATCH(적용)는 통과하고, 세 서비스는 첫 조회에 Ready다.
function cluster(over: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {}
  for (const d of splitManifest(MANIFEST, 'proj-my-app')) routes[`PATCH ${d.path}`] = ok()
  for (const s of ['fe', 'be', 'ai']) {
    routes[dep(s)] = ok(readyDep)
    routes[pods(s)] = list()
  }
  routes[events] = list()
  return fakeKube({ ...routes, ...over })
}

describe('waitLimitSeconds', () => {
  it('is startupTimeoutSeconds + 120, at most 7 minutes', () => {
    const [fe, be, ai] = built().spec.services
    expect(waitLimitSeconds(fe)).toBe(130)
    expect(waitLimitSeconds(be)).toBe(180)
    expect(waitLimitSeconds(ai)).toBe(240)
    expect(waitLimitSeconds({ ...ai, runtime: { ...ai.runtime, health: { ...ai.runtime.health, startupTimeoutSeconds: 400 } } })).toBe(420)
  })
})

describe('podSignal', () => {
  it.each(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull'])('sees a container waiting with %s', (reason) => {
    expect(podSignal(pod('p', waiting(reason)))).toBe(reason)
  })
  it('sees OOMKilled as the last state of a restarted container', () => {
    expect(podSignal(pod('p', [{ state: { running: {} }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }]))).toBe('OOMKilled')
  })
  it('sees OOMKilled as the current state', () => {
    expect(podSignal(pod('p', [{ state: { terminated: { reason: 'OOMKilled' } } }]))).toBe('OOMKilled')
  })
  it('sees init containers too', () => {
    expect(podSignal({ status: { initContainerStatuses: waiting('CrashLoopBackOff') } })).toBe('CrashLoopBackOff')
  })
  it.each([
    ['still creating', waiting('ContainerCreating')],
    ['a plain error exit', [{ state: { terminated: { reason: 'Error', exitCode: 1 } } }]],
    ['no statuses yet', []],
  ])('waits on %s', (_, statuses) => {
    expect(podSignal(pod('p', statuses))).toBeNull()
  })
})

describe('quotaEvent', () => {
  const ev = (name: string, reason = 'FailedCreate', message = 'Error creating: pods "be-b-x" is forbidden: exceeded quota: project-cap') => ({
    involvedObject: { kind: 'ReplicaSet', name },
    reason,
    message,
  })
  it('finds a quota FailedCreate of this service ReplicaSet', () => {
    const e = ev('be-b-6c477f556d')
    expect(quotaEvent([e], 'be-b')).toBe(e)
  })
  it.each([
    ['another service whose name starts the same', ev('be-bx-6c477f556d')],
    ['another reason', ev('be-b-6c4', 'SuccessfulCreate')],
    ['a FailedCreate that is not the quota', ev('be-b-6c4', 'FailedCreate', 'admission webhook denied')],
  ])('ignores %s', (_, e) => {
    expect(quotaEvent([e], 'be-b')).toBeNull()
  })
})

describe('deploymentReady', () => {
  it('wants an updated, ready Pod of the current generation', () => {
    expect(deploymentReady(readyDep)).toBe(true)
    expect(deploymentReady(notReady)).toBe(false)
    expect(deploymentReady({ metadata: { generation: 2 }, status: { observedGeneration: 1, updatedReplicas: 1, readyReplicas: 1 } })).toBe(false)
    expect(deploymentReady({})).toBe(false)
  })
})

describe('groupDocs', () => {
  it('puts each service’s ConfigMap · Service · Deployment together and the Ingresses · Middleware last', () => {
    const { byService, rest } = groupDocs(splitManifest(MANIFEST, 'proj-my-app'), built(), 'b')
    expect(byService.get('be')!.map((d) => `${d.kind}/${d.name}`)).toEqual(['ConfigMap/be-b', 'Service/be-b', 'Deployment/be-b'])
    expect(rest.map((d) => `${d.kind}/${d.name}`)).toEqual(['Ingress/test-fe', 'Ingress/test-be', 'Middleware/be-strip'])
  })
  it('refuses a slot object that belongs to no service of that slot', () => {
    expect(() => groupDocs(splitManifest(MANIFEST, 'proj-my-app'), built(), 'a')).toThrow('slot manifest has ConfigMap fe-b that belongs to no service of slot a')
  })
})

describe('runApply', () => {
  it('applies AI → BE → FE, waiting for each to be Ready, then the test Ingresses and Middleware', async () => {
    const { call, calls } = cluster()
    const report = await runApply(built(), 'b', MANIFEST, call, fakeClock())
    expect(report).toEqual({ ok: true, slot: 'b', ready: ['ai', 'be', 'fe'], failure: null })
    const order = calls.filter((c) => c.method === 'PATCH' || c.path.includes('/deployments/')).map((c) => `${c.method} ${c.path.split('?')[0].split('/').slice(-2).join('/')}`)
    expect(order).toEqual([
      'PATCH configmaps/ai-b',
      'PATCH services/ai-b',
      'PATCH deployments/ai-b',
      'GET deployments/ai-b',
      'PATCH configmaps/be-b',
      'PATCH services/be-b',
      'PATCH deployments/be-b',
      'GET deployments/be-b',
      'PATCH configmaps/fe-b',
      'PATCH services/fe-b',
      'PATCH deployments/fe-b',
      'GET deployments/fe-b',
      'PATCH ingresses/test-fe',
      'PATCH ingresses/test-be',
      'PATCH middlewares/be-strip',
    ])
    // 적용은 dry-run이 아닌 server-side apply다.
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.path).toMatch(/\?fieldManager=student-app&force=true$/)
  })

  it('polls every 3 seconds until the Deployment is Ready', async () => {
    let n = 0
    const clock = fakeClock()
    const { call } = cluster({ [dep('ai')]: () => ok(++n < 3 ? notReady : readyDep) })
    expect((await runApply(built(), 'b', MANIFEST, call, clock)).ok).toBe(true)
    expect(clock.sleep.mock.calls).toEqual([[3000], [3000]])
  })

  it('fails fast on CrashLoopBackOff with the Pod (without managed fields) and the slot events', async () => {
    const crashing = pod('ai-b-x-y', waiting('CrashLoopBackOff'))
    const slotEvent = { metadata: { name: 'e1', managedFields: [] }, involvedObject: { kind: 'Pod', name: 'ai-b-x-y' }, reason: 'BackOff' }
    const otherEvent = { metadata: { name: 'e2' }, involvedObject: { kind: 'Pod', name: 'ai-a-x-y' }, reason: 'Started' }
    // 이름 앞부분만 같은 다른 객체(`ai-b`가 아니라 `ai-bx`)의 이벤트는 대상 슬롯 것이 아니다.
    const prefixEvent = { metadata: { name: 'e3' }, involvedObject: { kind: 'Pod', name: 'ai-bx-x-y' }, reason: 'Started' }
    const clock = fakeClock()
    const { call } = cluster({ [dep('ai')]: ok(notReady), [pods('ai')]: list(crashing), [events]: list(slotEvent, otherEvent, prefixEvent) })
    const report = await runApply(built(), 'b', MANIFEST, call, clock)
    expect(report).toEqual({
      ok: false,
      slot: 'b',
      ready: [],
      failure: {
        kind: 'student',
        service: 'ai',
        errorMessage: 'ai-b: CrashLoopBackOff',
        raw: {
          pod: { metadata: { name: 'ai-b-x-y', annotations: { keep: 'me' } }, status: crashing.status },
          events: [{ metadata: { name: 'e1' }, involvedObject: slotEvent.involvedObject, reason: 'BackOff' }],
          status: null,
        },
      },
    })
    expect(clock.sleep).not.toHaveBeenCalled()
  })

  it('fails fast on OOMKilled', async () => {
    const { call } = cluster({ [dep('be')]: ok(notReady), [pods('be')]: list(pod('be-b-x', [{ lastState: { terminated: { reason: 'OOMKilled' } } }])) })
    const report = await runApply(built(), 'b', MANIFEST, call, fakeClock())
    expect(report.ready).toEqual(['ai'])
    expect(report.failure).toMatchObject({ kind: 'student', service: 'be', errorMessage: 'be-b: OOMKilled' })
  })

  it('fails fast on a quota FailedCreate, with no Pod', async () => {
    const e = { metadata: { name: 'q' }, involvedObject: { kind: 'ReplicaSet', name: 'fe-b-123' }, reason: 'FailedCreate', message: 'pods "fe-b-123-x" is forbidden: exceeded quota: project-cap' }
    const { call } = cluster({ [dep('fe')]: ok(notReady), [events]: list(e) })
    const report = await runApply(built(), 'b', MANIFEST, call, fakeClock())
    expect(report.failure).toEqual({ kind: 'student', service: 'fe', errorMessage: `fe-b: FailedCreate: ${e.message}`, raw: { pod: null, events: [e], status: null } })
  })

  it.each(['ImagePullBackOff', 'ErrImagePull'])('reports %s as a platform problem, keeping the Pod and events', async (reason) => {
    const { call } = cluster({ [dep('ai')]: ok(notReady), [pods('ai')]: list(pod('ai-b-x', waiting(reason))) })
    const failure = (await runApply(built(), 'b', MANIFEST, call, fakeClock())).failure
    expect(failure).toMatchObject({ kind: 'platform', code: 'IMAGE_PULL_FAILED', service: 'ai', message: `ai-b: ${reason}` })
    expect(failure?.kind === 'platform' && (failure.detail as { pod: unknown }).pod).toMatchObject({ metadata: { name: 'ai-b-x' } })
  })

  it('times out after startupTimeoutSeconds + 120 with the first Pod as it is', async () => {
    const clock = fakeClock()
    const { call } = cluster({ [dep('ai')]: ok(notReady), [pods('ai')]: list(pod('ai-b-x', waiting('ContainerCreating'))) })
    const report = await runApply(built(), 'b', MANIFEST, call, clock)
    expect(report.failure).toMatchObject({ kind: 'student', service: 'ai', errorMessage: 'ai-b: not Ready in 240s', raw: { pod: { metadata: { name: 'ai-b-x' } } } })
    // 3초마다 보다가 240초째에 멈춘다(80번 잔다).
    expect(clock.sleep).toHaveBeenCalledTimes(80)
  })

  it('reports a refused apply as a platform problem with the Status', async () => {
    const status = { kind: 'Status', code: 409, reason: 'Conflict', message: 'the object has been modified' }
    const path = splitManifest(MANIFEST, 'proj-my-app').find((d) => d.name === 'be-b' && d.kind === 'Deployment')!.path
    const { call } = cluster({ [`PATCH ${path}`]: refused(409, status) })
    const report = await runApply(built(), 'b', MANIFEST, call, fakeClock())
    expect(report.failure).toEqual({ kind: 'platform', code: 'APPLY_REFUSED', service: 'be', message: 'the object has been modified', detail: status })
  })

  it('names the platform refusal (no executor permission)', async () => {
    const status = { kind: 'Status', code: 403, message: 'pods is forbidden: User "system:serviceaccount:deploy:deploy-executor" cannot list resource "pods"' }
    const { call } = cluster({ [dep('ai')]: ok(notReady), [pods('ai')]: refused(403, status) })
    expect((await runApply(built(), 'b', MANIFEST, call, fakeClock())).failure).toMatchObject({ kind: 'platform', code: 'EXECUTOR_FORBIDDEN', service: 'ai' })
  })

  it('reports an unreachable API as a platform problem of the service being applied', async () => {
    const { call } = cluster({ [dep('ai')]: new KubeError('K8S_UNREACHABLE', 'GET x failed: ECONNREFUSED') })
    expect((await runApply(built(), 'b', MANIFEST, call, fakeClock())).failure).toEqual({ kind: 'platform', code: 'K8S_UNREACHABLE', service: 'ai', message: 'GET x failed: ECONNREFUSED' })
  })

  it('reports a refused Ingress after every service is Ready with no service', async () => {
    const path = splitManifest(MANIFEST, 'proj-my-app').find((d) => d.name === 'test-fe')!.path
    const { call } = cluster({ [`PATCH ${path}`]: refused(500, { message: 'boom' }) })
    expect((await runApply(built(), 'b', MANIFEST, call, fakeClock())).failure).toMatchObject({ kind: 'platform', code: 'APPLY_REFUSED', service: null })
  })
})
