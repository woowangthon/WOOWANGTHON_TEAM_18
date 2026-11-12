import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent } from 'react'
import { tabClass } from './tabClass.ts'

// 탭 한 줄. 화면이 활성 탭을 정하고(active), 이 컴포넌트는 모양과 접근성만 맡는다.
// 선택 표시는 색이 아니라 굵기와 밑줄이다(accent-ui 밑줄 + 글자 굵게).
// 키보드: 활성 탭만 Tab 순서에 들어가고, 좌우 화살표와 Home · End가 탭 사이로 초점을 옮긴다(선택은 Enter · Space).
export function Tabs({
  className = '',
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'role'>) {
  return (
    <div
      role="tablist"
      className={`flex gap-1 border-b border-line ${className}`}
      {...rest}
    />
  )
}

// 방향키는 탭(버튼)이 받아 같은 tablist 안의 형제 탭으로 초점을 옮긴다.
function moveFocus(e: KeyboardEvent<HTMLButtonElement>) {
  // Alt+← (뒤로 가기) 같은 브라우저 단축키는 막지 않는다.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const list = e.currentTarget.closest('[role="tablist"]')
  const tabs = [...(list?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [])]
  const at = tabs.indexOf(e.currentTarget)
  if (at < 0) return
  e.preventDefault()
  const step = e.key === 'ArrowRight' ? 1 : -1
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + step + tabs.length) % tabs.length
  tabs[next].focus()
}

type TabProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }

export function Tab({ active = false, className = '', onKeyDown, ...rest }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        moveFocus(e)
      }}
      className={`bg-transparent py-2 ${tabClass(active)} ${className}`}
      {...rest}
    />
  )
}
