import type { DeployInput, Slot } from './deploy-input.js'
import { clusterFailure, platformRefusal, type StageFailure } from './failure.js'
import { deleteObject, type KubeCall, KubeRefused, listItems, listPath } from './kube.js'
import { checkQuota, type QuotaIssue } from './render.js'

// Prepare(W5 첫 스테이지, 리더 실행기): live 슬롯 보호 → 자원 합계 검사 → 대상 슬롯 비우기 → 남은 test Ingress 정리.
// 설계: docs/design/deploy-workflow.md §2 W5 · §4 "흐름" · "남은 Ingress 정리". 실행기 권한(proj-deployer)은 목록 · 지우기만 쓴다.
// 필수 Secret key는 실행기가 Secret을 읽지 못해 여기서 보지 않는다(BE가 배포 시작 때 확인한다).

const SLOT_SUFFIX = /-(a|b)$/

/** open Ingress들의 backend Service 이름에서 읽은 지금 live 슬롯. 없으면 null(첫 배포), 섞였으면 'mixed'. */
export function liveSlotOf(openIngresses: Record<string, unknown>[]): Slot | null | 'mixed' {
  const slots = new Set<string>()
  for (const ing of openIngresses) {
    const rules = ((ing.spec as { rules?: unknown } | undefined)?.rules ?? []) as { http?: { paths?: { backend?: { service?: { name?: unknown } } }[] } }[]
    for (const rule of rules) {
      for (const p of rule.http?.paths ?? []) {
        const name = p.backend?.service?.name
        const m = typeof name === 'string' ? SLOT_SUFFIX.exec(name) : null
        // 슬롯 이름이 아닌 backend는 우리 차트가 만든 것이 아니다. 어느 슬롯인지 모르므로 섞인 것으로 본다.
        slots.add(m ? m[1] : '?')
      }
    }
  }
  if (slots.size === 0) return null
  if (slots.size > 1 || slots.has('?')) return 'mixed'
  return [...slots][0] as Slot
}

const gib = (bytes: number) => `${Math.round((bytes / 2 ** 30) * 100) / 100}Gi`

/** 쿼터 초과를 사람이 읽고 에이전트가 정규식으로 맞출 수 있는 한 문장으로(case P2는 Status 없이 이 문장으로 대조한다). */
export function quotaMessage(issues: QuotaIssue[]): string {
  const parts = issues.map((i) => {
    if (Number.isNaN(i.used)) return `${i.field} unreadable`
    const show = i.field.endsWith('.cpu') || i.field === 'pods' ? String : gib
    return `${i.field} ${show(i.used)} > ${show(i.limit)}`
  })
  return `resources of both slots exceed the project quota: ${parts.join(', ')}`
}

export interface PrepareReport {
  ok: boolean
  slot: Slot
  /** 비우기 전 open Ingress가 가리키던 슬롯. null이면 첫 배포 */
  live: Slot | null
  /** 지운 객체(`<종류>/<이름>`) */
  deleted: string[]
  failure: StageFailure | null
}

// 대상 슬롯을 비울 때 지우는 종류. Secret · Middleware · Ingress는 슬롯 라벨이 없어 남는다.
const SLOT_KINDS = [
  { kind: 'Deployment', base: '/apis/apps/v1', plural: 'deployments' },
  { kind: 'Service', base: '/api/v1', plural: 'services' },
  { kind: 'ConfigMap', base: '/api/v1', plural: 'configmaps' },
]
const INGRESSES = { base: '/apis/networking.k8s.io/v1', plural: 'ingresses' }

const nameOf = (obj: Record<string, unknown>) => String((obj.metadata as { name?: unknown } | undefined)?.name ?? '')

/** 대상 슬롯에 배포할 준비를 한다. 앞에서 걸리면 뒤는 하지 않는다(보호에 걸리면 아무것도 지우지 않는다). */
export async function runPrepare(input: DeployInput, slot: Slot, call: KubeCall): Promise<PrepareReport> {
  const namespace = `proj-${input.spec.project.slug}`
  const deleted: string[] = []
  let live: Slot | null = null
  const fail = (failure: StageFailure): PrepareReport => ({ ok: false, slot, live, deleted, failure })

  try {
    // 1. live 슬롯 보호. DB의 live_slot이 틀려도 클러스터가 가리키는 슬롯은 지우지 않는다.
    const open = await listItems(call, listPath(INGRESSES.base, INGRESSES.plural, namespace, 'wanggane/ingress=open'))
    const current = liveSlotOf(open)
    if (current === 'mixed') {
      // 전환이 중간에 끊긴 상태다. 복구(전환을 끝까지 다시 하기)는 Switch · 상태 맞추기의 몫이고 여기서는 멈춘다.
      return fail({ kind: 'platform', code: 'LIVE_SLOT_PROTECTED', service: null, message: 'open Ingresses point to different slots (an interrupted switch); finish the switch before deploying' })
    }
    live = current
    if (current === slot) {
      return fail({ kind: 'platform', code: 'LIVE_SLOT_PROTECTED', service: null, message: `slot ${slot} is live (open Ingresses point to it); refusing to clear it` })
    }

    // 2. 두 슬롯이 같이 떠도 쿼터 안인가(case P2: Status 없는 prepare 문제).
    const issues = checkQuota(input)
    if (issues.length > 0) return fail({ kind: 'student', service: null, errorMessage: quotaMessage(issues), raw: { pod: null, events: [], status: null } })

    // 3. 대상 슬롯 비우기. 실행기 권한에 deletecollection이 없어 목록을 읽고 하나씩 지운다.
    for (const { kind, base, plural } of SLOT_KINDS) {
      for (const obj of await listItems(call, listPath(base, plural, namespace, `slot=${slot}`))) {
        await deleteObject(call, `${base}/namespaces/${namespace}/${plural}/${nameOf(obj)}`)
        deleted.push(`${kind}/${nameOf(obj)}`)
      }
    }

    // 4. 이번 배포에 없는 test Ingress 정리(공개 서비스가 빠지거나 내부 전용이 됐다). open 쪽은 Switch가 정리한다.
    const keep = new Set(input.spec.services.filter((s) => s.runtime.ingressPath !== null).map((s) => `test-${s.name}`))
    for (const ing of await listItems(call, listPath(INGRESSES.base, INGRESSES.plural, namespace, 'wanggane/ingress=test'))) {
      if (keep.has(nameOf(ing))) continue
      await deleteObject(call, `${INGRESSES.base}/namespaces/${namespace}/${INGRESSES.plural}/${nameOf(ing)}`)
      deleted.push(`Ingress/${nameOf(ing)}`)
    }
  } catch (err) {
    if (err instanceof KubeRefused) {
      const platform = platformRefusal(err.status)
      return fail({ kind: 'platform', code: platform?.code ?? 'UNEXPECTED_REFUSAL', service: null, message: err.message, detail: err.status })
    }
    return fail(clusterFailure(err))
  }
  return { ok: true, slot, live, deleted, failure: null }
}
