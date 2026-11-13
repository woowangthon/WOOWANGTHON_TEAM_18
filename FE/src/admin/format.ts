// 서버가 준 수량을 읽기 쉬운 글자로만 바꾼다. 값을 계산하거나 지어내지 않는다. 읽지 못한 칸(null)은 그렇게 말한다.
const UNREADABLE = '읽지 못함'

// 0.1코어(100m) 미만은 소수 한 자리로 반올림하면 실제 사용량이 0으로 보이므로 둘째 자리까지 보인다.
// 둘째 자리로도 0이 되는 값(5m 미만)은 0이 아니라고 말한다. 정확히 0과 0.1코어 이상은 그대로다.
export function cpuText(millicores: number | null) {
  if (millicores === null) return UNREADABLE
  if (millicores > 0 && millicores < 100) {
    const hundredths = Math.round(millicores / 10)
    return hundredths === 0 ? '0.01코어 미만' : `${hundredths / 100}코어`
  }
  return `${Math.round(millicores / 100) / 10}코어`
}

export const bytesText = (bytes: number | null) =>
  bytes === null ? UNREADABLE : `${(bytes / 1024 ** 3).toFixed(1)} GiB`

// 시각은 이 브라우저의 시간대로. 읽을 수 없는 값이면 받은 글자를 그대로 보인다.
export function timeText(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}
