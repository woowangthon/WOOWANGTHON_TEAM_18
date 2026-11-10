import type { DeployInput, Service, Slot } from './deploy-input.js'

// Render(W5): 배포 입력 + 이미지 digest + 슬롯 → student-app 차트의 values. 사람도 AI 에이전트도 manifest를 직접 쓰지 않는다.
// 설계: docs/design/deploy-workflow.md §3 · §4 "슬롯과 라벨" · "헬스체크", docs/design/deploy-handoff.md runtime.

/** `slot`: 대상 슬롯의 앱 + test Ingress. `open`: live로 바꿀 슬롯을 가리키는 open Ingress(Switch가 적용한다). */
export type Part = 'slot' | 'open'

type Quantities = { cpu: string; memory: string; 'ephemeral-storage': string }
export interface Resources {
  requests: Quantities
  limits: Quantities
}

/**
 * `resources`가 null인 컨테이너의 값. LimitRange 기본값(상한 CPU 2 · 임시 저장소 8Gi)에 맡기면 서비스 3 × 슬롯 2가 쿼터 상한을 넘어
 * (CPU 3 × 2 × 2 = 12 > 8, 임시 저장소 3 × 2 × 8Gi = 48Gi > 40Gi) 대상 슬롯의 마지막 Pod가 만들어지지 않는다.
 */
export const DEFAULT_RESOURCES: Resources = {
  requests: { cpu: '250m', memory: '256Mi', 'ephemeral-storage': '1Gi' },
  limits: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '4Gi' },
}

/** 프로젝트 공간의 ResourceQuota(Infra/student/space.yaml, docs/design/cluster.md §6). */
export const QUOTA = {
  requests: { cpu: '4', memory: '16Gi', 'ephemeral-storage': '10Gi' },
  limits: { cpu: '8', memory: '32Gi', 'ephemeral-storage': '40Gi' },
  pods: 10,
}

export interface ServiceValues {
  name: string
  fullName: string
  image: string
  port: number
  env: Record<string, string>
  secretKeys: string[]
  resources: Resources
  startupProbe: Record<string, unknown>
  readinessProbe: Record<string, unknown>
  ingressPath: string | null
  stripPrefix: boolean
}

export interface Values {
  part: Part
  slot: Slot
  secretHash: string | null
  hosts: { open: string; test: string }
  services: ServiceValues[]
}

const slotName = (name: string, slot: Slot) => `${name}-${slot}`

function resourcesOf(svc: Service): Resources {
  const r = svc.runtime.resources
  if (r === null) return DEFAULT_RESOURCES
  // 요청과 상한에 같은 값을 쓴다(docs/design/deploy-handoff.md runtime.resources). 임시 저장소는 늘 기본값이다.
  return {
    requests: { cpu: r.cpu, memory: r.memory, 'ephemeral-storage': DEFAULT_RESOURCES.requests['ephemeral-storage'] },
    limits: { cpu: r.cpu, memory: r.memory, 'ephemeral-storage': DEFAULT_RESOURCES.limits['ephemeral-storage'] },
  }
}

// http → httpGet(경로 health.path, 포트 port), tcp → tcpSocket(포트 port).
function probeOf(svc: Service, failureThreshold: number): Record<string, unknown> {
  const { health, port } = svc.runtime
  const check = health.type === 'http' ? { httpGet: { path: health.path, port } } : { tcpSocket: { port } }
  return { ...check, periodSeconds: 5, failureThreshold }
}

/**
 * 차트 values. 서비스 사이 주소(`links`)는 같은 슬롯끼리 잇는다: 슬롯 B의 BE에 `AI_URL=http://ai-b:<port>`.
 * 일반 env와 링크 주소는 슬롯마다 ConfigMap으로, 비밀 env는 key 이름만 넘겨 Secret `<서비스>-secrets`에서 읽는다.
 */
export function renderValues(input: DeployInput, slot: Slot, part: Part, domain: string): Values {
  const { spec } = input
  const byName = new Map(spec.services.map((s) => [s.name, s]))
  const services = spec.services.map((svc): ServiceValues => {
    const image = input.deploy_condition.services[svc.name].image
    if (image === null) throw new Error(`service ${svc.name} has no image digest (build first)`)
    const links = Object.fromEntries(
      svc.runtime.links.map(({ env, service }) => {
        const target = byName.get(service)
        if (!target) throw new Error(`service ${svc.name}: link ${env} points to unknown service ${service}`)
        return [env, `http://${slotName(service, slot)}:${target.runtime.port}`]
      }),
    )
    return {
      name: svc.name,
      fullName: slotName(svc.name, slot),
      image,
      port: svc.runtime.port,
      env: { ...svc.runtime.env, ...links },
      secretKeys: svc.runtime.secretKeys,
      resources: resourcesOf(svc),
      startupProbe: probeOf(svc, Math.ceil(svc.runtime.health.startupTimeoutSeconds / 5)),
      readinessProbe: probeOf(svc, 3),
      ingressPath: svc.runtime.ingressPath,
      stripPrefix: svc.runtime.stripPrefix,
    }
  })
  const { slug } = spec.project
  return { part, slot, secretHash: input.deploy_condition.secretHash, hosts: { open: `${slug}.${domain}`, test: `${slug}.test.internal` }, services }
}

