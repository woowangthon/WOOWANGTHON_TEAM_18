import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeK8s } from '../../test/fake-k8s.js'
import type { Env } from '../config/env.js'
import { ClusterReader, newestPod } from './cluster-reader.js'
import { K8sClient } from './k8s.client.js'

const NS = '/api/v1/namespaces/proj-my-app'

describe('ClusterReader', () => {
  let fake: FakeK8s
  let client: K8sClient
  let reader: ClusterReader
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    client = new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: await fake.listen(), K8S_TOKEN: 't', K8S_CA_CERT: 'unused' }))
    reader = new ClusterReader(client)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fake.reset()
  })
  afterAll(async () => {
    client.onModuleDestroy()
    await fake.close()
  })
  const items = (path: string, list: unknown[]) => fake.answers.set(path, { status: 200, body: { kind: 'List', items: list } })

  it('reads pods and keeps only the listed fields (no env values)', async () => {
    items(`${NS}/pods`, [
      {
        metadata: { name: 'api-a-7d9f-x1', labels: { app: 'api', slot: 'a' }, annotations: { secretHash: 'sha256:abc' } },
        spec: { nodeName: 'worker-1', containers: [{ name: 'api', env: [{ name: 'PLAIN', value: 'env-value-must-not-pass' }] }] },
        status: {
          phase: 'Running',
          containerStatuses: [
            { name: 'api', ready: true, restartCount: 2, state: { running: {} } },
            { name: 'side', ready: true, restartCount: 1, state: { running: {} } },
          ],
        },
      },
      {
        metadata: { name: 'api-b-55c8-q2' },
        spec: {},
        status: { phase: 'Pending', containerStatuses: [{ name: 'api', ready: false, restartCount: 5, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off' } }, lastState: { terminated: { reason: 'Error', exitCode: 1, message: 'env-value-must-not-pass' } } }] },
      },
      { metadata: { name: 'fresh' } },
    ])
    const pods = await reader.pods('my-app')
    expect(fake.calls).toEqual([`GET ${NS}/pods`])
    expect(pods).toEqual([
      { name: 'api-a-7d9f-x1', labels: { app: 'api', slot: 'a' }, phase: 'Running', node: 'worker-1', ready: true, restarts: 3, waiting: null, lastExit: null },
      { name: 'api-b-55c8-q2', labels: {}, phase: 'Pending', node: null, ready: false, restarts: 5, waiting: 'CrashLoopBackOff', lastExit: { reason: 'Error', exitCode: 1 } },
      // 상태가 아직 없는 Pod: 준비되지 않은 것으로 본다.
      { name: 'fresh', labels: {}, phase: 'Unknown', node: null, ready: false, restarts: 0, waiting: null, lastExit: null },
    ])
    expect(JSON.stringify(pods)).not.toContain('env-value-must-not-pass')
  })

  it('reports why an init container waits, without counting it in ready or restarts', async () => {
    items(`${NS}/pods`, [
      {
        metadata: { name: 'p' },
        status: {
          phase: 'Pending',
          initContainerStatuses: [{ ready: false, restartCount: 4, state: { waiting: { reason: 'ImagePullBackOff' } } }],
          containerStatuses: [{ ready: false, restartCount: 0, state: { waiting: { reason: 'PodInitializing' } } }],
        },
      },
    ])
    expect(await reader.pods('my-app')).toMatchObject([{ ready: false, restarts: 0, waiting: 'ImagePullBackOff' }])
  })

  it('a pod is not ready when one of its containers is not', async () => {
    items(`${NS}/pods`, [{ metadata: { name: 'p' }, status: { phase: 'Running', containerStatuses: [{ ready: true }, { ready: false }] } }])
    expect(await reader.pods('my-app')).toMatchObject([{ ready: false, restarts: 0 }])
  })

  it('reads deployments, with omitted counts as 0', async () => {
    items('/apis/apps/v1/namespaces/proj-my-app/deployments', [
      { metadata: { name: 'api-a', labels: { app: 'api', broken: 5 } }, spec: { replicas: 4 }, status: { replicas: 5, readyReplicas: 2, updatedReplicas: 3, availableReplicas: 1 } },
      { metadata: { name: 'api-b' }, spec: { replicas: 0 }, status: {} },
    ])
    expect(await reader.deployments('my-app')).toEqual([
      // 글이 아닌 라벨 값은 버린다.
      { name: 'api-a', labels: { app: 'api' }, replicas: 4, ready: 2, updated: 3, available: 1 },
      { name: 'api-b', labels: {}, replicas: 0, ready: 0, updated: 0, available: 0 },
    ])
    expect(fake.calls).toEqual(['GET /apis/apps/v1/namespaces/proj-my-app/deployments'])
  })

  it('reads nodes: ready state, roles from labels, capacity and allocatable of three resources', async () => {
    const amounts = { cpu: '8', memory: '16308480Ki', 'ephemeral-storage': '479079112Ki', pods: '110', 'nvidia.com/gpu': '1' }
    items('/api/v1/nodes', [
      {
        metadata: { name: 'leader', labels: { 'node-role.kubernetes.io/control-plane': 'true', 'node-role.kubernetes.io/etcd': 'true', 'kubernetes.io/hostname': 'leader' } },
        status: { conditions: [{ type: 'MemoryPressure', status: 'False' }, { type: 'Ready', status: 'True' }], capacity: amounts, allocatable: { ...amounts, cpu: '7800m' }, addresses: [{ type: 'InternalIP', address: '192.168.0.10' }] },
      },
      { metadata: { name: 'worker-1' }, status: { conditions: [{ type: 'Ready', status: 'Unknown' }, { type: 'DiskPressure', status: 'True' }] } },
      { metadata: { name: 'worker-2' }, status: { conditions: [{ type: 'Ready', status: 'False' }] } },
    ])
    const three = { cpu: '8', memory: '16308480Ki', 'ephemeral-storage': '479079112Ki' }
    expect(await reader.nodes()).toEqual([
      { name: 'leader', ready: true, roles: ['control-plane', 'etcd'], capacity: three, allocatable: { ...three, cpu: '7800m' } },
      { name: 'worker-1', ready: false, roles: [], capacity: {}, allocatable: {} },
      { name: 'worker-2', ready: false, roles: [], capacity: {}, allocatable: {} },
    ])
    expect(fake.calls).toEqual(['GET /api/v1/nodes'])
  })

  it('reads node usage from metrics.k8s.io: the quantity text as the leader gives it, skipping items without a name', async () => {
    items('/apis/metrics.k8s.io/v1beta1/nodes', [
      { metadata: { name: 'leader', labels: { secret: 'no' } }, timestamp: '2026-11-13T00:00:00Z', window: '10s', usage: { cpu: '123018642n', memory: '6838040Ki' } },
      { metadata: { name: 'worker-1' }, usage: { cpu: 5 } },
      { metadata: { name: 'worker-2' } },
      { usage: { cpu: '1', memory: '1Ki' } },
    ])
    expect(await reader.nodeUsage()).toEqual([
      { name: 'leader', usage: { cpu: '123018642n', memory: '6838040Ki' } },
      // 글이 아닌 칸은 버린다.
      { name: 'worker-1', usage: {} },
      { name: 'worker-2', usage: {} },
    ])
    expect(fake.calls).toEqual(['GET /apis/metrics.k8s.io/v1beta1/nodes'])
  })

  it.each([
    ['not allowed (403)', { status: 403, body: { reason: 'Forbidden' } }, 'forbidden'],
    ['not served by the cluster (404)', { status: 404, body: { reason: 'NotFound' } }, 'not_found'],
  ] as const)('node usage that is %s is a ClusterError', async (_, answer, kind) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set('/apis/metrics.k8s.io/v1beta1/nodes', answer)
    await expect(reader.nodeUsage()).rejects.toMatchObject({ kind })
  })

  it('reads the tail of a pod log as text', async () => {
    const path = `${NS}/pods/api-a-7d9f-x1/log?tailLines=200&limitBytes=262144`
    fake.answers.set(path, { status: 200, body: 'line 1\nline 2\n' })
    await expect(reader.logs('my-app', 'api-a-7d9f-x1')).resolves.toBe('line 1\nline 2\n')
    expect(fake.calls).toEqual([`GET ${path}`])
  })

  it.each([
    [{ tailLines: 1 }, 'tailLines=1&limitBytes=262144'],
    [{ tailLines: 2000 }, 'tailLines=2000&limitBytes=262144'],
    [{ tailLines: 2001 }, 'tailLines=2000&limitBytes=262144'],
    [{ container: 'side' }, 'tailLines=200&limitBytes=262144&container=side'],
    [{ sinceSeconds: 600 }, 'tailLines=200&limitBytes=262144&sinceSeconds=600'],
  ])('log options %j become the query %s', async (options, query) => {
    await reader.logs('my-app', 'p', options)
    expect(fake.paths).toEqual([`${NS}/pods/p/log?${query}`])
  })

  it.each([
    ['p', { tailLines: 0 }],
    ['p', { tailLines: 1.5 }],
    ['p', { tailLines: Number.NaN }],
    ['p', { sinceSeconds: 0 }],
    ['p', { sinceSeconds: 1.5 }],
    ['p', { container: 'a&follow=true' }],
    ['p', { container: '' }],
    ['', {}],
    ['p/../x', {}],
    ['p?follow=true', {}],
    ['P', {}],
  ])('refuses pod %j with options %j before calling anything', async (pod, options) => {
    await expect(reader.logs('my-app', pod, options)).rejects.toThrow(/Not a valid/)
    expect(fake.seen).toEqual([])
  })

  it.each(['', 'My-App', '../kube-system', 'a/b'])('refuses the invalid slug %j in every space read', async (slug) => {
    await expect(reader.pods(slug)).rejects.toThrow(/Not a valid slug/)
    await expect(reader.deployments(slug)).rejects.toThrow(/Not a valid slug/)
    await expect(reader.logs(slug, 'p')).rejects.toThrow(/Not a valid slug/)
    expect(fake.seen).toEqual([])
  })

  it.each([
    ['a space the server did not make (403)', { status: 403, body: { reason: 'Forbidden' } }, { kind: 'forbidden' }],
    ['a pod that is gone (404)', { status: 404, body: { reason: 'NotFound' } }, { kind: 'not_found' }],
    ['a container that has not started (400)', { status: 400, body: { reason: 'BadRequest' } }, { kind: 'unexpected', apiStatus: 400 }],
  ] as const)('logs of %s fail with a ClusterError the caller can tell apart', async (_, answer, shape) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set(`${NS}/pods/p/log?tailLines=200&limitBytes=262144`, answer)
    await expect(reader.logs('my-app', 'p')).rejects.toMatchObject({ ...shape, status: 503 })
  })

  it.each([
    ['not JSON', 'ok'],
    ['JSON without items', { kind: 'Status' }],
    ['items that is not a list', { items: {} }],
    ['a JSON list', []],
  ])('a 200 that is %s is an unexpected ClusterError, not a crash', async (_, body) => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fake.answers.set(`${NS}/pods`, { status: 200, body })
    await expect(reader.pods('my-app')).rejects.toMatchObject({ kind: 'unexpected', apiStatus: 200, status: 503 })
    expect(logged).toHaveBeenCalledWith(`GET ${NS}/pods answered 200 without a list`)
  })

  it('an empty list is an empty result', async () => {
    items(`${NS}/pods`, [])
    await expect(reader.pods('my-app')).resolves.toEqual([])
  })
  it('reads raw objects for the gateway without managedFields and the last-applied annotation', async () => {
    const original = {
      metadata: {
        name: 'be-b-1',
        managedFields: [{ manager: 'kubectl' }],
        annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}', keep: 'yes' },
      },
      spec: { containers: [{ name: 'be' }] },
    }
    items(`${NS}/pods?labelSelector=${encodeURIComponent('app=be,slot=b')}`, [original, { kind: 'NoMetadata' }])
    const pods = await reader.rawObjects('my-app', 'pods', 'app=be,slot=b')
    expect(fake.paths).toEqual([`${NS}/pods?labelSelector=app%3Dbe%2Cslot%3Db`])
    expect(pods).toEqual([{ metadata: { name: 'be-b-1', annotations: { keep: 'yes' } }, spec: { containers: [{ name: 'be' }] } }, { kind: 'NoMetadata' }])
    // 원본은 바꾸지 않는다.
    expect(original.metadata.managedFields).toHaveLength(1)
  })

  it('reads raw deployments from apps/v1 and events without a selector', async () => {
    items('/apis/apps/v1/namespaces/proj-my-app/deployments', [])
    items(`${NS}/events`, [])
    await reader.rawObjects('my-app', 'deployments')
    await reader.rawObjects('my-app', 'events')
    expect(fake.paths).toEqual(['/apis/apps/v1/namespaces/proj-my-app/deployments', `${NS}/events`])
  })

  it('asks for the previous container logs when told to', async () => {
    await reader.logs('my-app', 'p', { container: 'be', tailLines: 5, previous: true })
    expect(fake.paths).toEqual([`${NS}/pods/p/log?tailLines=5&limitBytes=262144&container=be&previous=true`])
  })
  describe('metrics', () => {
    const PROM = '/api/v1/namespaces/monitoring/services/monitoring-prometheus:9090/proxy/api/v1/query_range'
    const range = { start: 1000, end: 4600, step: 60 }
    const cpuQuery = 'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="proj-my-app",container!="",container!="POD"}[2m]))'
    const memoryQuery = 'sum by (pod) (container_memory_working_set_bytes{namespace="proj-my-app",container!="",container!="POD"})'
    const promPath = (query: string) => `${PROM}?query=${encodeURIComponent(query)}&start=1000&end=4600&step=60`
    const matrix = (result: unknown) => ({ status: 'success', data: { resultType: 'matrix', result } })
    const answer = (query: string, body: unknown) => fake.answers.set(promPath(query), { status: 200, body })

    it('reads Pod usage from metrics.k8s.io, summing nothing itself', async () => {
      fake.answers.set('/apis/metrics.k8s.io/v1beta1/namespaces/proj-my-app/pods', {
        status: 200,
        body: { items: [{ metadata: { name: 'fe-a-1-aaaaa' }, containers: [{ name: 'fe', usage: { cpu: '3m', memory: '9Mi' } }] }, { containers: [] }] },
      })
      expect(await reader.podUsage('my-app')).toEqual([{ name: 'fe-a-1-aaaaa', containers: [{ cpu: '3m', memory: '9Mi' }] }])
    })

    it('asks Prometheus for CPU with a query built only from the namespace', async () => {
      answer(cpuQuery, matrix([{ metric: { pod: 'fe-a-1-aaaaa' }, values: [[1000, '0.25'], [1060.9, '0.5']] }]))
      expect(await reader.podRangeSeries('my-app', 'cpu', range)).toEqual([{ pod: 'fe-a-1-aaaaa', points: [{ t: 1000, v: 0.25 }, { t: 1060, v: 0.5 }] }])
      expect(fake.paths).toEqual([promPath(cpuQuery)])
    })

    it('asks Prometheus for memory with the working set', async () => {
      answer(memoryQuery, matrix([]))
      expect(await reader.podRangeSeries('my-app', 'memory', range)).toEqual([])
      expect(fake.paths).toEqual([promPath(memoryQuery)])
    })

    it('drops points that are not numbers and series without a pod label', async () => {
      answer(
        cpuQuery,
        matrix([
          { metric: { pod: 'a' }, values: [[1000, 'NaN'], [1060, '+Inf'], [1120, '1'], ['x', '1'], [1180, 2], 'junk'] },
          { metric: {}, values: [[1000, '1']] },
          { metric: { pod: 'b' } },
        ]),
      )
      expect(await reader.podRangeSeries('my-app', 'cpu', range)).toEqual([{ pod: 'a', points: [{ t: 1120, v: 1 }] }, { pod: 'b', points: [] }])
    })

    it.each([
      ['an error status', { status: 'error', errorType: 'bad_data' }],
      ['a vector', { status: 'success', data: { resultType: 'vector', result: [] } }],
      ['no data', { status: 'success' }],
      ['not an object', 'text'],
    ])('throws unexpected for %s', async (_name, body) => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      answer(cpuQuery, body)
      await expect(reader.podRangeSeries('my-app', 'cpu', range)).rejects.toMatchObject({ kind: 'unexpected' })
    })

    it('rejects an invalid slug and an invalid range before any request', async () => {
      await expect(reader.podRangeSeries('x"} or vector(1) #', 'cpu', range)).rejects.toThrow()
      for (const bad of [{ ...range, start: 1.5 }, { ...range, end: Number.NaN }, { ...range, step: 0 }, { ...range, start: -1 }]) {
        await expect(reader.podRangeSeries('my-app', 'cpu', bad)).rejects.toThrow('Not a valid range')
      }
      expect(fake.paths).toEqual([])
    })
  })

  describe('alerts', () => {
    const ALERTS = '/api/v1/namespaces/monitoring/services/monitoring-prometheus:9090/proxy/api/v1/alerts'

    it('reads the alerts Prometheus evaluates, keeping only string labels and the summary', async () => {
      fake.answers.set(ALERTS, {
        status: 200,
        body: {
          status: 'success',
          data: {
            alerts: [
              {
                labels: { alertname: 'KubePodCrashLooping', namespace: 'proj-my-app', pod: 'be-a-1', weird: 3 },
                annotations: { summary: 'Pod is crash looping.', description: 'long text', runbook_url: 'https://x' },
                state: 'firing',
                activeAt: '2026-11-14T10:00:00Z',
                value: '1e+00',
              },
              { labels: { alertname: 'Watchdog' }, state: 'firing' },
              'junk',
            ],
          },
        },
      })
      expect(await reader.alerts()).toEqual([
        { labels: { alertname: 'KubePodCrashLooping', namespace: 'proj-my-app', pod: 'be-a-1' }, state: 'firing', activeAt: '2026-11-14T10:00:00Z', summary: 'Pod is crash looping.' },
        { labels: { alertname: 'Watchdog' }, state: 'firing', activeAt: null, summary: '' },
      ])
      expect(fake.paths).toEqual([ALERTS])
    })

    it.each([
      ['an error status', { status: 'error' }],
      ['no alerts list', { status: 'success', data: {} }],
      ['not an object', 'text'],
    ])('throws unexpected for %s', async (_name, body) => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      fake.answers.set(ALERTS, { status: 200, body })
      await expect(reader.alerts()).rejects.toMatchObject({ kind: 'unexpected' })
    })
  })
})

describe('newestPod', () => {
  const pod = (name: unknown, created: unknown, restarts: number[] = []) => ({
    metadata: { name, creationTimestamp: created },
    status: { containerStatuses: restarts.map((restartCount) => ({ restartCount })) },
  })

  it('picks the most recently created Pod and sums its container restarts', () => {
    expect(newestPod([pod('be-a-old', '2026-11-13T01:00:00Z', [9]), pod('be-a-new', '2026-11-13T02:00:00Z', [1, 2]), pod('be-a-mid', '2026-11-13T01:30:00Z')])).toEqual({
      name: 'be-a-new',
      restarts: 3,
    })
  })

  it('counts no restarts when the Pod has no container status yet', () => {
    expect(newestPod([{ metadata: { name: 'p', creationTimestamp: '2026-11-13T01:00:00Z' } }])).toEqual({ name: 'p', restarts: 0 })
  })

  it('is null for no Pod or a newest Pod without a name', () => {
    expect(newestPod([])).toBeNull()
    expect(newestPod([pod('old', '2026-11-13T01:00:00Z'), pod(undefined, '2026-11-13T02:00:00Z')])).toBeNull()
  })
})
