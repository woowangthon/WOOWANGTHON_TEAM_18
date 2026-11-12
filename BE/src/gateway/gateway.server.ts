import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, type CallToolResult, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { isRecord } from '../common/is-record.js'
import { GatewayTickets } from './tickets.js'
import { GatewayTools, type ToolAnswer, TOOLS } from './tools.js'

const MAX_BODY_BYTES = 1024 * 1024

// 거절의 structuredContent: { code, message }, INVALID_SPEC이면 칸마다의 fields도.
const rejection = (answer: Extract<ToolAnswer, { ok: false }>) =>
  answer.fields ? { code: answer.code, message: answer.message, fields: answer.fields } : { code: answer.code, message: answer.message }

const asResult = (answer: ToolAnswer): CallToolResult =>
  answer.ok
    ? { content: [{ type: 'text', text: JSON.stringify(answer.content) }], structuredContent: answer.content }
    : // 거절: isError와 { code, message } (api.md "게이트웨이가 거절할 때의 code").
      {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(rejection(answer)) }],
        structuredContent: rejection(answer),
      }

/** `Authorization: Bearer <게이트웨이 토큰>`의 토큰. 없으면 null. */
function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/**
 * 본문. 한도를 넘으면 null이다. 넘은 뒤 들어오는 본문은 모으지 않고 끝까지 받아 버린 다음 답하게 한다.
 * 소켓을 끊거나 다 받기 전에 닫으면 클라이언트가 413 대신 연결 끊김을 받을 수 있다. 내부 망 전용이라 끝까지 받는 비용은 받아들인다.
 */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (chunk: Buffer) => {
      if (over) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        over = true
        chunks.length = 0
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * AI 에이전트가 부르는 MCP 게이트웨이(Streamable HTTP, 상태 없음: 요청마다 새 MCP 서버). 공개 앱과 다른 내부 포트에서 `POST /mcp`만 연다.
 * 토큰은 도구를 부를 때마다 확인한다. 모르는 · 끝난 · 만료된 토큰이면 도구는 TICKET_CLOSED로 거절한다.
 * 토큰 · 요청 본문은 로그에 남기지 않는다.
 */
@Injectable()
export class GatewayServer implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayServer.name)
  private http: HttpServer | undefined

  constructor(
    private readonly tickets: GatewayTickets,
    private readonly tools: GatewayTools,
  ) {}

  /** 열고 실제로 듣는 포트를 돌려준다(0이면 빈 포트). */
  async listen(port: number, host?: string): Promise<number> {
    const http = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        this.logger.error(err)
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'internal error' }))
      })
    })
    this.http = http
    await new Promise<void>((resolve) => http.listen(port, host, resolve))
    return (http.address() as AddressInfo).port
  }

  async onModuleDestroy(): Promise<void> {
    const http = this.http
    if (!http) return
    await new Promise<void>((resolve) => http.close(() => resolve()))
    http.closeAllConnections()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/mcp') {
      res.writeHead(404).end()
      return
    }
    // 상태 없는 서버라 세션 스트림(GET) · 세션 끝내기(DELETE)는 없다.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    const raw = await readBody(req)
    if (raw === null) {
      res.writeHead(413).end()
      return
    }
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      // 본문 조각이 담긴 파서 메시지를 되돌려 주지 않는다.
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'body must be JSON' }))
      return
    }
    const token = bearer(req)
    const mcp = new Server({ name: 'woowangthon-gateway', version: '1.0.0' }, { capabilities: { tools: {} } })
    mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }))
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const ticket = token ? await this.tickets.resolve(token) : null
      if (!ticket) return asResult({ ok: false, code: 'TICKET_CLOSED', message: 'the gateway token is not valid for an open ticket' })
      const args = isRecord(request.params.arguments) ? request.params.arguments : {}
      return asResult(await this.tools.call(ticket, request.params.name, args))
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
  }
}
