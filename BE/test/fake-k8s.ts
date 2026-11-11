import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'

// 가짜 쿠버네티스 API. 받은 요청을 적어 두고, 정한 답을 준다(없으면 POST는 201, 나머지는 200).
export interface Seen {
  method: string
  path: string
  auth: string | undefined
  contentType: string | undefined
  /** 본문이 없으면 undefined */
  body: unknown
  /** 요청이 온 연결의 포트. 같은 값이면 같은 연결을 다시 쓴 것이다. */
  port: number | undefined
}
/** body가 글이면 그대로(로그 응답), 아니면 JSON으로 답한다. */
export type Answer = { status: number; body?: unknown } | 'hangup'

export class FakeK8s {
  seen: Seen[] = []
  /** 열쇠는 `<메서드> <경로>`(먼저 찾는다) 또는 경로다. */
  answers = new Map<string, Answer>()
  constructor(readonly server: http.Server | https.Server) {
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const method = req.method ?? ''
        const path = req.url ?? ''
        this.seen.push({
          method,
          path,
          auth: req.headers.authorization,
          contentType: req.headers['content-type'],
          body: text === '' ? undefined : (JSON.parse(text) as unknown),
          port: req.socket.remotePort,
        })
        const answer = this.answers.get(`${method} ${path}`) ?? this.answers.get(path) ?? { status: method === 'POST' ? 201 : 200 }
        if (answer === 'hangup') return void req.socket.destroy()
        if (typeof answer.body === 'string') {
          res.writeHead(answer.status, { 'Content-Type': 'text/plain' })
          return void res.end(answer.body)
        }
        res.writeHead(answer.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(answer.body ?? { kind: 'Status' }))
      })
    })
  }
  get paths() {
    return this.seen.map((s) => s.path)
  }
  get calls() {
    return this.seen.map((s) => `${s.method} ${s.path}`)
  }
  reset() {
    this.seen = []
    this.answers.clear()
  }
  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    const { port } = this.server.address() as AddressInfo
    return `${this.server instanceof https.Server ? 'https' : 'http'}://127.0.0.1:${port}`
  }
  close() {
    // 클라이언트가 연결을 재사용하므로 쉬는 연결을 먼저 닫는다.
    this.server.closeAllConnections()
    return new Promise<void>((r) => this.server.close(() => r()))
  }
}
