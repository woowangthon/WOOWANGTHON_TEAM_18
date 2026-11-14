// BE의 내 서비스 실행 지표 계약(docs/design/api.md "GET /api/deploys/:id/metrics")의 응답 모양과, 화면에 쓰기 위한 변환.
export type Usage = { cpuMillicores: number; memoryBytes: number } | null

export type MetricsService = {
  name: string
  deployment: string
  // running · starting · stopped. 서버가 새 값을 더해도 그리지 못하는 서비스가 없게 string으로 받는다.
  state: string
  waiting: string | null
  replicas: number
  readyReplicas: number
  // 지금 떠 있는 인스턴스 기준이라 새 배포나 교체 뒤에는 0으로 돌아간다.
  restarts: number
  usage: Usage
}

export type Point = { t: number; v: number }

export type Series = {
  status: 'collected' | 'not_collected'
  // 서버가 시계열을 물은 "지금"(유닉스 초). 그래프의 끝은 마지막 점이 아니라 이 값이다.
  endT: number
  windowSeconds: number
  stepSeconds: number
  services: { name: string; cpuMillicores: Point[]; memoryBytes: Point[] }[]
}

export type Metrics = {
  deployId: string
  slug: string
  state: 'live' | 'not_live'
  reason: 'not_succeeded' | 'superseded' | null
  slot: string | null
  services: MetricsService[]
  usageStatus: 'collected' | 'not_collected' | null
  series: Series | null
}

// 갱신 간격. 계약은 15초 이상을 권한다.
export const METRICS_POLL_MS = 15000

export const NOT_COLLECTED = '아직 수집하지 못했어요'

export const stateText = (state: string) => {
  switch (state) {
    case 'running':
      return '실행 중'
    case 'starting':
      return '시작하는 중'
    case 'stopped':
      return '꺼져 있어요'
    default:
      return '준비 중이에요'
  }
}

// 기다리는 이유를 학생이 알아볼 말로. 모르는 이유와 이유가 없는 경우는 준비 중이다.
export const waitingText = (waiting: string | null) => {
  switch (waiting) {
    case 'CrashLoopBackOff':
      return '시작하자마자 계속 꺼지고 있어요'
    case 'ImagePullBackOff':
    case 'ErrImagePull':
      return '이미지를 받지 못하고 있어요'
    default:
      return '준비 중이에요'
  }
}

// 시계열을 같은 간격의 칸으로 펼친다. 점이 없는 시각은 null로 둬서 그래프가 선을 끊게 한다(없는 값을 지어내지 않는다).
export function slotsOf(points: Point[], endT: number, windowSeconds: number, stepSeconds: number): (number | null)[] {
  if (points.length === 0) return []
  const count = Math.floor(windowSeconds / stepSeconds) + 1
  const slots: (number | null)[] = Array<number | null>(count).fill(null)
  const startT = endT - windowSeconds
  for (const { t, v } of points) {
    const i = Math.round((t - startT) / stepSeconds)
    if (i >= 0 && i < count) slots[i] = v
  }
  return slots
}

// i번째 칸의 시각을 "14:05"처럼(이 브라우저의 시간대). slotsOf의 칸 배치와 같은 식이다.
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
export const slotTimeText = ({ endT, windowSeconds, stepSeconds }: Pick<Series, 'endT' | 'windowSeconds' | 'stepSeconds'>, i: number) =>
  timeFormat.format(new Date((endT - windowSeconds + i * stepSeconds) * 1000))
