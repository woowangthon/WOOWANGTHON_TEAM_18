import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { makeQueryClient } from './lib/query.ts'

// 읽기를 기억해 두는 화면을 시험에서 그릴 때 감싼다. 시험마다 새 기억 장치를 쓴다.
export function WithQuery({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
