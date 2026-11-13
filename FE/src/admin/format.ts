// 시각은 이 브라우저의 시간대로. 읽을 수 없는 값이면 받은 글자를 그대로 보인다.
export function timeText(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ko-KR')
}
