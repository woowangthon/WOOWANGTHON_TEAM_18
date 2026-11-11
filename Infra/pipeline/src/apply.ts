import type { Clock } from './build.js'
import type { DeployInput, Service, Slot } from './deploy-input.js'
import { clusterFailure, platformRefusal, type StageFailure, stripManaged } from './failure.js'
import { applyDoc, getJson, type KubeCall, KubeRefused, listItems, listPath, type ManifestDoc, splitManifest } from './kube.js'

// Apply(W5 마지막 스테이지, 리더 실행기): Render가 만든 slot.yaml을 AI → BE → FE 순서로 대상 슬롯에 server-side apply하고, 서비스마다 Ready를 기다린다.
// 기다리는 동안 대상 슬롯 Pod · 이벤트를 짧은 간격으로 읽어, 더 기다려도 나아지지 않는 신호는 제한 시간 전에 바로 실패로 끝낸다.
// 설계: docs/design/deploy-workflow.md §2 W5 · §4 "제한 시간" · "Apply의 빠른 실패". 실행기 권한은 Pod · 이벤트 · ReplicaSet 읽기뿐이다(로그 없음).

export const POLL_MS = 3000
/** 서비스마다 `startupTimeoutSeconds` + 이미지 받기 몫. 최대 7분 */
export const PULL_ALLOWANCE_S = 120
export const MAX_WAIT_S = 420

const ROLE_ORDER = ['ai', 'be', 'fe']

/** 서비스 하나의 Ready 대기 한도(초). */
export const waitLimitSeconds = (svc: Service) => Math.min(svc.runtime.health.startupTimeoutSeconds + PULL_ALLOWANCE_S, MAX_WAIT_S)

export type Signal = 'CrashLoopBackOff' | 'OOMKilled' | 'ImagePullBackOff' | 'ErrImagePull'

type Obj = Record<string, unknown>
const isRecord = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isRecord) : [])

/** Pod 하나에서 기다려도 나아지지 않는 신호를 찾는다. `startupProbe`가 끝내 실패해 재시작이 반복될 때도 CrashLoopBackOff로 온다. */
export function podSignal(pod: Obj): Signal | null {
  const status = isRecord(pod.status) ? pod.status : {}
  for (const c of [...arr(status.initContainerStatuses), ...arr(status.containerStatuses)]) {
    const waiting = isRecord(c.state) && isRecord(c.state.waiting) ? c.state.waiting.reason : undefined
    if (waiting === 'CrashLoopBackOff' || waiting === 'ImagePullBackOff' || waiting === 'ErrImagePull') return waiting
    for (const s of [c.state, c.lastState]) {
      if (isRecord(s) && isRecord(s.terminated) && s.terminated.reason === 'OOMKilled') return 'OOMKilled'
    }
  }
  return null
}

/** 이 서비스(`<서비스>-<슬롯>`)의 ReplicaSet이 쿼터 때문에 Pod를 못 만든 이벤트. */
export function quotaEvent(events: Obj[], fullName: string): Obj | null {
  return (
    events.find((e) => {
      const obj = isRecord(e.involvedObject) ? e.involvedObject : {}
      return obj.kind === 'ReplicaSet' && typeof obj.name === 'string' && obj.name.startsWith(`${fullName}-`) && e.reason === 'FailedCreate' && typeof e.message === 'string' && /exceeded quota/.test(e.message)
    }) ?? null
  )
}

/** 이벤트가 대상 슬롯의 리소스(`<서비스>-<슬롯>` 또는 그 아래 ReplicaSet · Pod)에 대한 것인가. */
const ofSlot = (fullNames: string[]) => (e: Obj) => {
  const name = isRecord(e.involvedObject) ? e.involvedObject.name : undefined
  return typeof name === 'string' && fullNames.some((n) => name === n || name.startsWith(`${n}-`))
}

/** Deployment가 새 Pod 하나를 Ready로 만들었는가. */
export function deploymentReady(dep: Obj): boolean {
  const status = isRecord(dep.status) ? dep.status : {}
  const generation = isRecord(dep.metadata) ? dep.metadata.generation : undefined
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  return n(status.observedGeneration) >= n(generation) && n(status.updatedReplicas) >= 1 && n(status.readyReplicas) >= 1
}

export interface ApplyReport {
  ok: boolean
  slot: Slot
  /** Ready가 된 서비스(적용 순서) */
  ready: string[]
  failure: StageFailure | null
}

