// 운영 알림 API의 응답 모양(스파이크 감지, docs/design/api.md).
export type IncidentAi = {
  status: 'pending' | 'done' | 'failed' | 'skipped'
  risk: 'low' | 'medium' | 'high' | null
  recommendation: 'stop' | 'watch' | 'ignore' | null
  // AI가 쓴 글이다. 서버 판단이 아니라 모델의 말이므로 그대로 글자로만 보인다.
  cause: string | null
  reason: string | null
  model: 'local' | 'planner' | null
}

// 알림을 연 때, 멈추기 전에 읽은 근거. 로그는 서버가 비밀값을 가린 값이다.
export type IncidentEvidence = {
  pod: string | null
  restarts: number
  waiting: string | null
  lastExit: { reason: string; exitCode: number } | null
  logs: string[]
}

export type Incident = {
  id: string
  slug: string
  alertname: string
  // 한국어 한 줄. 서버가 alertname으로 고른다.
  title: string
  state: 'firing' | 'resolved'
  firedAt: string
  resolvedAt: string | null
  action: 'auto_stopped' | 'pending' | 'stopped' | 'dismissed'
  ai: IncidentAi
  decidedAt: string | null
  evidence: IncidentEvidence | null
}

export type AdminIncident = Incident & { decidedBy: string | null }

export type IncidentsResponse = { incidents: Incident[] }
export type AdminIncidentsResponse = { incidents: AdminIncident[] }

// "열린 것": 아직 불이 꺼지지 않았고 운영자의 결정을 기다린다.
export const isOpen = (incident: Incident) => incident.state === 'firing' && incident.action === 'pending'

// 서비스를 멈춘 알림(자동 중지 · 운영자 중지).
export const isStopped = (incident: Incident) => incident.action === 'auto_stopped' || incident.action === 'stopped'

export const riskText = (risk: NonNullable<IncidentAi['risk']>) =>
  ({ low: '낮음', medium: '보통', high: '높음' })[risk]

export const recommendationText = (recommendation: NonNullable<IncidentAi['recommendation']>) =>
  ({ stop: '중지하기', watch: '지켜보기', ignore: '무시해도 돼요' })[recommendation]
