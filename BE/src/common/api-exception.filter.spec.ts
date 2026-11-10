import { type ArgumentsHost, BadRequestException, HttpException, Logger, UnauthorizedException } from '@nestjs/common'
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

it('falls back to the HTTP status name', () => {
  expect(run(new BadRequestException('Bad input'))).toEqual({
    status: 400,
    body: { error: { code: 'BAD_REQUEST', message: 'Bad input' } },
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
