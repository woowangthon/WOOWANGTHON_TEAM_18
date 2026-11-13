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

// 1코어 = 1000밀리코어. 학생에게는 코어로 보인다.
export const cpuText = (millicores: number) => `${(millicores / 1000).toFixed(2)}코어`
// 서버의 바이트를 1024 단위로 나눈 값이라 MiB다(운영자 화면의 GiB와 같은 단위 계열).
export const memoryText = (bytes: number) => `${Math.round(bytes / 1048576)}MiB`

// 시계열을 같은 간격의 칸으로 펼친다. 점이 없는 시각은 null로 둬서 그래프가 선을 끊게 한다(없는 값을 지어내지 않는다).
// 끝 시각은 여러 서비스를 같은 눈금에 맞추도록 호출하는 쪽이 정해 넘긴다(받은 점 중 가장 늦은 시각, latestT).
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

// 서비스들의 점 중 가장 늦은 시각. 그래프의 "최근 1시간"은 지금이 아니라 이 시각에서 끝나는 1시간이다(서버가 창의 끝을 주지 않는다). 점이 하나도 없으면 0이고, 그때는 어느 서비스도 칸을 만들지 않으므로 쓰이지 않는다.
export const latestT = (series: Series) =>
  Math.max(0, ...series.services.flatMap((s) => [...s.cpuMillicores, ...s.memoryBytes]).map((p) => p.t))
