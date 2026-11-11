// 서버가 준 수량을 읽기 쉬운 글자로만 바꾼다. 값을 계산하거나 지어내지 않는다. 읽지 못한 칸(null)은 그렇게 말한다.
const UNREADABLE = '읽지 못함'

export const cpuText = (millicores: number | null) =>
  millicores === null ? UNREADABLE : `${Math.round(millicores / 100) / 10}코어`

export const bytesText = (bytes: number | null) =>
  bytes === null ? UNREADABLE : `${(bytes / 1024 ** 3).toFixed(1)} GiB`

// 시각은 이 브라우저의 시간대로. 읽을 수 없는 값이면 받은 글자를 그대로 보인다.
export function timeText(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}
