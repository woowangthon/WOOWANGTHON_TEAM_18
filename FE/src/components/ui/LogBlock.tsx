import { Children, type HTMLAttributes } from 'react'

const variants = {
  INFO: 'text-muted',
  WARN: 'text-warn',
  ERROR: 'text-err',
}

// 레벨 단어만 색을 입힌다. 단어 매칭이라 본문 속 ERROR도 칠해진다. 색만으로 전달하지 않도록 글자는 그대로 둔다.
function colorLevels(text: string) {
  return text
    .split(/\b(INFO|WARN|ERROR)\b/)
    .map((part, i) =>
      i % 2 === 1 ? (
        <span key={i} className={variants[part as keyof typeof variants]}>
          {part}
        </span>
      ) : (
        part
      ),
    )
}

// 가로로 스크롤되는 영역이라 키보드로 포커스할 수 있어야 하고, 그러려면 이름이 필요하다.
// role="log"는 라이브 영역이라 줄이 늘 때마다 읽어 주므로 쓰지 않는다.
export function LogBlock({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLPreElement> & { 'aria-label': string }) {
  return (
    <pre
      role="region"
      tabIndex={0}
      className={`overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-sm ${className}`}
      {...rest}
    >
      {Children.map(children, (c) => (typeof c === 'string' ? colorLevels(c) : c))}
    </pre>
  )
}
