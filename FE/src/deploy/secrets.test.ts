import { expect, it } from 'vitest'
import { secretIssueText, secretsBodyOf, targetsOf } from './secrets.ts'

it('groups entries by service in the PUT body and keeps values untrimmed', () => {
  expect(
    secretsBodyOf([
      { service: 'be', key: 'DATABASE_URL', value: ' a ' },
      { service: 'be', key: 'JWT_SECRET', value: 'b' },
      { service: 'ai', key: 'OPENAI_API_KEY', value: 'c' },
    ]),
  ).toEqual({ services: { be: { DATABASE_URL: ' a ', JWT_SECRET: 'b' }, ai: { OPENAI_API_KEY: 'c' } } })
})

it('reads a service as done only when the server says it is in', () => {
  expect(
    targetsOf({
      ready: false,
      secretHash: null,
      services: [
        { name: 'be', status: 'in', keys: [{ key: 'A', status: 'in' }] },
        { name: 'ai', status: 'missing', keys: [{ key: 'B', status: 'missing' }, { key: 'C', status: 'missing' }] },
      ],
    }),
  ).toEqual([
    { service: 'be', keys: ['A'], done: true },
    { service: 'ai', keys: ['B', 'C'], done: false },
  ])
})

it('words each server code, and falls back for unknown ones', () => {
  expect(secretIssueText('REQUIRED')).toBe('입력해 주세요')
  expect(secretIssueText('OUT_OF_RANGE')).toContain('8,192')
  expect(secretIssueText('SOMETHING_NEW')).toBe('값을 확인해 주세요')
})
