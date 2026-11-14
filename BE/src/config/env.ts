export interface Env {
  PORT: number
  /** 정확한 origin 목록. 비어 있으면 다른 출처를 허용하지 않는다(로컬은 Vite 프록시로 같은 출처다). */
  CORS_ORIGINS: string[]
  /** Supabase 프로젝트 origin. 로그인 토큰의 발급자와 공개 키 주소가 여기서 나온다. */
  SUPABASE_URL: string
  /** Supabase의 공개 키(publishable 또는 anon). 사용자 토큰으로 Supabase를 부를 때 `apikey` 헤더에 넣는다. 비밀키가 아니다. */
  SUPABASE_PUBLISHABLE_KEY: string
  /** Supabase의 secret key(service role). 서버만 `deploys`에 쓴다. 비밀이라 로그 · 응답에 남기지 않고 SUPABASE_URL로만 보낸다. */
  SUPABASE_SECRET_KEY: string
  /** 비밀값 해시(HMAC-SHA256)의 서버 전용 키. 32자 이상, 비밀이라 로그 · 응답에 남기지 않는다. 바꾸면 저장된 해시와 `secretHash`가 달라진다. */
  SECRET_HASH_KEY: string
  /** GoCD 서버 origin. 비워 두면 배포 시작이 503 PIPELINE_UNAVAILABLE이다. */
  GOCD_URL?: string
  /** GoCD access token(비밀). 파이프라인 실행에만 쓰고 GOCD_URL로만 보낸다. */
  GOCD_TOKEN?: string
  /** 배포 파이프라인 이름 */
  GOCD_PIPELINE?: string
  /** AI 에이전트의 시험 전용 파이프라인 이름(api.md "파이프라인 ↔ 플랫폼 서버" 4번, 보통 student-trial). 비워 두면 시험 도구는 PIPELINE_UNAVAILABLE이다. */
  GOCD_TRIAL_PIPELINE?: string
  /** 파이프라인이 알림 · 배포 입력 읽기에 쓰는 기계용 비밀 토큰. 비워 두면 그 라우트는 모두 401이다. */
  PIPELINE_NOTIFY_TOKEN?: string
  /** AI 서버 origin(문제 티켓을 보낸다). 비워 두면 문제 티켓을 보내지 못해 AGENT_UNAVAILABLE로 마감한다. */
  AI_SERVER_URL?: string
  /** 플랫폼 → AI 서버 요청의 Bearer 토큰(비밀). AI 서버의 같은 이름 env와 같은 값. */
  AGENT_API_TOKEN?: string
  /** 수정 PR을 올리는 봇 계정(wanggane-bot)의 GitHub 토큰(classic PAT, public_repo, 비밀). 게이트웨이의 edit_repo_file · open_pr만 쓰고 api.github.com으로만 보낸다. 비워 두면 그 두 도구는 BOT_UNAVAILABLE이다. */
  BOT_GITHUB_TOKEN?: string
  /** AI 에이전트의 MCP 게이트웨이를 여는 내부 포트(api.md "MCP 게이트웨이"). 공개 포트(PORT)와 달라야 하고, 비워 두면 게이트웨이를 열지 않는다. */
  GATEWAY_PORT: number | undefined
  /** 리더 쿠버네티스 API의 origin(Tailscale 주소). 셋(K8S_*)이 모두 비면 undefined이고, 클러스터를 쓰는 기능만 503이다. 설계는 docs/design/space.md. */
  K8S_API_URL: string | undefined
  /** 서버 계정(platform-server)의 토큰. 비밀이라 로그 · 응답에 남기지 않고 K8S_API_URL로만 보낸다. */
  K8S_TOKEN: string | undefined
  /** 리더 API 인증서를 서명한 CA. 설정에는 PEM의 base64(한 줄)로 적고, 여기에는 풀어 읽은 PEM이 들어 있다. */
  K8S_CA_CERT: string | undefined
  /** Trivy 취약점 DB 폴더(절대 경로). 비어 있으면 보안 검사(UC-10)를 돌리지 않고, 진행 상태에 SCAN_UNAVAILABLE을 보인다. 운영은 Infra/aws/deploy-be.sh가 넣는다. */
  TRIVY_CACHE_DIR: string | undefined
  /** 워커 노드의 CPU · 메모리 사용률(%) 중 큰 값이 이 값 이상이면 클러스터에 자리가 없는 것으로 본다(배포 시작은 409 CLUSTER_FULL, 대기열은 출발하지 않는다). 1–100, 기본 80. */
  CLUSTER_FULL_PERCENT: number
  /** 운영자 Discord 채널의 웹후크(운영 알림, docs/design/incidents.md). 비밀이라 로그 · 응답에 남기지 않는다. 비워 두면 운영자 Discord로 보내지 않는다. */
  DISCORD_WEBHOOK_URL: string | undefined
}

