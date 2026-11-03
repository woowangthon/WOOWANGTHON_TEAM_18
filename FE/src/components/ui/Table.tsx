import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react'

// 가로로 스크롤되는 영역이라 키보드로 포커스할 수 있어야 하고, 그러려면 이름이 필요하다.
export function Table({
  className = '',
  'aria-label': label,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { 'aria-label': string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="w-fit max-w-full overflow-x-auto rounded-md border border-line"
    >
      <table
        className={`border-collapse text-left text-sm [&_tbody_tr:last-child_td]:border-b-0 ${className}`}
        {...rest}
      />
    </div>
  )
}

export function THead({
  className = '',
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-surface ${className}`} {...rest} />
}

type CellProps = { numeric?: boolean }

export function Th({
  numeric,
  className = '',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={`border-b border-line px-3 py-2 text-sm font-bold whitespace-nowrap text-muted ${numeric ? 'text-right' : ''} ${className}`}
      {...rest}
    />
  )
}

export function Td({
  numeric,
  className = '',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      // 숫자는 나눔스퀘어 네오가 고정 폭이 아니라서(tabular-nums 효과 없음) 고정폭 글꼴로 자릿수를 맞춘다.
      className={`border-b border-line px-3 py-2 whitespace-nowrap ${numeric ? 'text-right font-mono' : ''} ${className}`}
      {...rest}
    />
  )
}
