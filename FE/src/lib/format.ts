// 서버가 준 수량을 읽기 쉬운 글자로만 바꾼다. 값을 계산하거나 지어내지 않는다. 읽지 못한 칸(null)은 그렇게 말한다.
// 운영자 화면과 학생 화면이 같은 수량을 같은 글자로 보이도록 한 곳에 둔다.
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

// 노드처럼 큰 수량(GiB 한 자리).
export const bytesText = (bytes: number | null) =>
  bytes === null ? UNREADABLE : `${(bytes / 1024 ** 3).toFixed(1)} GiB`

// 서비스 하나처럼 작은 수량. 1024 단위라 MiB다(bytesText의 GiB와 같은 단위 계열).
export const memoryText = (bytes: number) => `${Math.round(bytes / 1048576)}MiB`
