import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DeployInput } from './deploy-input.js'
import { deployInput } from './fixtures.js'
import { KubeError } from './kube.js'
import { fakeKube, list, ok, refused, type Route } from './kube-fake.js'
import { runSwitch } from './switch.js'

const NS = '/namespaces/proj-my-app'
// 진짜 helm으로 렌더한 open manifest(슬롯 B, open-fe · open-be, BE는 stripPrefix라 Middleware be-strip).
const OPEN = readFileSync(new URL('__snapshots__/chart-open-b.yaml', import.meta.url), 'utf8')

const ING = `/apis/networking.k8s.io/v1${NS}/ingresses`
const MW = `/apis/traefik.io/v1alpha1${NS}/middlewares`
const DEP = `/apis/apps/v1${NS}/deployments`
const openList = `GET ${ING}?labelSelector=wanggane%2Fingress%3Dopen`
const mwList = `GET ${MW}`
const oldDeps = `GET ${DEP}?labelSelector=slot%3Da`

const named = (...names: string[]) => list(...names.map((name) => ({ metadata: { name } })))

const input = (): DeployInput => {
  const i = deployInput()
  i.spec.services[1].runtime.stripPrefix = true
  return i
}

function cluster(over: Record<string, Route> = {}) {
  return fakeKube({
    [`PATCH ${ING}/open-fe`]: ok(),
    [`PATCH ${ING}/open-be`]: ok(),
    [`PATCH ${MW}/be-strip`]: ok(),
    [openList]: named('open-fe', 'open-be'),
    [mwList]: named('be-strip'),
    [oldDeps]: named('fe-a', 'be-a', 'ai-a'),
    [`PATCH ${DEP}/fe-a`]: ok(),
    [`PATCH ${DEP}/be-a`]: ok(),
    [`PATCH ${DEP}/ai-a`]: ok(),
    ...over,
  })
}

