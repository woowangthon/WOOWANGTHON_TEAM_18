import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeK8s } from '../../test/fake-k8s.js'
import type { Env } from '../config/env.js'
import { ClusterError } from '../k8s/cluster-error.js'
import { ClusterSecrets } from '../k8s/cluster-secrets.js'
import { K8sClient } from '../k8s/k8s.client.js'
import { SpaceService } from '../k8s/space.service.js'
import { ClusterSecretWriter } from './cluster-secret-writer.js'

const NAMESPACES = '/api/v1/namespaces'
const SECRETS = '/api/v1/namespaces/proj-my-app/secrets'
const VALUE = 'db-password-xyz'
const values = { DATABASE_URL: `postgres://user:${VALUE}@host/db` }
const exists = { status: 409, body: { kind: 'Status', reason: 'AlreadyExists' } }

// 가짜 클러스터 앞에서 진짜 SpaceService · ClusterSecrets와 함께 돌린다. 어댑터가 부르는 순서를 실제 요청으로 본다.
describe('ClusterSecretWriter', () => {
  let fake: FakeK8s
  let client: K8sClient
  let writer: ClusterSecretWriter
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    client = new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: await fake.listen(), K8S_TOKEN: 'k8s-secret-token', K8S_CA_CERT: 'unused' }))
    writer = new ClusterSecretWriter(new SpaceService(client), new ClusterSecrets(client))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.reset()
  })
  afterAll(async () => {
    client.onModuleDestroy()
    await fake.close()
  })

  it('creates the space before the Secret: the namespace first, the Secret request last', async () => {
    await writer.write('my-app', 'api', values)
    expect(fake.calls[0]).toBe(`POST ${NAMESPACES}`)
    expect(fake.calls.at(-1)).toBe(`POST ${SECRETS}`)
    // 공간 여섯 객체가 모두 Secret보다 앞이다(Secret 요청은 하나뿐이다).
    expect(fake.calls).toHaveLength(7)
    expect(fake.calls.filter((c) => c.endsWith('/secrets'))).toHaveLength(1)
  })

  it('hands the service and the values to the Secret unchanged', async () => {
    await writer.write('my-app', 'api', values)
    expect(fake.seen.at(-1)?.body).toMatchObject({
      metadata: { name: 'api-secrets', namespace: 'proj-my-app' },
      data: { DATABASE_URL: Buffer.from(values.DATABASE_URL, 'utf8').toString('base64') },
    })
  })

  it('an existing space and an existing Secret are fine: the Secret is replaced with PUT', async () => {
    fake.answers.set(`POST ${NAMESPACES}`, exists)
    fake.answers.set(`POST ${SECRETS}`, exists)
    await writer.write('my-app', 'api', values)
    expect(fake.calls.at(-1)).toBe(`PUT ${SECRETS}/api-secrets`)
    expect(fake.calls.at(-2)).toBe(`POST ${SECRETS}`)
  })

  it('a refused space stops before any Secret request, and the cluster error reaches the caller as a 503', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set(`POST ${NAMESPACES}`, { status: 403, body: { kind: 'Status', reason: 'Forbidden' } })
    const error = await writer.write('my-app', 'api', values).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClusterError)
    expect(error).toMatchObject({ kind: 'forbidden', status: 503 })
    expect(fake.calls).toEqual([`POST ${NAMESPACES}`])
  })

  it('a refused Secret surfaces as a 503 ClusterError without the value in it or in the log', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set(`POST ${SECRETS}`, { status: 422, body: { kind: 'Status', reason: 'Invalid', message: `bad ${VALUE}` } })
    const error = await writer.write('my-app', 'api', values).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'rejected', status: 503 })
    expect(JSON.stringify([(error as ClusterError).getResponse(), logged.mock.calls])).not.toContain(VALUE)
  })

  it('does not touch the cluster for a bad slug', async () => {
    await expect(writer.write('Bad Slug', 'api', values)).rejects.toThrow(/slug/)
    expect(fake.calls).toEqual([])
  })
})
