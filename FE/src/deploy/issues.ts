import type { Issue } from './types.ts'

// 서버 오류 코드를 입력칸 아래에 보일 문장으로 바꾼다. 문장이 아니라 코드로 구분한다.
const copy: Record<string, string> = {
  REQUIRED: '입력해 주세요',
  MUST_BE_NULL: '이 칸은 비워야 해요',
  INVALID_TYPE: '값의 형식이 맞지 않아요',
  INVALID_VALUE: '쓸 수 없는 값이에요',
  OUT_OF_RANGE: '허용 범위를 벗어났어요',
  DUPLICATE: '다른 칸과 겹쳐요',
  UNKNOWN_KEY: '알 수 없는 칸이에요',
  UNKNOWN_SERVICE: '없는 서비스를 가리켜요',
  RESERVED: '예약된 이름이라 쓸 수 없어요',
  CONFLICT: '다른 칸과 맞지 않아요',
  MISMATCH: '확인한 레포와 달라요',
  SLUG_TAKEN: '이미 다른 배포가 쓰는 이름이에요',
}

export const issueText = (code: string) => copy[code] ?? '값을 확인해 주세요'

// path → 보일 문장. 한 칸에 코드는 하나이므로 먼저 온 것을 쓴다.
export function issueMap(issues: Issue[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const { path, code } of issues) if (!map.has(path)) map.set(path, issueText(code))
  return map
}

// 화면에 입력칸이 없는 경로(고정값 · 서비스 개수 · 확인한 레포). 칸 옆에 보일 수 없어 요약에 따로 적는다.
const NO_FIELD = /^(services|project\.repo|services\[\d+\]\.runtime\.(resources|stripPrefix))$/
export const withoutField = (issues: Issue[]) => issues.filter((i) => NO_FIELD.test(i.path))