describe('runSwitch', () => {
  it('applies the open manifest, then scales the previous slot to 0 without deleting it', async () => {
    const { call, calls } = cluster()
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report).toEqual({
      ok: true,
      slot: 'b',
      applied: ['Ingress/open-fe', 'Ingress/open-be', 'Middleware/be-strip'],
      deleted: [],
      scaledDown: ['Deployment/fe-a', 'Deployment/be-a', 'Deployment/ai-a'],
      failure: null,
    })
    const patches = calls.filter((c) => c.method === 'PATCH')
    expect(patches.slice(0, 3).every((c) => c.path.endsWith('?fieldManager=student-app&force=true'))).toBe(true)
    expect(patches.slice(3)).toEqual(['fe-a', 'be-a', 'ai-a'].map((n) => ({ method: 'PATCH', path: `${DEP}/${n}`, body: '{"spec":{"replicas":0}}' })))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('switches every open Ingress before reading anything else', async () => {
    const { call, calls } = cluster()
    await runSwitch(input(), 'b', OPEN, call)
    expect(calls.slice(0, 3).map((c) => c.method)).toEqual(['PATCH', 'PATCH', 'PATCH'])
  })

  it('deletes open Ingresses and Middlewares this deploy no longer has', async () => {
    const { call, calls } = cluster({ [openList]: named('open-fe', 'open-be', 'open-old'), [mwList]: named('be-strip', 'old-strip'), [`DELETE ${ING}/open-old`]: ok(), [`DELETE ${MW}/old-strip`]: ok() })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report.deleted).toEqual(['Ingress/open-old', 'Middleware/old-strip'])
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([`${ING}/open-old`, `${MW}/old-strip`])
  })

  it('drops the Middleware of a service that no longer strips its prefix', async () => {
    const i = input()
    i.spec.services[1].runtime.stripPrefix = false
    const { call } = cluster({ [`DELETE ${MW}/be-strip`]: ok() })
    const report = await runSwitch(i, 'b', OPEN, call)
    expect(report.deleted).toEqual(['Middleware/be-strip'])
  })

  it('with no public service (no open.yaml) deletes every open Ingress and Middleware', async () => {
    const i = input()
    for (const s of i.spec.services) s.runtime.ingressPath = null
    const { call } = cluster({ [`DELETE ${ING}/open-fe`]: ok(), [`DELETE ${ING}/open-be`]: ok(), [`DELETE ${MW}/be-strip`]: ok() })
    const report = await runSwitch(i, 'b', null, call)
    expect(report).toMatchObject({ ok: true, applied: [], deleted: ['Ingress/open-fe', 'Ingress/open-be', 'Middleware/be-strip'] })
  })

  it('on a first deploy has nothing to scale down', async () => {
    const { call } = cluster({ [openList]: list(), [oldDeps]: list() })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report).toMatchObject({ ok: true, scaledDown: [] })
  })

  it('scales slot b down when switching to a', async () => {
    const open = OPEN.replace(/name: (fe|be)-b$/gm, 'name: $1-a')
    const { call } = cluster({ [`GET ${DEP}?labelSelector=slot%3Db`]: named('fe-b'), [`PATCH ${DEP}/fe-b`]: ok() })
    const report = await runSwitch(input(), 'a', open, call)
    expect(report).toMatchObject({ ok: true, slot: 'a', scaledDown: ['Deployment/fe-b'] })
  })

  it('finishes an interrupted switch when run again with the same open manifest', async () => {
    // 앞 실행이 open-fe만 바꾸고 끊겼다: open-be는 아직 슬롯 a를 가리킨다. 다시 돌리면 같은 open.yaml을 모두 적용한다.
    const { call, calls } = cluster()
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report.ok).toBe(true)
    const openBe = calls.find((c) => c.path.startsWith(`${ING}/open-be?`))
    expect(openBe?.body).toMatch(/name: be-b$/m)
  })

  it('refuses an open manifest with app objects in it', () => {
    const bad = `${OPEN}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: fe-b\n`
    return expect(runSwitch(input(), 'b', bad, cluster().call)).rejects.toThrow('open manifest has Service fe-b')
  })

  it('reports a refused apply as a platform problem with the Status', async () => {
    const status = { kind: 'Status', code: 422, message: 'Ingress.networking.k8s.io "open-fe" is invalid' }
    const { call } = cluster({ [`PATCH ${ING}/open-fe`]: refused(422, status) })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report).toMatchObject({ ok: false, applied: [], failure: { kind: 'platform', code: 'SWITCH_REFUSED', service: null, message: status.message, detail: status } })
  })

  it('reports a refused scale-down as a platform problem, after the switch itself', async () => {
    const forbidden = { kind: 'Status', code: 403, message: 'deployments.apps "be-a" is forbidden: User "x" cannot patch resource "deployments"' }
    const { call } = cluster({ [`PATCH ${DEP}/be-a`]: refused(403, forbidden) })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report).toMatchObject({ ok: false, applied: ['Ingress/open-fe', 'Ingress/open-be', 'Middleware/be-strip'], scaledDown: ['Deployment/fe-a'], failure: { code: 'EXECUTOR_FORBIDDEN' } })
  })

  it('keeps a refusal without a readable body', async () => {
    const { call } = cluster({ [`PATCH ${DEP}/fe-a`]: { status: 500, body: 'oops' } })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report.failure).toMatchObject({ kind: 'platform', code: 'SWITCH_REFUSED', message: 'API answered 500', detail: null })
  })

  it('reports an unreachable API as a platform problem', async () => {
    const { call } = cluster({ [openList]: new KubeError('K8S_TIMEOUT', 'GET ingresses did not answer in 10s') })
    const report = await runSwitch(input(), 'b', OPEN, call)
    expect(report.failure).toEqual({ kind: 'platform', code: 'K8S_TIMEOUT', service: null, message: 'GET ingresses did not answer in 10s' })
  })
})