// 값이 틀리면 부팅을 멈춘다. 틀린 설정으로 뜬 서버가 조용히 다르게 동작하지 않게 한다.
// .env와 process.env를 합친 값이라 전부 문자열이다.
export function validateEnv(raw: Record<string, string | undefined>): Env {
  return {
    PORT: parsePort(raw.PORT),
    CORS_ORIGINS: parseOrigins(raw.CORS_ORIGINS),
    SUPABASE_URL: parseSupabaseUrl(raw.SUPABASE_URL),
    SUPABASE_PUBLISHABLE_KEY: parsePublishableKey(raw.SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SECRET_KEY: parseSecretKey(raw.SUPABASE_SECRET_KEY),
    SECRET_HASH_KEY: parseSecretHashKey(raw.SECRET_HASH_KEY),
    GOCD_URL: parseOptionalOrigin(raw.GOCD_URL, 'GOCD_URL'),
    GOCD_TOKEN: parseOptionalSecret(raw.GOCD_TOKEN, 'GOCD_TOKEN'),
    GOCD_PIPELINE: parseOptionalPipeline(raw.GOCD_PIPELINE, 'GOCD_PIPELINE'),
    GOCD_TRIAL_PIPELINE: parseOptionalPipeline(raw.GOCD_TRIAL_PIPELINE, 'GOCD_TRIAL_PIPELINE'),
    PIPELINE_NOTIFY_TOKEN: parseOptionalSecret(raw.PIPELINE_NOTIFY_TOKEN, 'PIPELINE_NOTIFY_TOKEN', 32),
    AI_SERVER_URL: parseOptionalOrigin(raw.AI_SERVER_URL, 'AI_SERVER_URL'),
    AGENT_API_TOKEN: parseOptionalSecret(raw.AGENT_API_TOKEN, 'AGENT_API_TOKEN'),
    BOT_GITHUB_TOKEN: parseOptionalSecret(raw.BOT_GITHUB_TOKEN, 'BOT_GITHUB_TOKEN'),
    GATEWAY_PORT: parseGatewayPort(raw.GATEWAY_PORT, raw.PORT),
    ...parseCluster(raw),
    TRIVY_CACHE_DIR: parseOptionalDir(raw.TRIVY_CACHE_DIR, 'TRIVY_CACHE_DIR'),
    CLUSTER_FULL_PERCENT: parseClusterFullPercent(raw.CLUSTER_FULL_PERCENT),
    DISCORD_WEBHOOK_URL: parseOptionalWebhook(raw.DISCORD_WEBHOOK_URL),
  }
}

/** Discord 웹후크 주소의 모양. 받는 곳을 discord.com으로 묶어 서버가 다른 주소로 요청하지 않게 한다. 학생이 넣는 주소도 같은 검사다. */
export const DISCORD_WEBHOOK = /^https:\/\/discord\.com\/api\/webhooks\/\d{1,25}\/[A-Za-z0-9_-]{1,100}$/

// 주소 자체가 보내기 권한이라 틀린 값도 오류 메시지(로그)에 싣지 않는다.
function parseOptionalWebhook(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!DISCORD_WEBHOOK.test(value)) throw new Error('DISCORD_WEBHOOK_URL must be a Discord webhook URL like https://discord.com/api/webhooks/<id>/<token>')
  return value
}

function parseClusterFullPercent(value: string | undefined): number {
  if (value === undefined || value === '') return 80
  const percent = /^\d+$/.test(value) ? Number(value) : NaN
  if (!(percent >= 1 && percent <= 100)) throw new Error(`CLUSTER_FULL_PERCENT must be an integer from 1 to 100, got "${value}"`)
  return percent
}

function parseGatewayPort(value: string | undefined, publicPort: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const port = /^\d+$/.test(value) ? Number(value) : NaN
  if (!(port >= 1 && port <= 65535)) throw new Error(`GATEWAY_PORT must be an integer from 1 to 65535, got "${value}"`)
  // 게이트웨이는 내부 망 전용이다. 공개 포트와 같으면 공개 주소로 열린다.
  if (port === parsePort(publicPort)) throw new Error('GATEWAY_PORT must differ from PORT')
  return port
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return 3000
  const port = /^\d+$/.test(value) ? Number(value) : NaN
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(`PORT must be an integer from 1 to 65535, got "${value}"`)
  }
  return port
}

function parseOrigins(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((origin) => checkOrigin(origin, `CORS_ORIGINS entry "${origin}"`))
}

function parseSupabaseUrl(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error('SUPABASE_URL is required, like https://<project>.supabase.co')
  }
  // 공개 키 목록을 여기서 받는다. 평문 HTTP면 중간에서 키를 바꿔 위조 토큰을 통과시킬 수 있다.
  return checkSecureOrigin(value, 'SUPABASE_URL')
}

// 키는 헤더 값으로 그대로 나간다. 붙여 넣다 생긴 공백 · 줄바꿈이 있으면 틀린 키로 조용히 요청이 가지 않게 막는다.
function parsePublishableKey(value: string | undefined): string {
  if (value === undefined || !/^\S+$/.test(value)) {
    throw new Error(
      'SUPABASE_PUBLISHABLE_KEY is required and must not contain whitespace (the public key from Supabase Project Settings → API Keys)',
    )
  }
  return value
}

