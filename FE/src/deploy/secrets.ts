import { issueText } from './issues.ts'
import { SECRET_VALUE_MAX } from './limits.ts'

// 비밀값 입력 폼(#83)이 부모와 주고받는 값. 서버 요청 · 응답 모양이 아니다(그 모양은 docs/design/api.md "비밀값").
// 서버는 서비스 단위로 전부 들어가거나 전부 빠진 것으로 알려 주고, 서비스를 보낼 때는 그 서비스의 key를 모두 보내야 한다.
// 그래서 상태는 key가 아니라 서비스에 둔다. done: 서버에 들어가 있다(이름만 보인다).
export type SecretTarget = { service: string; keys: string[]; done: boolean }
// 폼이 내보내는 값. 아직 필요한 서비스(또는 값을 바꾸려는 서비스)의 key를 모두 담는다. 값은 다듬지 않은 그대로다.
export type SecretEntry = { service: string; key: string; value: string }

// 서버가 한 값에 대해 알려 주는 문제(400 INVALID_SECRETS의 fields 코드)를 사용자에게 보일 문장으로. 길이 초과만 비밀값에 맞춘 문장이다.
export const secretIssueText = (code: string) =>
  code === 'OUT_OF_RANGE' ? `값이 너무 길어요. ${SECRET_VALUE_MAX.toLocaleString('ko-KR')}자까지 넣을 수 있어요` : issueText(code)

// GET · PUT /api/deploys/:id/secrets의 응답(docs/design/api.md "비밀값"). 값은 없다. secretKeys가 있는 서비스만 나온다.
export type SecretsState = {
  ready: boolean
  secretHash: string | null
  services: { name: string; status: 'in' | 'missing'; keys: { key: string; status: 'in' | 'missing' }[] }[]
}

// 서버의 상태를 폼이 받는 모양으로. 서비스는 전부 들어가거나 전부 빠지므로 서비스의 status 하나만 본다.
export const targetsOf = ({ services }: SecretsState): SecretTarget[] =>
  services.map((s) => ({ service: s.name, keys: s.keys.map((k) => k.key), done: s.status === 'in' }))

// 폼이 내보낸 값을 PUT 요청 본문으로. 값은 다듬지 않는다.
export const secretsBodyOf = (entries: SecretEntry[]) => {
  const services: Record<string, Record<string, string>> = {}
  for (const { service, key, value } of entries) (services[service] ??= {})[key] = value
  return { services }
}
