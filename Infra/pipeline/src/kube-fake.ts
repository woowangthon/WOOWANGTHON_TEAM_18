import { vi } from 'vitest'
import { KubeError, type KubeAnswer, type KubeCall } from './kube.js'

// 테스트용 k3s API 대역. `METHOD path`(쿼리 포함) → 답. 함수면 부를 때마다 계산하고, KubeError면 던진다. 없는 요청은 실패한다.
export type Route = KubeAnswer | KubeError | ((path: string, body?: string) => KubeAnswer | KubeError)

export function fakeKube(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body?: string }[] = []
  const call = vi.fn<KubeCall>((method, path, body) => {
    calls.push({ method, path, body })
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`]
    if (route === undefined) return Promise.reject(new Error(`unexpected ${method} ${path}`))
    const answer = typeof route === 'function' ? route(path, body) : route
    return answer instanceof KubeError ? Promise.reject(answer) : Promise.resolve(answer)
  })
  return { call, calls }
}

export const ok = (body: unknown = {}): KubeAnswer => ({ status: 200, body: JSON.stringify(body) })
export const list = (...items: unknown[]): KubeAnswer => ok({ items })
export const refused = (status: number, body: unknown): KubeAnswer => ({ status, body: JSON.stringify(body) })
