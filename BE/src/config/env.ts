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
  /** 리더 쿠버네티스 API의 origin(Tailscale 주소). 셋(K8S_*)이 모두 비면 undefined이고, 클러스터를 쓰는 기능만 503이다. 설계는 docs/design/space.md. */
  K8S_API_URL: string | undefined
  /** 서버 계정(platform-server)의 토큰. 비밀이라 로그 · 응답에 남기지 않고 K8S_API_URL로만 보낸다. */
  K8S_TOKEN: string | undefined
  /** 리더 API 인증서를 서명한 CA(PEM). */
  K8S_CA: string | undefined
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
    ...parseCluster(raw),
  }
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

// 셋이 모두 비면 클러스터 기능만 끈 채로 뜬다(인프라가 값을 주기 전에도 BE가 떠야 한다). 일부만 채우면 틀린 설정이라 멈춘다.
// 틀린 값이 오류 메시지(로그)에 남지 않도록 토큰 · CA는 값을 메시지에 싣지 않는다.
function parseCluster(raw: Record<string, string | undefined>): Pick<Env, 'K8S_API_URL' | 'K8S_TOKEN' | 'K8S_CA'> {
  const names = ['K8S_API_URL', 'K8S_TOKEN', 'K8S_CA'] as const
  const missing = names.filter((n) => raw[n] === undefined || raw[n] === '')
  if (missing.length === names.length) return { K8S_API_URL: undefined, K8S_TOKEN: undefined, K8S_CA: undefined }
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} must be set together with the other K8S_* values (or leave all of them empty)`)
  }
  // 토큰이 이 주소로 나간다. 평문 HTTP면 중간에서 읽힌다.
  const url = checkSecureOrigin(raw.K8S_API_URL!, 'K8S_API_URL')
  const token = raw.K8S_TOKEN!
  if (!/^\S+$/.test(token)) throw new Error('K8S_TOKEN must not contain whitespace')
  // 한 줄로 적을 때 줄바꿈을 \n으로 쓴다.
  const ca = raw.K8S_CA!.replaceAll('\\n', '\n')
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(ca)) {
    throw new Error('K8S_CA must be a PEM certificate (-----BEGIN CERTIFICATE-----)')
  }
  return { K8S_API_URL: url, K8S_TOKEN: token, K8S_CA: ca }
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
