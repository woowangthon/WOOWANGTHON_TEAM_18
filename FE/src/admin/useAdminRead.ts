import { useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../lib/api.ts'

// 운영자 화면이 새로 읽는 간격. 클러스터를 너무 자주 두드리지 않으려고 학생 화면의 3초보다 길다.
export const REFRESH_MS = 10_000

// 서버가 운영자가 아니라고 한 오류(403 ADMIN_REQUIRED).
export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403

export type AdminRead<T> = { data: T | null; error: unknown; reload: () => void }

// 한 경로를 읽고 REFRESH_MS마다 다시 읽는다. 읽기가 실패해도 마지막으로 읽은 값은 지우지 않는다.
// 서버가 운영자가 아니라고(403) 하면 다시 읽어도 달라지지 않으므로 멈춘다.
// paused이면 읽지 않는다(이미 있는 값은 그대로 둔다). 같은 화면의 다른 읽기가 403을 받았을 때 함께 멈추려고 쓴다.
export function useAdminRead<T>(path: string, paused = false): AdminRead<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reads, setReads] = useState(0)

  useEffect(() => {
    if (paused) return
    let ignore = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function read() {
      let again = true
      try {
        const next = await apiFetch<T>(path)
        if (ignore) return
        setData(next)
        setError(null)
      } catch (caught) {
        if (ignore) return
        setError(caught)
        again = !isForbidden(caught)
      }
      if (again) timer = setTimeout(() => void read(), REFRESH_MS)
    }
    void read()
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [path, reads, paused])

  return { data, error, reload: () => { setReads((count) => count + 1) } }
}
