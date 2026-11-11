import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { deployInput, digest } from './fixtures.js'
import { helmTemplate } from './helm.js'
import { renderValues } from './render.js'

// 차트를 진짜 helm으로 렌더해 레포에 둔 결과(__snapshots__)와 비교한다. 결과가 바뀌면 스냅샷 diff로 리뷰한다(`vitest -u`로 갱신).
// helm이 없는 기기에서는 건너뛴다. CI(ubuntu-latest)에는 helm이 있어 반드시 돈다.
const hasHelm = spawnSync('helm', ['version', '--short']).status === 0

const input = () => {
  const i = deployInput()
  i.deploy_condition.services.fe.image = digest('d')
  i.deploy_condition.services.be.image = digest('e')
  i.deploy_condition.secretHash = 'sha256:abc'
  // BE는 /api를 떼고 받는다. 떼기는 BE Ingress에만 걸려야 한다.
  i.spec.services[1].runtime.stripPrefix = true
  return i
}

// helm 버전마다 문서 구분자(`---`) 앞 빈 줄과 끝 줄바꿈이 다르다(CI의 helm은 버전을 고정하지 않는다). 그 둘만 맞추고 문서 안은 그대로 비교한다.
const normalize = (yaml: string) => `${yaml.replace(/\n(?:[ \t]*\n)+(?=---$)/gm, '\n').trimEnd()}\n`

const docs = (yaml: string) => yaml.split(/^---$/m).filter((d) => /\bkind:/.test(d))
const kinds = (yaml: string) => docs(yaml).map((d) => `${/^kind: (\S+)/m.exec(d)![1]}/${/^ {2}name: (\S+)/m.exec(d)![1]}`)

