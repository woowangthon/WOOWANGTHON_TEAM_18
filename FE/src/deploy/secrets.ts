// 비밀값 입력 폼(#83)이 부모와 주고받는 값. 서버 요청 · 응답 모양이 아니다(그 계약은 #43).
export type SecretTarget = { service: string; keys: string[] }
export type SecretEntry = { service: string; key: string; value: string }

// 서비스 이름과 key를 하나로 묶은 식별자. 어느 key가 들어갔는지 · 빠졌는지를 Set으로 주고받는 데 쓴다.
export const secretId = (service: string, key: string) => `${service}/${key}`
