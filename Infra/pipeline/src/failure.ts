import { KubeError } from './kube.js'

// 스테이지 실패의 공통 모양. 학생 문제(문제 티켓으로 AI 에이전트에 간다)와 플랫폼 문제(코드로 보고, 에이전트를 부르지 않는다)로 나눈다.
// 학생 문제의 raw는 티켓 계약(docs/design/AIagent.md §5 `raw.k8s`)과 같은 모양이다: status는 render일 때만 있다.
// 플랫폼 코드 이름은 BE(#107)가 받을 목록이 정해지면 알림 task에서 맞춘다. 여기서는 문자열이다.

export interface K8sRaw {
  pod: Record<string, unknown> | null
  events: Record<string, unknown>[]
  status: unknown
}

export type StageFailure =
  | { kind: 'platform'; code: string; service: string | null; message: string; detail?: unknown }
  | { kind: 'student'; service: string | null; errorMessage: string; raw: K8sRaw }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * k3s가 거절한 답(Status)이 플랫폼 문제인지 본다. 학생 spec으로 고칠 수 없는 것들이다:
 * 공간(네임스페이스)이 없음, 실행기 계정 권한 없음(RBAC), 플랫폼 검사 규칙(`wanggane-*`) 거절 = 차트가 규칙과 어긋남.
 * 쿼터 초과(`exceeded quota`)도 403이지만 학생 자원 값으로 고칠 수 있어 플랫폼 문제가 아니다. 그 밖은 null(학생 문제).
 */
export function platformRefusal(status: unknown): { code: string; message: string } | null {
  if (!isRecord(status)) return null
  const message = typeof status.message === 'string' ? status.message : ''
  const details = isRecord(status.details) ? status.details : {}
  if (status.code === 404 && (details.kind === 'namespaces' || /namespaces "[^"]+" not found/.test(message))) return { code: 'SPACE_MISSING', message }
  if (status.code === 403 && /cannot [a-z]+ resource/.test(message)) return { code: 'EXECUTOR_FORBIDDEN', message }
  if (/ValidatingAdmissionPolicy '?wanggane-/.test(message)) return { code: 'POLICY_REJECTED', message }
  return null
}

/** k3s API에 닿지 못한 실패(KubeError)는 플랫폼 문제다. 다른 오류는 그대로 던진다(코드 버그). */
export function clusterFailure(err: unknown, service: string | null = null): StageFailure {
  if (err instanceof KubeError) return { kind: 'platform', code: err.code, service, message: err.message }
  throw err
}

/** 객체 원본에서 관리 기록(`managedFields`, 적용 기록 annotation)을 뺀다. 티켓을 작게 하고, 지난 적용의 spec 원문이 같이 실려 가지 않게 한다. */
export function stripManaged<T>(obj: T): T {
  if (!isRecord(obj) || !isRecord(obj.metadata)) return obj
  const metadata: Record<string, unknown> = { ...obj.metadata }
  delete metadata.managedFields
  if (isRecord(metadata.annotations)) {
    const annotations = { ...metadata.annotations }
    delete annotations['kubectl.kubernetes.io/last-applied-configuration']
    metadata.annotations = annotations
  }
  return { ...obj, metadata }
}

/** 실행기 로그 한 줄용 요약. 원본은 결과 파일에 있다. */
export const describe = (f: StageFailure) => (f.kind === 'platform' ? `platform ${f.code}` : `student${f.service ? ` (${f.service})` : ''}: ${f.errorMessage}`)
