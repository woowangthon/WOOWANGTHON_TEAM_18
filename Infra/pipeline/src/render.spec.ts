import { describe, expect, it, type Mock, vi } from 'vitest'
import type { DeployInput } from './deploy-input.js'
import { deployInput, digest } from './fixtures.js'
import { KubeError } from './kube.js'
import { checkQuota, DEFAULT_RESOURCES, hasPublicService, quantity, type RenderTools, renderValues, runRender, type Values } from './render.js'

// 빌드가 끝나 세 서비스 모두 이미지가 있는 배포 입력.
const built = (): DeployInput => {
  const input = deployInput()
  input.deploy_condition.services.fe.image = digest('d')
  input.deploy_condition.services.be.image = digest('e')
  return input
}

describe('renderValues', () => {
  it('turns the deploy input into chart values for the target slot', () => {
    const input = built()
    input.deploy_condition.secretHash = 'sha256:abc'
    const values = renderValues(input, 'b', 'slot', 'stairnoworks.com')
    expect(values).toMatchObject({ part: 'slot', slot: 'b', secretHash: 'sha256:abc', hosts: { open: 'my-app.stairnoworks.com', test: 'my-app.test.internal' } })
    expect(values.services.map((s) => [s.name, s.fullName, s.image])).toEqual([
      ['fe', 'fe-b', digest('d')],
      ['be', 'be-b', digest('e')],
      ['ai', 'ai-b', digest('9')],
    ])
    expect(values.services[1]).toEqual({
      name: 'be',
      fullName: 'be-b',
      image: digest('e'),
      port: 3000,
      // 링크는 같은 슬롯의 Service 이름과 그 서비스의 포트다.
      env: { NODE_ENV: 'production', AI_URL: 'http://ai-b:8000' },
      secretKeys: ['DATABASE_URL'],
      resources: {
        requests: { cpu: '250m', memory: '256Mi', 'ephemeral-storage': '1Gi' },
        limits: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '4Gi' },
      },
      startupProbe: { httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 5, failureThreshold: 12 },
      readinessProbe: { httpGet: { path: '/api/health', port: 3000 }, periodSeconds: 5, failureThreshold: 3 },
      ingressPath: '/api',
      stripPrefix: false,
    })
  })

  it('links within slot A when A is the target', () => {
    expect(renderValues(built(), 'a', 'slot', 'd').services[1].env.AI_URL).toBe('http://ai-a:8000')
  })

  it('names the open part and its hosts the same way', () => {
    const values = renderValues(built(), 'a', 'open', 'stairnoworks.com')
    expect(values.part).toBe('open')
    expect(values.services[0].fullName).toBe('fe-a')
  })

  it.each([
    [10, 2],
    [11, 3],
    [60, 12],
    [300, 60],
  ])('gives a startupProbe of ceil(%i / 5) = %i failures', (seconds, threshold) => {
    const input = built()
    input.spec.services[0].runtime.health.startupTimeoutSeconds = seconds
    expect(renderValues(input, 'a', 'slot', 'd').services[0].startupProbe.failureThreshold).toBe(threshold)
  })

  it('probes a tcp health check with tcpSocket', () => {
    const input = built()
    input.spec.services[2].runtime.health = { type: 'tcp', path: null, startupTimeoutSeconds: 30 }
    const ai = renderValues(input, 'a', 'slot', 'd').services[2]
    expect(ai.startupProbe).toEqual({ tcpSocket: { port: 8000 }, periodSeconds: 5, failureThreshold: 6 })
    expect(ai.readinessProbe).toEqual({ tcpSocket: { port: 8000 }, periodSeconds: 5, failureThreshold: 3 })
  })

  it('uses spec resources for both requests and limits, with the default ephemeral storage', () => {
    const input = built()
    input.spec.services[1].runtime.resources = { cpu: '500m', memory: '512Mi' }
    expect(renderValues(input, 'a', 'slot', 'd').services[1].resources).toEqual({
      requests: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '1Gi' },
      limits: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '4Gi' },
    })
  })

  it('refuses a service without an image digest', () => {
    expect(() => renderValues(deployInput(), 'a', 'slot', 'd')).toThrow('service fe has no image digest (build first)')
  })

  it('refuses a link to an unknown service', () => {
    const input = built()
    input.spec.services[1].runtime.links = [{ env: 'X_URL', service: 'x' }]
    expect(() => renderValues(input, 'a', 'slot', 'd')).toThrow('service be: link X_URL points to unknown service x')
  })
})

describe('hasPublicService', () => {
  it('is true when one service has an ingressPath', () => {
    expect(hasPublicService(built())).toBe(true)
  })
  it('is false when every service is internal', () => {
    const input = built()
    for (const s of input.spec.services) s.runtime.ingressPath = null
    expect(hasPublicService(input)).toBe(false)
  })
})

