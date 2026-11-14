import type { IncidentAi, IncidentRow } from './incidents.store.js'

/** 화면과 Discord에 보이는 한 줄. 모르는 경고는 이름 그대로 보인다. */
const TITLES: Record<string, string> = {
  KubePodCrashLooping: '서비스가 계속 다시 시작돼요',
  KubePodNotReady: '서비스가 준비되지 않은 채로 있어요',
  KubeContainerWaiting: '컨테이너가 시작하지 못하고 기다리고 있어요',
  KubeDeploymentReplicasMismatch: '서비스가 원하는 수만큼 뜨지 않아요',
  KubeDeploymentRolloutStuck: '새 버전으로 바꾸는 중에 멈췄어요',
  KubeDeploymentGenerationMismatch: '새 설정이 반영되지 않았어요',
  CPUThrottlingHigh: 'CPU 제한에 자주 걸려요',
  KubeQuotaAlmostFull: '자원 할당량이 거의 찼어요',
  KubeQuotaFullyUsed: '자원 할당량을 다 썼어요',
  KubeQuotaExceeded: '자원 할당량을 넘었어요',
  KubeJobFailed: '작업(Job)이 실패했어요',
  KubePersistentVolumeFillingUp: '저장 공간이 거의 찼어요',
}

export const titleOf = (alertname: string) => TITLES[alertname] ?? `클러스터 경고: ${alertname}`

const RISK = { low: '낮음', medium: '보통', high: '높음' } as const
const RECOMMENDATION = { stop: '중지', watch: '지켜보기', ignore: '무시해도 됨' } as const

function aiLines(ai: IncidentAi): string[] {
  if (ai.status === 'failed') return ['AI 판단을 받지 못했어요.']
  if (ai.status !== 'done' || !ai.risk || !ai.recommendation) return []
  return [`AI 판단: 위험 ${RISK[ai.risk]} · 권고 ${RECOMMENDATION[ai.recommendation]}`, `원인: ${ai.cause ?? '-'}`, `근거: ${ai.reason ?? '-'}`]
}

/** 운영자 Discord 글: 경고 이름과 다음에 할 일까지. */
export function operatorMessage(incident: IncidentRow): string {
  const head = `[${incident.slug}] ${titleOf(incident.alertname)} (${incident.alertname})`
  if (incident.action === 'auto_stopped') return `${head}\n규칙에 따라 서비스를 자동으로 멈췄어요.`
  return [head, ...aiLines(incident.ai), '운영자 화면의 "운영 알림"에서 중지나 무시를 정해 주세요.'].join('\n')
}

/** 학생 Discord 글. */
export function studentMessage(incident: IncidentRow): string {
  const head = `[${incident.slug}] ${titleOf(incident.alertname)}`
  if (incident.action === 'auto_stopped') return `${head}\n계속 다시 시작돼서 플랫폼이 서비스를 멈췄어요. 로그를 확인하고 고쳐서 다시 배포해 주세요.`
  return [head, ...aiLines(incident.ai), '운영자가 확인하고 있어요.'].join('\n')
}
