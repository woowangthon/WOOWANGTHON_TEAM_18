import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { describedBy } from './describedBy.ts'
import { Input } from './Input.tsx'

// 이름 · 오류 연결은 Field가 맡는다. 그래서 쓰는 쪽이 id와 aria를 넘기지 못하게 막는다.
type FieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'aria-label' | 'aria-labelledby' | 'aria-invalid' | 'aria-describedby'
> & {
  label: string
  error?: string
  // 입력칸 아래의 보조 설명. 오류와 함께 입력칸 설명(aria-describedby)에 이어진다.
  hint?: string
  // 입력칸 오른쪽에 붙는 버튼(예: 비밀번호 보기).
  trailing?: ReactNode
}

export function Field({ label, error, hint, trailing, ...rest }: FieldProps) {
  const id = useId()
  const labelId = `${id}-label`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1">
      <label id={labelId} htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-labelledby={labelId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error ? errorId : undefined, hint ? hintId : undefined)}
          {...rest}
        />
        {trailing}
      </div>
      {error ? (
        <span id={errorId} role="alert" className="text-sm text-err">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
