import { expect, it } from 'vitest'
import type { Metrics } from './metrics.ts'
import { layoutServices, nodeStateOf, readinessText } from './serviceMap.ts'
import type { ServiceSpec } from './types.ts'

const service = (name: string, role: string, links: string[] = [], over: Partial<ServiceSpec['runtime']> = {}): ServiceSpec => ({
  name,
  role,
  dir: name,
  build: { context: name, dockerfile: null, framework: null, nodeVersion: null, install: null, build: null, start: null, outputDir: null, buildEnv: {} },
  runtime: {
    kind: 'server',
    port: 3000,
    health: { type: 'http', path: '/', startupTimeoutSeconds: 10 },
    env: {},
    secretKeys: [],
    links: links.map((s) => ({ env: `${s.toUpperCase()}_URL`, service: s })),
    ingressPath: null,
    stripPrefix: false,
    resources: null,
    ...over,
  },
})

it('puts the service nobody links to first and the ones it uses one column to the right', () => {
  const layout = layoutServices([service('fe', 'fe', ['be']), service('be', 'be', ['ai']), service('ai', 'ai')])
  expect(layout.nodes.map((n) => [n.name, n.col, n.row])).toEqual([['fe', 0, 0], ['be', 1, 0], ['ai', 2, 0]])
  expect(layout.edges).toEqual([{ from: 'fe', to: 'be' }, { from: 'be', to: 'ai' }])
  expect([layout.cols, layout.rows]).toEqual([3, 1])
})

it('stacks services in the same column and keeps unlinked services in the first column', () => {
  const layout = layoutServices([service('fe', 'fe', ['be']), service('be', 'be'), service('ai', 'ai')])
  expect(layout.nodes.map((n) => [n.name, n.col, n.row])).toEqual([['fe', 0, 0], ['be', 1, 0], ['ai', 0, 1]])
  expect([layout.cols, layout.rows]).toEqual([2, 2])
})

it('ignores a link to a service that is not in the spec, a link to itself, and a duplicate link, and survives a cycle', () => {
  const layout = layoutServices([service('a', 'fe', ['a', 'ghost', 'b', 'b']), service('b', 'be', ['a'])])
  expect(layout.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
  expect(layout.nodes.every((n) => n.col < 2)).toBe(true)
})

it('carries what the spec says about each service: kind, public path and the number of secrets, never a database', () => {
  const [fe] = layoutServices([service('fe', 'fe', [], { kind: 'static', ingressPath: '/', secretKeys: ['A', 'B'] })]).nodes
  expect(fe).toMatchObject({ kind: 'static', ingressPath: '/', secretCount: 2 })
})

const live = (state: 'running' | 'starting' | 'stopped', waiting: string | null = null): Metrics => ({
  deployId: 'd', slug: 's', state: 'live', reason: null, slot: 'a', usageStatus: null, series: null,
  services: [{ name: 'fe', deployment: 'fe-a', state, waiting, replicas: 1, readyReplicas: state === 'running' ? 1 : 0, restarts: 0, usage: null }],
})
const base = { failureService: null, metrics: undefined }

it('uses the real service state once the deploy is live, in cloud wording', () => {
  expect(nodeStateOf('fe', { ...base, status: 'succeeded', metrics: live('running') })).toEqual({ text: '실행 중(정상)', variant: 'ok' })
  expect(nodeStateOf('fe', { ...base, status: 'succeeded', metrics: live('starting', 'CrashLoopBackOff') })).toMatchObject({ text: '헬스 체크 대기 중', variant: 'warn', detail: '시작하자마자 계속 꺼지고 있어요' })
  expect(nodeStateOf('fe', { ...base, status: 'succeeded', metrics: live('stopped') }).text).toBe('중지됨')
})

it('colours the nodes from the overall status while no real service state exists', () => {
  const text = (status: Parameters<typeof nodeStateOf>[1]['status']) => nodeStateOf('fe', { ...base, status }).text
  expect(text('not_started')).toBe('시작 전')
  expect(text('queued')).toBe('대기 중')
  expect(text('running')).toBe('배포 중')
  expect(text('fixing')).toBe('배포 중')
  expect(text('succeeded')).toBe('상태 확인 중')
})

it('marks only the service the failure names as failed, and the rest as stopped', () => {
  expect(nodeStateOf('be', { ...base, status: 'failed', failureService: 'be' })).toEqual({ text: '실패', variant: 'err' })
  expect(nodeStateOf('fe', { ...base, status: 'failed', failureService: 'be' }).text).toBe('배포 중단')
  expect(nodeStateOf('be', { ...base, status: 'needs_user', failureService: 'be' }).text).toBe('조치 필요')
})

it('says a newer deploy is live for a superseded deploy, and does not use another deploy’s service state', () => {
  const superseded = { ...live('running'), state: 'not_live', reason: 'superseded', services: [] } as Metrics
  expect(nodeStateOf('fe', { ...base, status: 'succeeded', metrics: superseded }).text).toBe('새 배포가 공개 중')
})

it('says the deploy is complete but waiting for the health check while a service is still starting', () => {
  expect(readinessText(live('starting'))).toBe('배포 완료 · 헬스 체크 대기 중')
  expect(readinessText(live('running'))).toBe('실행 중(정상)')
  expect(readinessText(undefined)).toBe('배포가 끝났어요')
  expect(readinessText({ ...live('running'), state: 'not_live', reason: 'superseded', services: [] })).toBe('배포가 끝났어요')
})
