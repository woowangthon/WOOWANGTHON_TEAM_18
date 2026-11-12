import http from 'node:http'
import type { AddressInfo } from 'node:net'

// 테스트용 플랫폼 서버: loopback의 http 서버. 받은 요청을 `seen`에 쌓고, `answer`가 정한 상태와 본문으로 답한다(`n`은 몇 번째 요청인가, 0부터).

export const DEPLOY_ID = '11111111-1111-4111-8111-111111111111'
export const TOKEN = 'pipeline_notify_test_0123456789abcdef'

export interface Seen {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

export type Answer = { status: number; body?: unknown; headers?: Record<string, string> }

export async function fakePlatform(answer: (seen: Seen, n: number) => Answer) {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() }
      const { status, body, headers } = answer(request, seen.length)
      seen.push(request)
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  return { url, seen, close, env: { PLATFORM_API_URL: url, PIPELINE_NOTIFY_TOKEN: TOKEN, DEPLOY_ID } }
}
