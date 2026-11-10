// 메일 링크가 돌아오는 곳. 인증 링크는 로그인된 채로 프로필에서 GitHub 연동 안내를 만난다.
export const verifyRedirectTo = () => `${window.location.origin}/profile`
export const resetRedirectTo = () => `${window.location.origin}/reset-password`
