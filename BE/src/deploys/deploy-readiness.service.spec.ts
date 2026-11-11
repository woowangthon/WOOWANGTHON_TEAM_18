import { ConflictException, type HttpException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { DeployConditionService, PreparedDeploy } from './deploy-condition.service.js'
import { DeployReadinessService } from './deploy-readiness.service.js'
import type { DeploysStore, SecretRow } from './deploys.store.js'
import { secretStatus, serviceDigest } from './secrets-input.js'
import type { SecretsService } from './secrets.service.js'

// 해시 키는 시험용이다(서버는 32자 이상 SECRET_HASH_KEY).
const KEY = 'secret_hash_key_test_0123456789abcdef'
const DEPLOY_ID = '6f1c0a52-3b7e-4a40-9a6c-2f5d8e1b7c90'
const svc = (name: string, secretKeys: string[]) => ({ name, runtime: { secretKeys } })
const SPEC = { project: { slug: 'my-app' }, services: [svc('fe', []), svc('be', ['DATABASE_URL', 'JWT_SECRET']), svc('ai', ['OPENAI_API_KEY'])] }
const BE = { DATABASE_URL: 'db-value', JWT_SECRET: 'jwt-value' }
const AI = { OPENAI_API_KEY: 'ai-value' }
const row = (service: string, values: Record<string, string>, over: Partial<SecretRow> = {}): SecretRow => ({
  service,
  keys: Object.keys(values).sort(),
  status: 'in',
  digest: serviceDigest(values, KEY),
  ...over,
})
const PREPARED = { deployId: DEPLOY_ID, slot: 'a' } as unknown as PreparedDeploy

const failure = async (service: DeployReadinessService) => (await service.prepareIfReady(DEPLOY_ID).catch((e: unknown) => e)) as HttpException

function setup(spec: unknown, rows: SecretRow[], found = true) {
  const findById = vi.fn(() => Promise.resolve(found ? { id: DEPLOY_ID, spec } : undefined))
  const statusOf = vi.fn((s: Parameters<typeof secretStatus>[0]) => Promise.resolve(secretStatus(s, rows, KEY)))
  const prepare = vi.fn(() => Promise.resolve(PREPARED))
  const service = new DeployReadinessService(
    { findById } as unknown as DeploysStore,
    { statusOf } as unknown as SecretsService,
    { prepare } as unknown as DeployConditionService,
  )
  return { service, findById, statusOf, prepare }
}

describe('DeployReadinessService.prepareIfReady', () => {
  it('every secret key is in: prepares with the hash of the values and returns the result as is', async () => {
    const { service, prepare } = setup(SPEC, [row('be', BE), row('ai', AI)])
    await expect(service.prepareIfReady(DEPLOY_ID)).resolves.toBe(PREPARED)
    expect(prepare).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID, expect.stringMatching(/^sha256:[0-9a-f]{64}$/))
  })

  it('a deploy with no secret key at all is ready, and the hash is null', async () => {
    const { service, prepare } = setup({ ...SPEC, services: [svc('fe', [])] }, [])
    await service.prepareIfReady(DEPLOY_ID)
    expect(prepare).toHaveBeenCalledExactlyOnceWith(DEPLOY_ID, null)
  })

  it('missing keys: 409 NOT_READY with the missing keys as secrets.<service>.<KEY>, and nothing is prepared', async () => {
    const { service, prepare } = setup(SPEC, [row('ai', AI)])
    const error = await failure(service)
    expect(error).toBeInstanceOf(ConflictException)
    expect(error.getStatus()).toBe(409)
    expect(error.getResponse()).toMatchObject({
      code: 'NOT_READY',
      fields: [
        { path: 'secrets.be.DATABASE_URL', code: 'REQUIRED' },
        { path: 'secrets.be.JWT_SECRET', code: 'REQUIRED' },
      ],
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it.each([
    ['still writing', row('be', BE, { status: 'writing', digest: null })],
    ['written with other keys', row('be', { DATABASE_URL: 'x' })],
  ])('a service that is %s is not ready', async (_, be) => {
    const { service, prepare } = setup(SPEC, [be, row('ai', AI)])
    await expect(service.prepareIfReady(DEPLOY_ID)).rejects.toBeInstanceOf(ConflictException)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('the response names keys only, never a value or a digest', async () => {
    const { service } = setup(SPEC, [row('be', BE, { status: 'writing', digest: null })])
    const text = JSON.stringify((await failure(service)).getResponse())
    for (const v of [...Object.values(BE), ...Object.values(AI), serviceDigest(BE, KEY)]) expect(text).not.toContain(v)
  })

  it('an id nobody has: 404 DEPLOY_NOT_FOUND', async () => {
    const { service, statusOf, prepare } = setup(SPEC, [], false)
    const error = await failure(service)
    expect(error).toBeInstanceOf(NotFoundException)
    expect(error.getResponse()).toMatchObject({ code: 'DEPLOY_NOT_FOUND' })
    expect(statusOf).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('lists at most 20 fields', async () => {
    const keys = Array.from({ length: 30 }, (_, i) => `KEY_${i}`)
    const { service } = setup({ ...SPEC, services: [svc('be', keys)] }, [])
    expect(((await failure(service)).getResponse() as { fields: unknown[] }).fields).toHaveLength(20)
  })
})
