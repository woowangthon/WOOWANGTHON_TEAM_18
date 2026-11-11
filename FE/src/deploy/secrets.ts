// 비밀값 입력 폼(#83)이 부모와 주고받는 값. 서버 요청 · 응답 모양이 아니다(그 계약은 #43).
// pending: 아직 값을 받지 못한 key. in: 서버에 들어간 key(이름과 상태만 보인다). missing: 마지막 제출에서 서버가 빠졌다고 한 key.
export type SecretKeyState = 'pending' | 'in' | 'missing'
export type SecretTarget = { service: string; keys: { name: string; state: SecretKeyState }[] }
// 폼이 내보내는 값. 아직 필요한 key(in이 아닌 것)의 값만 담는다.
export type SecretEntry = { service: string; key: string; value: string }