describe('quantity', () => {
  it.each([
    ['250m', 0.25],
    ['1', 1],
    ['0.5', 0.5],
    ['256Mi', 256 * 2 ** 20],
    ['2Gi', 2 * 2 ** 30],
    ['1G', 1e9],
    ['10k', 1e4],
    ['1Ki', 1024],
    ['1Ti', 2 ** 40],
    ['1T', 1e12],
    ['1M', 1e6],
  ])('%s is %d', (v, n) => {
    expect(quantity(v)).toBe(n)
  })
  it.each(['', 'abc', '1.5.5', '-1', '1 Gi', '1gi'])('%s is NaN', (v) => {
    expect(quantity(v)).toBeNaN()
  })
})

describe('checkQuota', () => {
  const withResources = (...r: ({ cpu: string; memory: string } | null)[]) => {
    const input = built()
    r.forEach((v, i) => (input.spec.services[i].runtime.resources = v))
    return input
  }

  it('passes three services on the defaults (limits 3 × 1 CPU × 2 slots = 6 ≤ 8)', () => {
    expect(checkQuota(built())).toEqual([])
  })

  it('passes a sum that lands exactly on the quota', () => {
    // 요청 합 2 × 2 = 4, 상한 합 2 × 2 = 4 ≤ 8, 메모리 8Gi × 2 = 16Gi.
    expect(checkQuota(withResources({ cpu: '1', memory: '4Gi' }, { cpu: '0.5', memory: '2Gi' }, { cpu: '500m', memory: '2Gi' }))).toEqual([])
  })

  it('reports each quota field the two slots would exceed', () => {
    const issues = checkQuota(withResources({ cpu: '2', memory: '6Gi' }, null, null))
    expect(issues).toEqual([
      // 요청 CPU (2 + 0.25 + 0.25) × 2 = 5 > 4, 상한 CPU (2 + 1 + 1) × 2 = 8 = 8 (통과), 요청 메모리 (6Gi + 256Mi × 2) × 2 = 13Gi ≤ 16Gi
      { field: 'requests.cpu', used: 5, limit: 4 },
    ])
  })

  it('counts memory requests and limits', () => {
    // 요청 (13Gi + 256Mi × 2) × 2 = 27Gi > 16Gi, 상한 (13Gi + 2Gi × 2) × 2 = 34Gi > 32Gi
    const issues = checkQuota(withResources({ cpu: '250m', memory: '13Gi' }, null, null))
    expect(issues.map((i) => i.field)).toEqual(['requests.memory', 'limits.memory'])
  })

  it('reports an unreadable quantity instead of summing it', () => {
    expect(checkQuota(withResources(null, { cpu: 'lots', memory: '1Gi' }, null))).toEqual([{ field: 'services.be.resources', used: NaN, limit: NaN }])
    expect(checkQuota(withResources(null, { cpu: '0', memory: '1Gi' }, null))).toEqual([{ field: 'services.be.resources', used: NaN, limit: NaN }])
  })

  it('counts Pods: two per service, at most 10', () => {
    const input = built()
    const extra = (name: string) => ({ ...structuredClone(input.spec.services[2]), name, runtime: { ...input.spec.services[2].runtime, resources: { cpu: '100m', memory: '128Mi' } } })
    for (const n of ['w1', 'w2', 'w3']) {
      input.spec.services.push(extra(n))
      input.deploy_condition.services[n] = input.deploy_condition.services.ai
    }
    // 6 × 2 = 12 > 10. 임시 저장소 기본값도 같이 넘는다(요청 6 × 1Gi × 2 = 12Gi > 10Gi, 상한 6 × 4Gi × 2 = 48Gi > 40Gi).
    expect(checkQuota(input).map((i) => i.field)).toEqual(['requests.ephemeral-storage', 'limits.ephemeral-storage', 'pods'])
    expect(checkQuota(input).at(-1)).toEqual({ field: 'pods', used: 12, limit: 10 })
    input.spec.services.pop()
    expect(checkQuota(input).map((i) => i.field)).not.toContain('pods')
  })

  it('keeps the default resources as the design says', () => {
    expect(DEFAULT_RESOURCES).toEqual({
      requests: { cpu: '250m', memory: '256Mi', 'ephemeral-storage': '1Gi' },
      limits: { cpu: '1', memory: '2Gi', 'ephemeral-storage': '4Gi' },
    })
  })
})

