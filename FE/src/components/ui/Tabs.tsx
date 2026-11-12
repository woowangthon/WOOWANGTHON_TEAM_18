import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { tabClass } from './tabClass.ts'

// 탭 한 줄. 화면이 활성 탭을 정하고(active), 이 컴포넌트는 모양과 접근성만 맡는다.
// 선택 표시는 색이 아니라 굵기와 밑줄이다(accent-ui 밑줄 + 글자 굵게).
export function Tabs({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex gap-1 border-b border-line ${className}`}
      {...rest}
    />
  )
}

type TabProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }

export function Tab({ active = false, className = '', ...rest }: TabProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      className={`bg-transparent py-2 ${tabClass(active)} ${className}`}
      {...rest}
    />
  )
}
