import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeK8s } from '../../test/fake-k8s.js'
import type { Env } from '../config/env.js'
import { ClusterError } from './cluster-error.js'
import { DeploymentScaler } from './deployment-scaler.js'
import { K8sClient } from './k8s.client.js'

const SCALE = '/apis/apps/v1/namespaces/proj-my-app/deployments/api-a/scale'

describe('DeploymentScaler', () => {
  let fake: FakeK8s
  let client: K8sClient
  let scaler: DeploymentScaler
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    client = new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: await fake.listen(), K8S_TOKEN: 't', K8S_CA_CERT: 'unused' }))
    scaler = new DeploymentScaler(client)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.reset()
  })
  afterAll(async () => {
    client.onModuleDestroy()
    await fake.close()
  })

  it('patches the scale subresource to zero replicas with a merge patch', async () => {
    await scaler.scaleToZero('my-app', 'api-a')
    expect(fake.seen.map(({ method, path, auth, contentType, body }) => ({ method, path, auth, contentType, body }))).toEqual([
      { method: 'PATCH', path: SCALE, auth: 'Bearer t', contentType: 'application/merge-patch+json', body: { spec: { replicas: 0 } } },
    ])
  })

  it.each([
    [403, 'forbidden'],
    [422, 'rejected'],
    [404, 'not_found'],
    [401, 'unauthorized'],
  ])('turns a %i answer into a %s ClusterError', async (status, kind) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set(`PATCH ${SCALE}`, { status, body: { kind: 'Status', reason: 'Whatever' } })
    await expect(scaler.scaleToZero('my-app', 'api-a')).rejects.toMatchObject({ constructor: ClusterError, kind, apiStatus: status })
  })

  it('does not call the cluster for a slug or a deployment name that is not a name', async () => {
    await expect(scaler.scaleToZero('../kube-system', 'api-a')).rejects.toThrow('Not a valid slug')
    await expect(scaler.scaleToZero('my-app', 'api-a/../../x')).rejects.toThrow('Not a valid deployment name')
    await expect(scaler.scaleToZero('my-app', '')).rejects.toThrow('Not a valid deployment name')
    expect(fake.seen).toEqual([])
  })
})
