import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import https from 'node:https'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'
import { ClusterError } from './cluster-error.js'

const TIMEOUT_MS = 5000
// 쉬는 연결은 5초 뒤 닫는다(Node 기본 agent와 같은 값). 오래 쉰 연결은 Tailscale · NAT에서 소리 없이 끊겨 있을 수 있다.
const AGENT_OPTIONS = { keepAlive: true, timeout: 5000, maxSockets: 8, scheduling: 'lifo' } as const

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const JSON_TYPE = 'application/json'
export const MERGE_PATCH = 'application/merge-patch+json'

interface Connection {
  url: URL
  token: string
  secure: boolean
  agent: http.Agent
}

interface Answer {
  status: number
  text: string
  /** 쿠버네티스 Status 객체의 reason(AlreadyExists 등). 읽을 수 없으면 undefined. */
  reason: string | undefined
}

/**
 * 리더의 쿠버네티스 API를 서버 계정 토큰으로 부른다. 설계는 docs/design/space.md(연결)와 docs/design/cluster-client.md(호출 · 오류).
 * 연결은 node:https다: API 인증서는 자체 CA가 서명했고, 전역 fetch는 요청마다 CA를 줄 수 없다. 인증서 검증은 끄지 않는다.
 * 토큰은 K8S_API_URL로만 보내고 로그 · 오류에 남기지 않는다. 실패는 모두 ClusterError이고, 잡지 않으면 503 CLUSTER_UNAVAILABLE이다:
 * 401 · 403 · 422도 사용자 잘못이 아니라 서버 설정이나 코드의 문제다. 설정이 없을 때도 같다.
 */
@Injectable()
export class K8sClient implements OnModuleDestroy {
  private readonly logger = new Logger(K8sClient.name)
  private readonly conn: Connection | undefined

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('K8S_API_URL', { infer: true })
    const token = config.get('K8S_TOKEN', { infer: true })
    const ca = config.get('K8S_CA_CERT', { infer: true })
    // validateEnv가 셋이 함께 있거나 함께 없게 한다.
    if (!url || !token || !ca) return
    // http는 로컬 시험 전용이다(env가 loopback만 허용). ca는 https에서만 쓰인다.
    const parsed = new URL(url)
    const secure = parsed.protocol === 'https:'
    this.conn = { url: parsed, token, secure, agent: secure ? new https.Agent({ ...AGENT_OPTIONS, ca }) : new http.Agent(AGENT_OPTIONS) }
  }

  onModuleDestroy() {
    this.conn?.agent.destroy()
  }

  /** 요청 하나를 보내고 2xx면 응답 본문을 돌려준다. 그 밖은 ClusterError다. */
  async request(method: Method, path: string, body?: object, contentType = JSON_TYPE): Promise<string> {
    const answer = await this.send(method, path, body, contentType)
    if (answer.status >= 200 && answer.status < 300) return answer.text
    throw this.refused(method, path, answer)
  }

  /** `path`에 객체를 만든다. 이미 있으면(409 AlreadyExists) 오류가 아니라 'exists'다. */
  async create(path: string, body: object): Promise<'created' | 'exists'> {
    const answer = await this.send('POST', path, body, JSON_TYPE)
    if (answer.status === 201) return 'created'
    if (answer.status === 409 && answer.reason === 'AlreadyExists') return 'exists'
    throw this.refused('POST', path, answer)
  }

  private refused(method: Method, path: string, { status, reason }: Answer): ClusterError {
    // 응답의 message는 객체 값을 담을 수 있어 싣지 않는다. 상태와 reason이면 어느 경우인지 알 수 있다.
    this.logger.error(`${method} ${pathOnly(path)} answered ${status}${reason ? ` ${reason}` : ''}`)
    return ClusterError.ofStatus(status, reason)
  }

  private async send(method: Method, path: string, body: object | undefined, contentType: string): Promise<Answer> {
    if (!this.conn) {
      this.logger.error('Cluster access is not configured (K8S_API_URL, K8S_TOKEN, K8S_CA_CERT)')
      throw new ClusterError('unconfigured')
    }
    try {
      return await exchange(this.conn, method, path, body === undefined ? undefined : JSON.stringify(body), contentType)
    } catch (err) {
      // 오류 메시지에는 리더의 주소와 포트가 들어 있어 코드(ECONNREFUSED · TimeoutError 등)만 남긴다.
      this.logger.error(`${method} ${pathOnly(path)} failed: ${errorCode(err)}`)
      throw new ClusterError('unreachable')
    }
  }
}

function exchange({ url, token, secure, agent }: Connection, method: Method, path: string, payload: string | undefined, contentType: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      // 경로는 서버가 만든 문자열이다(slug 등은 검증을 통과한 값).
      path,
      // URL.hostname은 IPv6 주소에 대괄호를 남긴다(`[fd7a::1]`). 연결 쪽은 대괄호 없는 주소를 받는다.
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port,
      agent,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(payload) }),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('error', reject)
      // 오류 응답이어도 본문을 끝까지 읽어 연결을 정리한다.
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, text, reason: reasonOf(text) })
      })
    }
    const req = (secure ? https : http).request(options, onResponse)
    req.on('error', reject)
    req.end(payload)
  })
}

// 로그에는 경로만 남긴다(쿼리는 뺀다).
const pathOnly = (path: string) => path.split('?')[0]

function errorCode(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error'
  const { code } = err as Error & { code?: unknown }
  return typeof code === 'string' ? code : err.name
}

function reasonOf(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) && typeof parsed.reason === 'string' ? parsed.reason : undefined
  } catch {
    return undefined
  }
}
