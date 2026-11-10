export const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 이메일 칸의 오류 문구. 맞으면 undefined.
export function emailError(email: string): string | undefined {
  if (email === '') return '이메일을 입력해 주세요'
  if (!EMAIL_FORMAT.test(email)) return '올바른 이메일 형식이 아니에요. 예: name@example.com'
  return undefined
}

export type PasswordRule = { label: string; met: boolean; error: string }

// 가입 · 재설정이 같은 규칙을 쓴다. 서버(Supabase)가 더 엄격하면 weak_password로 따로 알린다.
export function passwordRules(password: string, email: string): PasswordRule[] {
  return [
    { label: '8자 이상', met: password.length >= 8, error: '8자 이상이어야 해요' },
    {
      label: '영문과 숫자를 함께 사용',
      met: /[A-Za-z]/.test(password) && /\d/.test(password),
      error: '영문과 숫자를 함께 써 주세요',
    },
    {
      label: '이메일 주소와 다름',
      met: password !== '' && password.toLowerCase() !== email.trim().toLowerCase(),
      error: '이메일 주소와 다른 비밀번호를 써 주세요',
    },
  ]
}

// 비밀번호 칸의 오류 문구. 지키지 못한 첫 규칙을 알려 준다.
export function passwordError(password: string, email: string): string | undefined {
  if (password === '') return '비밀번호를 입력해 주세요'
  return passwordRules(password, email).find((rule) => !rule.met)?.error
}

export function confirmError(password: string, confirm: string): string | undefined {
  if (confirm === '') return '비밀번호를 한 번 더 입력해 주세요'
  if (confirm !== password) return '비밀번호가 서로 달라요'
  return undefined
}
