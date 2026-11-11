import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import https from 'node:https'
import { isRecord } from '../common/is-record.js'
import type { Env } from '../config/env.js'

const TIMEOUT_MS = 5000

const clusterUnavailable = () =>
  new ServiceUnavailableException({ code: 'CLUSTER_UNAVAILABLE', message: 'Could not reach the cluster' })

interface Answer {
  status: number
  /** 쿠버네티스 Status 객체의 reason(AlreadyExists 등). 읽을 수 없으면 undefined. */
  reason: string | undefined
}

/**
 * 리더의 쿠버네티스 API를 서버 계정 토큰으로 부른다. 설계는 docs/design/space.md.
 * 연결은 node:https다: API 인증서는 자체 CA가 서명했고, 전역 fetch는 요청마다 CA를 줄 수 없다. 인증서 검증은 끄지 않는다.
 * 토큰은 K8S_API_URL로만 보내고 로그 · 오류에 남기지 않는다. 닿지 못하거나(검증 실패 · 시간 초과 포함) 만들지 못하면 모두
 * 503 CLUSTER_UNAVAILABLE이다: 401 · 403 · 422도 사용자 잘못이 아니라 서버 설정이나 코드의 문제다. 설정이 없을 때도 같다.
 */
@Injectable()
export class K8sClient {
  private readonly logger = new Logger(K8sClient.name)
  private readonly conn: { url: URL; token: string; ca: string } | undefined

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('K8S_API_URL', { infer: true })
    const token = config.get('K8S_TOKEN', { infer: true })
    const ca = config.get('K8S_CA_CERT', { infer: true })
    // validateEnv가 셋이 함께 있거나 함께 없게 한다.
    this.conn = url && token && ca ? { url: new URL(url), token, ca } : undefined
  }

  /** `path`에 객체를 만든다. 이미 있으면(409 AlreadyExists)도 성공이다. */
  async create(path: string, body: object): Promise<void> {
    if (!this.conn) {
      this.logger.error('Cluster access is not configured (K8S_API_URL, K8S_TOKEN, K8S_CA_CERT)')
      throw clusterUnavailable()
    }
    let answer: Answer
    try {
      answer = await this.post(this.conn, path, JSON.stringify(body))
    } catch (err) {
      // 오류 메시지에는 리더의 주소와 포트가 들어 있어 코드(ECONNREFUSED · TimeoutError 등)만 남긴다.
      this.logger.error(`POST ${path} failed: ${errorCode(err)}`)
      throw clusterUnavailable()
    }
    if (answer.status === 201 || (answer.status === 409 && answer.reason === 'AlreadyExists')) return
    // 응답의 message는 객체 값을 담을 수 있어 싣지 않는다. 상태와 reason이면 어느 경우인지 알 수 있다.
    this.logger.error(`POST ${path} answered ${answer.status}${answer.reason ? ` ${answer.reason}` : ''}`)
    throw clusterUnavailable()
  }

  private post({ url, token, ca }: { url: URL; token: string; ca: string }, path: string, payload: string): Promise<Answer> {
    const secure = url.protocol === 'https:'
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        // 경로는 서버가 만든 문자열이다(slug는 검증을 통과한 값).
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', reject)
        // 오류 응답이어도 본문을 끝까지 읽어 연결을 정리한다.
        res.on('end', () => resolve({ status: res.statusCode ?? 0, reason: reasonOf(Buffer.concat(chunks).toString('utf8')) }))
      }
      // URL.hostname은 IPv6 주소에 대괄호를 남긴다(`[fd7a::1]`). 연결 쪽은 대괄호 없는 주소를 받는다.
      const host = url.hostname.replace(/^\[|\]$/g, '')
      // http는 로컬 시험 전용이다(env가 loopback만 허용). ca는 https에서만 쓰인다.
      const req = (secure ? https : http).request({ ...options, host, port: url.port, ca }, onResponse)
      req.on('error', reject)
      req.end(payload)
    })
  }
}

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
