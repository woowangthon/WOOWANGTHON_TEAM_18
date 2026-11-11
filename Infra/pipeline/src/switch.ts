import type { DeployInput, Slot } from './deploy-input.js'
import { clusterFailure, platformRefusal, type StageFailure } from './failure.js'
import { applyDoc, deleteObject, type KubeCall, KubeRefused, listItems, listPath, splitManifest } from './kube.js'

// Switch(전환, 리더 실행기): Render의 open.yaml(공개 주소 → 대상 슬롯)을 적용하고, 이번 배포에 없는 open Ingress와
// 지금 stripPrefix가 아닌 서비스의 Middleware를 지운다. 이전 슬롯을 0개로 줄이는 일은 하지 않는다: 플랫폼 서버가 전환 성공을 받아
// live_slot을 바꾼 뒤 줄인다(W7). 여기서 줄이다 실패하면 공개 주소는 이미 새 슬롯인데 Switch가 실패로 보고되어 live_slot이 어긋난다.
// 같은 open.yaml로 다시 돌려도 결과가 같다(server-side apply · 이미 없는 것 지우기). 그래서 전환이 중간에 끊겨
// open Ingress의 슬롯이 섞였으면 같은 실행의 Switch를 다시 돌리면 끝난다(deploy-workflow.md §4 "전환이 중간에 끊겼을 때").
// 실패는 모두 플랫폼 문제다: 대상 슬롯은 W6을 통과했고 학생이 고칠 것이 없다(BE는 switch 실패를 티켓 없이 마감한다).

export interface SwitchReport {
  ok: boolean
  slot: Slot
  /** 적용한 객체(`<종류>/<이름>`) */
  applied: string[]
  /** 지운 객체 */
  deleted: string[]
  failure: StageFailure | null
}

const INGRESSES = { base: '/apis/networking.k8s.io/v1', plural: 'ingresses' }
const MIDDLEWARES = { base: '/apis/traefik.io/v1alpha1', plural: 'middlewares' }

const nameOf = (obj: Record<string, unknown>) => {
  const name = (obj.metadata as { name?: unknown } | undefined)?.name
  return typeof name === 'string' ? name : ''
}

/** `openManifest`는 Render의 open.yaml. 공개 서비스가 없어 open.yaml이 없으면 null이다(open Ingress를 모두 지운다). */
export async function runSwitch(input: DeployInput, slot: Slot, openManifest: string | null, call: KubeCall): Promise<SwitchReport> {
  const namespace = `proj-${input.spec.project.slug}`
  const applied: string[] = []
  const deleted: string[] = []
  const report = (failure: StageFailure | null): SwitchReport => ({ ok: failure === null, slot, applied, deleted, failure })
  const docs = openManifest === null ? [] : splitManifest(openManifest, namespace)
  for (const doc of docs) {
    if (doc.kind !== 'Ingress' && doc.kind !== 'Middleware') throw new Error(`open manifest has ${doc.kind} ${doc.name}; only Ingress and Middleware switch`)
  }

  try {
    // 1. 공개 주소를 대상 슬롯으로(첫 배포면 만든다).
    for (const doc of docs) {
      await applyDoc(call, doc)
      applied.push(`${doc.kind}/${doc.name}`)
    }

    // 2. 이번 open.yaml에 없는 open Ingress(공개 서비스가 빠지거나 내부 전용이 됐다).
    const keepIngress = new Set(docs.filter((d) => d.kind === 'Ingress').map((d) => d.name))
    for (const ing of await listItems(call, listPath(INGRESSES.base, INGRESSES.plural, namespace, 'wanggane/ingress=open'))) {
      if (keepIngress.has(nameOf(ing))) continue
      await deleteObject(call, `${INGRESSES.base}/namespaces/${namespace}/${INGRESSES.plural}/${nameOf(ing)}`)
      deleted.push(`Ingress/${nameOf(ing)}`)
    }

    // 3. Middleware는 지금 stripPrefix인 공개 서비스의 것만 남긴다. 공간의 Middleware는 이 차트만 만든다(검사 규칙이 stripPrefix만 받는다).
    const keepMiddleware = new Set(input.spec.services.filter((s) => s.runtime.ingressPath !== null && s.runtime.stripPrefix).map((s) => `${s.name}-strip`))
    for (const mw of await listItems(call, listPath(MIDDLEWARES.base, MIDDLEWARES.plural, namespace))) {
      if (keepMiddleware.has(nameOf(mw))) continue
      await deleteObject(call, `${MIDDLEWARES.base}/namespaces/${namespace}/${MIDDLEWARES.plural}/${nameOf(mw)}`)
      deleted.push(`Middleware/${nameOf(mw)}`)
    }
  } catch (err) {
    if (err instanceof KubeRefused) {
      const platform = platformRefusal(err.status)
      return report({ kind: 'platform', code: platform?.code ?? 'SWITCH_REFUSED', service: null, message: err.message, detail: err.status })
    }
    return report(clusterFailure(err))
  }
  return report(null)
}