/** 공개 서비스가 하나라도 있는가. 없으면 test · open Ingress를 만들지 않는다(docs/design/deploy-workflow.md §4). */
export const hasPublicService = (input: DeployInput) => input.spec.services.some((s) => s.runtime.ingressPath !== null)

// 쿠버네티스 수량 표기 중 우리가 쓰는 것: CPU는 `500m` · `1` · `0.5`, 크기는 `256Mi` · `2Gi` · `1G` · 바이트 수.
const UNITS: Record<string, number> = { '': 1, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40 }

/** 수량 문자열을 수로(CPU는 코어, 크기는 바이트). 읽을 수 없으면 NaN. */
export function quantity(v: string): number {
  const m = /^(\d+(?:\.\d+)?)(m|k|M|G|T|Ki|Mi|Gi|Ti)?$/.exec(v)
  return m ? Number(m[1]) * UNITS[m[2] ?? ''] : NaN
}

export interface QuotaIssue {
  /** `requests.cpu` 모양. 수량을 읽지 못한 서비스는 `services.<name>.resources` */
  field: string
  /** 두 슬롯을 합친 값과 상한(같은 단위) */
  used: number
  limit: number
}

/**
 * 두 슬롯이 같이 뜰 때의 합계(서비스 합 × 2)가 프로젝트 ResourceQuota 안인지 본다. 확인 중에는 live 슬롯과 대상 슬롯의 Pod가 같은 쿼터를 나눠 쓴다.
 * 넘는 항목마다 하나씩 알린다. 빈 목록이면 통과다.
 */
export function checkQuota(input: DeployInput): QuotaIssue[] {
  const issues: QuotaIssue[] = []
  const all = input.spec.services.map((s) => ({ name: s.name, r: resourcesOf(s) }))
  for (const { name, r } of all) {
    const values = [...Object.values(r.requests), ...Object.values(r.limits)]
    if (values.some((v) => !(quantity(v) > 0))) issues.push({ field: `services.${name}.resources`, used: NaN, limit: NaN })
  }
  if (issues.length > 0) return issues
  for (const kind of ['requests', 'limits'] as const) {
    for (const res of ['cpu', 'memory', 'ephemeral-storage'] as const) {
      const used = 2 * all.reduce((sum, { r }) => sum + quantity(r[kind][res]), 0)
      const limit = quantity(QUOTA[kind][res])
      // 소수 CPU(0.1 + 0.2)의 반올림 오차로 딱 맞는 합계가 넘친다고 하지 않게 아주 작은 여유를 둔다.
      if (used > limit * (1 + 1e-9)) issues.push({ field: `${kind}.${res}`, used, limit })
    }
  }
  if (2 * all.length > QUOTA.pods) issues.push({ field: 'pods', used: 2 * all.length, limit: QUOTA.pods })
  return issues
}

/** Render가 바깥에 맡기는 두 일. 테스트는 대역을 넣는다. */
export interface RenderTools {
  /** `helm template`의 출력(manifest YAML) */
  helmTemplate: (values: Values, namespace: string) => Promise<string>
  /** manifest를 클러스터에 적용하지 않고 서버 검사만(`--dry-run=server`). 실패면 k3s의 Status 원본(못 받았으면 null)과 그 message */
  dryRun: (manifest: string, namespace: string) => Promise<{ ok: true } | { ok: false; status: unknown; message: string }>
}

export type RenderFailure =
  | { kind: 'quota'; issues: QuotaIssue[] }
  | { kind: 'helm'; message: string }
  | { kind: 'dry-run'; part: Part; status: unknown; errorMessage: string }

export interface RenderReport {
  ok: boolean
  slot: Slot
  /** `slot`: 대상 슬롯 앱 + test Ingress, `open`: Switch가 적용할 open Ingress. 공개 서비스가 없으면 open은 null */
  manifests: { slot: string | null; open: string | null }
  failure: RenderFailure | null
}

/**
 * 쿼터 합계 × 2 검사 → values → `helm template` → `kubectl apply --dry-run=server`. 앞에서 걸리면 뒤는 하지 않는다.
 * 실패 종류: quota(spec의 resources를 고치면 된다), helm(차트 렌더 실패: 플랫폼 문제), dry-run(k3s Status 원본을 그대로 남긴다).
 */
export async function runRender(input: DeployInput, slot: Slot, domain: string, tools: RenderTools): Promise<RenderReport> {
  const fail = (failure: RenderFailure, manifests: RenderReport['manifests'] = { slot: null, open: null }): RenderReport => ({ ok: false, slot, manifests, failure })
  const issues = checkQuota(input)
  if (issues.length > 0) return fail({ kind: 'quota', issues })

  const namespace = `proj-${input.spec.project.slug}`
  const manifests: RenderReport['manifests'] = { slot: null, open: null }
  try {
    manifests.slot = await tools.helmTemplate(renderValues(input, slot, 'slot', domain), namespace)
    if (hasPublicService(input)) manifests.open = await tools.helmTemplate(renderValues(input, slot, 'open', domain), namespace)
  } catch (err) {
    return fail({ kind: 'helm', message: err instanceof Error ? err.message : String(err) })
  }

  for (const part of ['slot', 'open'] as const) {
    const manifest = manifests[part]
    if (manifest === null) continue
    const result = await tools.dryRun(manifest, namespace)
    if (!result.ok) return fail({ kind: 'dry-run', part, status: result.status, errorMessage: result.message }, manifests)
  }
  return { ok: true, slot, manifests, failure: null }
}
