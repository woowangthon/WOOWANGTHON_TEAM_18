import { ServiceUnavailableException } from '@nestjs/common'

/**
 * api.github.com 요청 헤더. 토큰(GITHUB_TOKEN)이 있으면 Bearer로 붙여 한도를 서버 IP당 시간당 60번에서 토큰당 5,000번으로 늘린다.
 * 공개 레포만 읽으므로 토큰에는 권한이 없어도 된다. 사용자 토큰은 GitHub에 보내지 않는다.
 */
export function githubApiHeaders(token: string | undefined, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'woowangthon-platform',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * 한도에 걸린 답이면 다시 시도할 수 있는 시각, 아니면 null.
 * GitHub는 한도를 다 쓰면 403 · 429에 `x-ratelimit-remaining: 0`과 `x-ratelimit-reset`(epoch 초)을, 보조 한도에는 `retry-after`(초)를 준다.
 */
export function rateLimitedUntil(status: number, headers: Headers, now = Date.now()): Date | null {
  if (status !== 403 && status !== 429) return null
  const retryAfter = Number(headers.get('retry-after'))
  if (headers.has('retry-after') && Number.isFinite(retryAfter) && retryAfter >= 0) return new Date(now + retryAfter * 1000)
  if (headers.get('x-ratelimit-remaining') !== '0') return null
  const reset = Number(headers.get('x-ratelimit-reset'))
  // reset이 없거나 틀리면 한도 창(한 시간)의 끝을 모르므로 1분 뒤로 안내한다.
  return new Date(headers.has('x-ratelimit-reset') && Number.isFinite(reset) && reset > 0 ? reset * 1000 : now + 60_000)
}

/** GitHub 한도 초과. "GitHub에 닿지 못함"과 다른 코드로, 다시 시도할 시각(retryAt, ISO)을 담는다. */
export const githubRateLimited = (until: Date) =>
  new ServiceUnavailableException({
    code: 'GITHUB_RATE_LIMITED',
    message: `GitHub API rate limit reached; try again after ${until.toISOString()}`,
    retryAt: until.toISOString(),
  })
