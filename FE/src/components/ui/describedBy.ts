// 있는 설명의 id만 공백으로 잇는다. 하나도 없으면 속성을 달지 않는다.
export function describedBy(...ids: (string | undefined)[]) {
  const present = ids.filter(Boolean).join(' ')
  return present === '' ? undefined : present
}