/** slot.yaml의 문서를 서비스별 앱(ConfigMap · Service · Deployment)과 나머지(test Ingress · Middleware)로 나눈다. */
export function groupDocs(docs: ManifestDoc[], input: DeployInput, slot: Slot) {
  const byService = new Map(input.spec.services.map((s) => [s.name, [] as ManifestDoc[]]))
  const rest: ManifestDoc[] = []
  for (const doc of docs) {
    const owner = ['ConfigMap', 'Service', 'Deployment'].includes(doc.kind) ? input.spec.services.find((s) => doc.name === `${s.name}-${slot}`) : undefined
    if (owner) byService.get(owner.name)!.push(doc)
    else if (doc.kind === 'Ingress' || doc.kind === 'Middleware') rest.push(doc)
    else throw new Error(`slot manifest has ${doc.kind} ${doc.name} that belongs to no service of slot ${slot}`)
  }
  return { byService, rest }
}

/**
 * AI → BE → FE 순서로 서비스마다 적용하고 Ready를 기다린 뒤, test Ingress · Middleware를 적용한다(Verify가 그 길로 요청한다).
 * 실패: 빠른 실패 신호 · 시간 초과는 학생 문제(실패한 Pod 원본 · 대상 슬롯 이벤트 원본을 남긴다), 이미지 받기 실패 · 닿지 못함 · 플랫폼 거절은 플랫폼 문제.
 */
export async function runApply(input: DeployInput, slot: Slot, manifest: string, call: KubeCall, clock: Clock): Promise<ApplyReport> {
  const namespace = `proj-${input.spec.project.slug}`
  const ready: string[] = []
  const fail = (failure: StageFailure): ApplyReport => ({ ok: false, slot, ready, failure })
  const { byService, rest } = groupDocs(splitManifest(manifest, namespace), input, slot)
  const ordered = [...input.spec.services].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const fullNames = input.spec.services.map((s) => `${s.name}-${slot}`)

  let current: string | null = null
  try {
    for (const svc of ordered) {
      current = svc.name
      for (const doc of byService.get(svc.name)!) await applyDoc(call, doc)
      const failure = await waitReady(svc, `${svc.name}-${slot}`)
      if (failure) return fail(failure)
      ready.push(svc.name)
    }
    current = null
    for (const doc of rest) await applyDoc(call, doc)
  } catch (err) {
    if (err instanceof KubeRefused) {
      // dry-run을 통과한 manifest가 적용에서 거절되는 일은 드물다(그 사이 바뀐 것). Status는 render에만 싣는 계약이라 플랫폼 문제로 둔다.
      const platform = platformRefusal(err.status)
      return fail({ kind: 'platform', code: platform?.code ?? 'APPLY_REFUSED', service: current, message: err.message, detail: err.status })
    }
    return fail(clusterFailure(err, current))
  }
  return { ok: true, slot, ready, failure: null }

  // Ready가 되면 null, 아니면 실패. 신호를 보면 바로, 아니면 한도까지 기다린다.
  async function waitReady(svc: Service, fullName: string): Promise<StageFailure | null> {
    const limitMs = waitLimitSeconds(svc) * 1000
    const started = clock.now()
    for (;;) {
      if (deploymentReady(await getJson(call, `/apis/apps/v1/namespaces/${namespace}/deployments/${fullName}`))) return null
      const pods = await listItems(call, listPath('/api/v1', 'pods', namespace, `app=${svc.name},slot=${slot}`))
      const events = await listItems(call, listPath('/api/v1', 'events', namespace))
      const signaled = pods.map((p) => ({ pod: p, signal: podSignal(p) })).find((x) => x.signal !== null)
      const quota = quotaEvent(events, fullName)
      const timedOut = clock.now() - started >= limitMs
      if (signaled || quota || timedOut) {
        const raw = { pod: signaled ? stripManaged(signaled.pod) : pods[0] ? stripManaged(pods[0]) : null, events: events.filter(ofSlot(fullNames)).map(stripManaged), status: null }
        if (signaled?.signal === 'ImagePullBackOff' || signaled?.signal === 'ErrImagePull') {
          // 이미지는 공개 GHCR에 있다. 받지 못하는 것은 학생 spec으로 고칠 수 없는 플랫폼 문제다.
          return { kind: 'platform', code: 'IMAGE_PULL_FAILED', service: svc.name, message: `${fullName}: ${signaled.signal}`, detail: raw }
        }
        const why = signaled ? signaled.signal : quota ? `FailedCreate: ${String(quota.message)}` : `not Ready in ${waitLimitSeconds(svc)}s`
        return { kind: 'student', service: svc.name, errorMessage: `${fullName}: ${why}`, raw }
      }
      await clock.sleep(POLL_MS)
    }
  }
}
