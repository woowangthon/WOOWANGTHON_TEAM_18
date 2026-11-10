import { useState } from 'react'
import { Button } from './ui/Button.tsx'
import { Field } from './ui/Field.tsx'

// 비밀번호 보기 버튼의 그림. 버튼 이름은 aria-label이 맡으므로 그림은 스크린리더에서 숨긴다.
// 눈을 뜬 모양은 "보기", 사선이 그어진 모양은 "숨기기"다.
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  )
}

type PasswordFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder: string
  error?: string
  disabled?: boolean
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  disabled,
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  return (
    <Field
      label={label}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      error={error}
      disabled={disabled}
      trailing={
        <Button
          variant="outline"
          aria-label={`${label} ${shown ? '숨기기' : '보기'}`}
          onClick={() => {
            setShown((current) => !current)
          }}
          disabled={disabled}
        >
          <EyeIcon crossed={shown} />
        </Button>
      }
    />
  )
}

export default PasswordField
