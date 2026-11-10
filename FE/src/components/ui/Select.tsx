import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'

type Option = { value: string; label: string }

// Field와 같은 규칙: 이름 · 오류 연결은 이 컴포넌트가 맡아서 쓰는 쪽이 id와 aria를 넘기지 못하게 막는다.
type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'aria-label' | 'aria-labelledby' | 'aria-invalid' | 'aria-describedby' | 'children'
> & {
  label: string
  options: Option[]
  error?: string
}

export function SelectField({ label, options, error, className = '', ...rest }: SelectFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
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
    </div>
  )
}
