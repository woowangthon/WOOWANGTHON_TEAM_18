import { passwordRules } from './form-rules.ts'

// 규칙마다 기호와 글자(충족 · 미충족)를 함께 보여 줘서 색만으로 뜻을 전하지 않는다.
function PasswordRules({ password, email }: { password: string; email: string }) {
  return (
    <ul aria-label="비밀번호 규칙" className="flex flex-col gap-1 text-sm">
      {passwordRules(password, email).map((rule) => (
        <li
          key={rule.label}
          className={`flex items-center gap-2 ${rule.met ? 'text-ok' : 'text-muted'}`}
        >
          <span aria-hidden="true">{rule.met ? '✓' : '○'}</span>
          <span>
            {rule.label} ({rule.met ? '충족' : '미충족'})
          </span>
        </li>
      ))}
    </ul>
  )
}

export default PasswordRules
