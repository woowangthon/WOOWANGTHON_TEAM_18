import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api.ts'
import type { DeployListItem } from './progress.ts'

export type DeploysState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; deploys: DeployListItem[] }

// 내 배포 목록(GET /api/deploys)을 읽는다. 실패를 "배포 없음"으로 바꾸지 않는다(로그인 만료는 apiFetch가 로그아웃시킨다).
export function useDeploys(): { state: DeploysState; retry: () => void } {
  const [state, setState] = useState<DeploysState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    apiFetch<{ deploys: DeployListItem[] }>('/api/deploys')
      .then(({ deploys }) => {
        if (!ignore) setState({ status: 'ready', deploys })
      })
      .catch(() => {
        if (!ignore) setState({ status: 'failed' })
      })
    return () => {
      ignore = true
    }
  }, [attempt])

  return {
    state,
    retry: () => {
      setState({ status: 'loading' })
      setAttempt((count) => count + 1)
    },
  }
}