// 틀린 값이 오류 메시지(로그)에 남지 않도록 값은 메시지에 싣지 않는다.
function parseSecretKey(value: string | undefined): string {
  if (value === undefined || !/^\S+$/.test(value)) {
    throw new Error(
      'SUPABASE_SECRET_KEY is required and must not contain whitespace (the secret key from Supabase Project Settings → API Keys)',
    )
  }
  return value
}

// 비밀값의 해시가 값을 짐작하는 데 쓰이지 않게 하는 키다. 짧으면 막는다. 틀린 값이 오류 메시지(로그)에 남지 않도록 값은 메시지에 싣지 않는다.
const SECRET_HASH_KEY_MIN_LENGTH = 32
function parseSecretHashKey(value: string | undefined): string {
  if (value === undefined || !/^\S+$/.test(value) || value.length < SECRET_HASH_KEY_MIN_LENGTH) {
    throw new Error(
      `SECRET_HASH_KEY is required: at least ${SECRET_HASH_KEY_MIN_LENGTH} characters, no whitespace (generate one with: openssl rand -hex 32)`,
    )
  }
  return value
}

// 비어 있으면 그 기능을 쓰지 않는다(요청이 올 때 503 · 401로 답한다). 값이 있으면 틀린 값은 부팅을 멈춘다.
function parseOptionalOrigin(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  return checkOrigin(value, `${name} "${value}"`)
}

// 틀린 값이 오류 메시지(로그)에 남지 않도록 값은 메시지에 싣지 않는다.
function parseOptionalSecret(value: string | undefined, name: string, minLength = 1): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!/^\S+$/.test(value)) throw new Error(`${name} must not contain whitespace`)
  // 이 토큰 하나로 알림을 위조할 수 있는 값은 짧으면 안 된다.
  if (value.length < minLength) throw new Error(`${name} must be at least ${minLength} characters`)
  return value
}

function parseOptionalDir(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!value.startsWith('/') || /[\0\r\n]/.test(value)) throw new Error(`${name} "${value}" must be an absolute path`)
  return value
}

function parseOptionalPipeline(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`${name} "${value}" is not a pipeline name`)
  return value
}

// 셋이 모두 비면 클러스터 기능만 끈 채로 뜬다(인프라가 값을 주기 전에도 BE가 떠야 한다). 일부만 채우면 틀린 설정이라 멈춘다.
// 틀린 값이 오류 메시지(로그)에 남지 않도록 토큰 · CA는 값을 메시지에 싣지 않는다.
function parseCluster(raw: Record<string, string | undefined>): Pick<Env, 'K8S_API_URL' | 'K8S_TOKEN' | 'K8S_CA_CERT'> {
  const { K8S_API_URL: url, K8S_TOKEN: token, K8S_CA_CERT: encoded } = raw
  if (!url && !token && !encoded) return { K8S_API_URL: undefined, K8S_TOKEN: undefined, K8S_CA_CERT: undefined }
  const missing = Object.entries({ K8S_API_URL: url, K8S_TOKEN: token, K8S_CA_CERT: encoded })
    .filter(([, v]) => !v)
    .map(([name]) => name)
  if (!url || !token || !encoded) {
    throw new Error(`${missing.join(', ')} must be set together with the other K8S_* values (or leave all of them empty)`)
  }
  // 토큰이 이 주소로 나간다. 평문 HTTP면 중간에서 읽힌다.
  checkSecureOrigin(url, 'K8S_API_URL')
  if (!/^\S+$/.test(token)) throw new Error('K8S_TOKEN must not contain whitespace')
  // 배포처가 env 파일에 변수당 한 줄만 허용해서 PEM(여러 줄)을 base64 한 줄로 받는다.
  const ca = Buffer.from(encoded, 'base64').toString('utf8')
  if (!/^-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=][A-Za-z0-9+/=\s]*-----END CERTIFICATE-----\s*$/.test(ca)) {
    throw new Error('K8S_CA_CERT must be the base64 of a PEM certificate, on one line (base64 -w0 ca.crt)')
  }
  return { K8S_API_URL: url, K8S_TOKEN: token, K8S_CA_CERT: ca }
}

// origin이어야 하고, HTTP는 로컬 시험(loopback)만 허용한다.
function checkSecureOrigin(value: string, name: string): string {
  checkOrigin(value, `${name} "${value}"`)
  const { protocol, hostname } = new URL(value)
  if (protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error(`${name} "${value}" must use https (http is allowed only for localhost)`)
  }
  return value
}

// "*"나 경로 · 끝 슬래시가 붙은 값은 막는다. 브라우저가 보내는 Origin, 토큰의 발급자와 글자 그대로 맞아야 한다.
function checkOrigin(value: string, label: string): string {
  if (URL.parse(value)?.origin !== value) {
    throw new Error(`${label} is not an origin like https://example.com`)
  }
  return value
}
