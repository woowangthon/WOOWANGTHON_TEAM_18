import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import App from './App.tsx'

// 화면을 채우는 이슈(#51~#57)는 각자 자기 페이지 파일을 고치므로, 여기서는 경로와 페이지의 연결만 본다.
const routes = [
  ['/login', '로그인'],
  ['/signup', '회원가입'],
  ['/reset-password', '비밀번호 재설정'],
  ['/profile', '프로필'],
  ['/deploy/new', '새 배포 요청'],
] as const

it.each(routes)('%s opens its page', (path, title) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title)
})
