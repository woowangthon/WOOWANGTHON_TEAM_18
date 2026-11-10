import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { describedBy } from './describedBy.ts'

type Option = { value: string; label: string }

// Field와 같은 규칙: 이름 · 오류 연결은 이 컴포넌트가 맡아서 쓰는 쪽이 id와 aria를 넘기지 못하게 막는다.
type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'aria-label' | 'aria-labelledby' | 'aria-invalid' | 'aria-describedby' | 'children' | 'onChange'
> & {
  label: string
  options: Option[]
  error?: string
  hint?: string
  // 이벤트가 아니라 고른 값을 받는다.
  onChange: (value: string) => void
}

export function SelectField({ label, options, error, hint, onChange, className = '', ...rest }: SelectFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error ? errorId : undefined, hint ? hintId : undefined)}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={`h-8 w-full rounded-sm border border-line-strong bg-bg px-2 aria-invalid:border-err text-sm text-fg disabled:border-line disabled:bg-surface disabled:text-muted ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
