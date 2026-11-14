import { describe, expect, it } from 'vitest'
import { githubApiHeaders, githubRateLimited, rateLimitedUntil } from './github.js'

const NOW = Date.UTC(2026, 10, 14, 7, 49)

describe('githubApiHeaders', () => {
  it('adds a Bearer token only when there is one', () => {
    expect(githubApiHeaders('github_pat_x')).toMatchObject({ Authorization: 'Bearer github_pat_x', Accept: 'application/vnd.github+json' })
    expect(githubApiHeaders(undefined)).not.toHaveProperty('Authorization')
    expect(githubApiHeaders('')).not.toHaveProperty('Authorization')
    expect(githubApiHeaders(undefined, 'application/vnd.github.sha').Accept).toBe('application/vnd.github.sha')
  })
})

describe('rateLimitedUntil', () => {
  const reset = String(NOW / 1000 + 1800)

  it.each([403, 429])('reads x-ratelimit-reset when %i says no requests remain', (status) => {
    const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
    expect(rateLimitedUntil(status, headers, NOW)).toEqual(new Date(NOW + 1800_000))
  })

  it('reads retry-after (secondary limit) first', () => {
    const headers = new Headers({ 'retry-after': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
    expect(rateLimitedUntil(403, headers, NOW)).toEqual(new Date(NOW + 30_000))
  })

  it('falls back to one minute when the reset time is missing', () => {
    expect(rateLimitedUntil(403, new Headers({ 'x-ratelimit-remaining': '0' }), NOW)).toEqual(new Date(NOW + 60_000))
  })

  it.each([
    ['a 403 with requests left (not a limit)', 403, { 'x-ratelimit-remaining': '12' }],
    ['a 403 without limit headers', 403, {}],
    ['a 500', 500, { 'x-ratelimit-remaining': '0' }],
    ['a 200 that used the last request', 200, { 'x-ratelimit-remaining': '0' }],
  ])('is null for %s', (_, status, headers) => {
    expect(rateLimitedUntil(status, new Headers(headers), NOW)).toBeNull()
  })
})

it('githubRateLimited is a 503 with its own code and the retry time', () => {
  const err = githubRateLimited(new Date(NOW))
  expect(err.getStatus()).toBe(503)
  expect(err.getResponse()).toMatchObject({ code: 'GITHUB_RATE_LIMITED', retryAt: '2026-11-14T07:49:00.000Z' })
})
