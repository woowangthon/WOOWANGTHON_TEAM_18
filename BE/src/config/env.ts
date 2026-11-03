export interface Env {
  PORT: number
  /** 정확한 origin 목록. 비어 있으면 다른 출처를 허용하지 않는다(로컬은 Vite 프록시로 같은 출처다). */
  CORS_ORIGINS: string[]
}

// 값이 틀리면 부팅을 멈춘다. 틀린 설정으로 뜬 서버가 조용히 다르게 동작하지 않게 한다.
// .env와 process.env를 합친 값이라 전부 문자열이다.
export function validateEnv(raw: Record<string, string | undefined>): Env {
  return {
    PORT: parsePort(raw.PORT),
    CORS_ORIGINS: parseOrigins(raw.CORS_ORIGINS),
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
    .map((origin) => {
      // "*"나 경로 · 끝 슬래시가 붙은 값은 막는다. 브라우저가 보내는 Origin과 글자 그대로 같아야 한다.
      if (URL.parse(origin)?.origin !== origin) {
        throw new Error(`CORS_ORIGINS entry "${origin}" is not an origin like https://example.com`)
      }
      return origin
    })
}
