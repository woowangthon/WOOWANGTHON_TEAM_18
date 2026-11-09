// RequireAuth가 /login으로 보낼 때 담는 값. 로그인 화면이 읽는다.
export type LoginState = {
  // 로그인 뒤 돌아갈 경로(검색어와 해시 포함).
  from?: string
  // 로그인돼 있던 세션이 저절로 끝났는가. 참이면 세션 만료 안내를 보인다.
  expired?: boolean
}

// 앱 안의 경로만 받는다. `//host`나 `/\host`는 다른 사이트로 가는 주소로 읽힌다. 브라우저가 URL에서 지우는 탭 · 줄바꿈이
// 끼면 `/\t/host`가 `//host`가 되므로 공백 · 제어 문자가 든 값도 버린다.
const INTERNAL_PATH = /^\/(?![/\\])\S*$/
function isInternalPath(value: string): boolean {
  return INTERNAL_PATH.test(value)
}

// location.state는 어디서든 넣을 수 있는 값이라 모양을 믿지 않고 읽는다.
export function readLoginState(state: unknown): LoginState {
  if (typeof state !== 'object' || state === null) return {}
  const { from, expired } = state as Record<string, unknown>
  return {
    from: typeof from === 'string' && isInternalPath(from) ? from : undefined,
    expired: expired === true,
  }
}