describe('runRender', () => {
  type Fakes = { helmTemplate: Mock<RenderTools['helmTemplate']>; dryRun: Mock<RenderTools['dryRun']> }
  const tools = (over: Partial<Fakes> = {}): Fakes => ({
    helmTemplate: vi.fn<RenderTools['helmTemplate']>((values: Values) => Promise.resolve(`# ${values.part} ${values.slot}\n`)),
    dryRun: vi.fn<RenderTools['dryRun']>(() => Promise.resolve({ ok: true })),
    ...over,
  })

  it('renders the slot part and the open part, and dry-runs both in the project namespace', async () => {
    const t = tools()
    const report = await runRender(built(), 'b', 'stairnoworks.com', t)
    expect(report).toEqual({ ok: true, slot: 'b', manifests: { slot: '# slot b\n', open: '# open b\n' }, failure: null })
    expect(t.helmTemplate.mock.calls.map(([v, ns]) => [v.part, ns])).toEqual([
      ['slot', 'proj-my-app'],
      ['open', 'proj-my-app'],
    ])
    expect(t.dryRun.mock.calls).toEqual([
      ['# slot b\n', 'proj-my-app'],
      ['# open b\n', 'proj-my-app'],
    ])
  })

  it('makes no open part when no service is public', async () => {
    const input = built()
    for (const s of input.spec.services) s.runtime.ingressPath = null
    const t = tools()
    const report = await runRender(input, 'a', 'd', t)
    expect(report.manifests).toEqual({ slot: '# slot a\n', open: null })
    expect(t.dryRun).toHaveBeenCalledTimes(1)
  })

  it('stops at the quota check before rendering', async () => {
    const input = built()
    input.spec.services[0].runtime.resources = { cpu: '4', memory: '1Gi' }
    const t = tools()
    const report = await runRender(input, 'a', 'd', t)
    expect(report).toMatchObject({ ok: false, manifests: { slot: null, open: null }, failure: { kind: 'quota' } })
    expect(t.helmTemplate).not.toHaveBeenCalled()
  })

  it('reports a helm failure as a chart failure', async () => {
    const t = tools({ helmTemplate: vi.fn<RenderTools['helmTemplate']>(() => Promise.reject(new Error('template: bad'))) })
    expect(await runRender(built(), 'a', 'd', t)).toEqual({ ok: false, slot: 'a', manifests: { slot: null, open: null }, failure: { kind: 'helm', message: 'template: bad' } })
  })

  it('reports a values failure (no image) as a chart failure too', async () => {
    const t = tools()
    const report = await runRender(deployInput(), 'a', 'd', t)
    expect(report.failure).toEqual({ kind: 'helm', message: 'service fe has no image digest (build first)' })
  })

  it('keeps the k3s Status of a dry-run failure as it is, with its message', async () => {
    const status = { kind: 'Status', apiVersion: 'v1', status: 'Failure', message: 'deployments.apps "fe-a" is forbidden: exceeded quota', reason: 'Forbidden', code: 403 }
    const t = tools({ dryRun: vi.fn<RenderTools['dryRun']>(() => Promise.resolve({ ok: false, status, message: status.message })) })
    const report = await runRender(built(), 'a', 'd', t)
    expect(report.ok).toBe(false)
    expect(report.failure).toEqual({ kind: 'dry-run', part: 'slot', status, errorMessage: status.message })
    expect(report.failure?.kind === 'dry-run' && report.failure.status).toBe(status)
    // 실패해도 만든 manifest는 남긴다(티켓 · 에이전트가 본다).
    expect(report.manifests).toEqual({ slot: '# slot a\n', open: '# open a\n' })
    expect(t.dryRun).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable API as a cluster failure, keeping the manifests', async () => {
    const t = tools({ dryRun: vi.fn<RenderTools['dryRun']>(() => Promise.reject(new KubeError('K8S_TIMEOUT', 'PATCH /x did not answer in 10s'))) })
    const report = await runRender(built(), 'a', 'd', t)
    expect(report).toEqual({
      ok: false,
      slot: 'a',
      manifests: { slot: '# slot a\n', open: '# open a\n' },
      failure: { kind: 'cluster', code: 'K8S_TIMEOUT', message: 'PATCH /x did not answer in 10s' },
    })
  })

  it('lets an unexpected dry-run error through', async () => {
    const t = tools({ dryRun: vi.fn<RenderTools['dryRun']>(() => Promise.reject(new Error('manifest has an object the pipeline cannot apply'))) })
    await expect(runRender(built(), 'a', 'd', t)).rejects.toThrow('manifest has an object the pipeline cannot apply')
  })

  it('reports a dry-run failure of the open part', async () => {
    const t = tools({ dryRun: vi.fn<RenderTools['dryRun']>((m) => Promise.resolve(m.includes('open') ? { ok: false, status: null, message: 'x' } : { ok: true })) })
    expect((await runRender(built(), 'a', 'd', t)).failure).toEqual({ kind: 'dry-run', part: 'open', status: null, errorMessage: 'x' })
  })
})
