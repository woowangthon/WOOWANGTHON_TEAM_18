import { type ArgumentsHost, BadRequestException, HttpException, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from './api-exception.filter.js'

function run(exception: unknown) {
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost
  new ApiExceptionFilter().catch(exception, host)
  return { status: res.status.mock.calls[0]?.[0] as unknown, body: res.json.mock.calls[0]?.[0] as unknown }
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('uses the code given when the exception was thrown', () => {
  expect(run(new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Login required' }))).toEqual({
    status: 401,
    body: { error: { code: 'AUTH_REQUIRED', message: 'Login required' } },
  })
})

it('passes a list of invalid fields through when the exception carries one', () => {
  const fields = [{ path: 'services[0].name', code: 'REQUIRED' }]
  expect(run(new BadRequestException({ code: 'INVALID_SPEC', message: 'spec is invalid', fields })).body).toEqual({
    error: { code: 'INVALID_SPEC', message: 'spec is invalid', fields },
  })
})

it('ignores fields that are not a list', () => {
  expect(run(new BadRequestException({ code: 'X', message: 'm', fields: 'nope' })).body).toEqual({
    error: { code: 'X', message: 'm' },
  })
})

it('passes the retry time through when the exception carries one (GITHUB_RATE_LIMITED)', () => {
  expect(run(new ServiceUnavailableException({ code: 'GITHUB_RATE_LIMITED', message: 'm', retryAt: '2026-11-14T08:30:00.000Z' })).body).toEqual({
    error: { code: 'GITHUB_RATE_LIMITED', message: 'm', retryAt: '2026-11-14T08:30:00.000Z' },
  })
  expect(run(new ServiceUnavailableException({ code: 'X', message: 'm', retryAt: 5 })).body).toEqual({ error: { code: 'X', message: 'm' } })
})

it('falls back to the HTTP status name', () => {
  expect(run(new NotFoundException('Missing thing'))).toEqual({
    status: 404,
    body: { error: { code: 'NOT_FOUND', message: 'Missing thing' } },
  })
})

it('uses ERROR for a status with no name', () => {
  expect(run(new HttpException('Odd', 499)).body).toEqual({ error: { code: 'ERROR', message: 'Odd' } })
})

it('hides unexpected errors behind 500 INTERNAL_ERROR and logs them', () => {
  const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  const boom = new Error('db password is hunter2')

  expect(run(boom)).toEqual({
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
  })
  expect(log).toHaveBeenCalledWith(boom)
})

// Nest는 본문 파서의 SyntaxError를 문구 그대로 BadRequestException(문자열)으로 만든다. 문구가 본문 조각을 담을 수 있어 싣지 않는다.
it.each([
  `Unexpected token 'l', "leaky-secret" is not valid JSON`,
  `Expected ',' or '}' after property value in JSON at position 31 (line 1 column 32)`,
  'Unexpected end of JSON input',
  'reworded parser message with leaky-secret',
])('does not repeat a body parser message that can carry the body: %s', (message) => {
  expect(run(new BadRequestException(message))).toEqual({
    status: 400,
    body: { error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' } },
  })
})

it('keeps the message of a BadRequestException that our code threw as an object, also when it says JSON', () => {
  expect(run(new BadRequestException({ code: 'BAD_REQUEST', message: 'Body must be a JSON object' })).body).toEqual({
    error: { code: 'BAD_REQUEST', message: 'Body must be a JSON object' },
  })
})