describe.skipIf(!hasHelm && !process.env.CI)('student-app chart', () => {
  it('renders the target slot apps and the test Ingresses', async () => {
    const yaml = await helmTemplate(renderValues(input(), 'b', 'slot', 'stairnoworks.com'), 'proj-my-app')
    await expect(normalize(yaml)).toMatchFileSnapshot('__snapshots__/chart-slot-b.yaml')
    expect(kinds(yaml).sort()).toEqual(
      ['ConfigMap/ai-b', 'ConfigMap/be-b', 'ConfigMap/fe-b', 'Deployment/ai-b', 'Deployment/be-b', 'Deployment/fe-b', 'Ingress/test-be', 'Ingress/test-fe', 'Middleware/be-strip', 'Service/ai-b', 'Service/be-b', 'Service/fe-b'],
    )
    const deployments = docs(yaml).filter((d) => /^kind: Deployment/m.test(d))
    // 검사 규칙 wanggane-student-pods가 요구하는 것과 배치(cluster.md §6).
    for (const d of deployments) {
      expect(d).toContain('automountServiceAccountToken: false')
      expect(d).toContain('drop: ["NET_RAW"]')
      expect(d).toContain('wanggane/pool: student')
      expect(d).toContain('wanggane/secret-hash: "sha256:abc"')
    }
    // 공개 서비스마다 Ingress 하나(AI는 내부 전용). Ingress · Middleware에는 slot 라벨이 없다(슬롯 비우기에 지워지지 않게).
    const ingresses = docs(yaml).filter((d) => /^kind: Ingress/m.test(d))
    expect(ingresses.map((d) => [/path: "(\S+)"/.exec(d)![1], /service:\n\s+name: (\S+)/.exec(d)![1], /wanggane\/ingress: (\S+)/.exec(d)![1]])).toEqual([
      ['/', 'fe-b', 'test'],
      ['/api', 'be-b', 'test'],
    ])
    for (const d of docs(yaml).filter((d) => /^kind: (Ingress|Middleware)/m.test(d))) expect(d).not.toMatch(/slot:/)
    for (const d of ingresses) expect(d).toContain('host: "my-app.test.internal"')
    // 떼기는 stripPrefix인 BE Ingress에만 건다.
    const [fe, be] = ingresses
    expect(fe).not.toContain('router.middlewares')
    expect(be).toContain('traefik.ingress.kubernetes.io/router.middlewares: "proj-my-app-be-strip@kubernetescrd"')
    expect(docs(yaml).find((d) => /^kind: Middleware/m.test(d))).toContain('prefixes:\n      - "/api"')
  })

  it('renders only the open Ingresses for the open part', async () => {
    const yaml = await helmTemplate(renderValues(input(), 'b', 'open', 'stairnoworks.com'), 'proj-my-app')
    await expect(normalize(yaml)).toMatchFileSnapshot('__snapshots__/chart-open-b.yaml')
    expect(kinds(yaml)).toEqual(['Ingress/open-fe', 'Ingress/open-be', 'Middleware/be-strip'])
    expect(yaml.match(/host: "my-app.stairnoworks.com"/g)).toHaveLength(2)
    expect(yaml.match(/wanggane\/ingress: open/g)).toHaveLength(2)
  })

  it('collapses repeated hyphens in the Middleware reference, as Traefik does (cluster.md §8)', async () => {
    // slug에 `--`가 있으면 공간은 proj-my--app이지만 Traefik은 참조 이름을 proj-my-app-…으로 줄여 찾는다. 그대로 적으면 Ingress 전체가 404다.
    const i = input()
    i.spec.project.slug = 'my--app'
    const yaml = await helmTemplate(renderValues(i, 'b', 'open', 'stairnoworks.com'), 'proj-my--app')
    await expect(normalize(yaml)).toMatchFileSnapshot('__snapshots__/chart-open-b-double-hyphen.yaml')
    expect(yaml).toContain('traefik.ingress.kubernetes.io/router.middlewares: "proj-my-app-be-strip@kubernetescrd"')
    expect(yaml).toContain('host: "my--app.stairnoworks.com"')
  })

  it('collapses repeated hyphens of the service name in the reference too, but keeps the Middleware name', async () => {
    const i = input()
    i.spec.services[1].name = 'be--x'
    i.deploy_condition.services['be--x'] = i.deploy_condition.services.be
    const yaml = await helmTemplate(renderValues(i, 'b', 'open', 'stairnoworks.com'), 'proj-my-app')
    expect(yaml).toContain('traefik.ingress.kubernetes.io/router.middlewares: "proj-my-app-be-x-strip@kubernetescrd"')
    expect(yaml).toMatch(/^ {2}name: be--x-strip$/m)
  })

  it('renders no Ingress for internal-only services and an empty ConfigMap as {}', async () => {
    const i = input()
    for (const s of i.spec.services) s.runtime.ingressPath = null
    const yaml = await helmTemplate(renderValues(i, 'a', 'slot', 'stairnoworks.com'), 'proj-my-app')
    expect(kinds(yaml).filter((k) => /^(Ingress|Middleware)/.test(k))).toEqual([])
    expect(docs(yaml).find((d) => d.includes('name: fe-a') && /^kind: ConfigMap/m.test(d))).toContain('data: {}')
  })

  it('makes no Middleware when no service strips its prefix', async () => {
    const i = input()
    i.spec.services[1].runtime.stripPrefix = false
    const yaml = await helmTemplate(renderValues(i, 'a', 'open', 'stairnoworks.com'), 'proj-my-app')
    expect(kinds(yaml)).toEqual(['Ingress/open-fe', 'Ingress/open-be'])
    expect(yaml).not.toContain('router.middlewares')
  })

  it('omits the secret annotation and secret env when there are none', async () => {
    const i = input()
    i.deploy_condition.secretHash = null
    const yaml = await helmTemplate(renderValues(i, 'a', 'slot', 'stairnoworks.com'), 'proj-my-app')
    expect(yaml).not.toContain('secret-hash')
    const fe = docs(yaml).find((d) => /^kind: Deployment/m.test(d) && d.includes('name: fe-a'))!
    expect(fe).not.toContain('secretKeyRef')
  })
})
