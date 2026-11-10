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
  return i
}

const docs = (yaml: string) => yaml.split(/^---$/m).filter((d) => /\bkind:/.test(d))
const kinds = (yaml: string) => docs(yaml).map((d) => `${/^kind: (\S+)/m.exec(d)![1]}/${/^ {2}name: (\S+)/m.exec(d)![1]}`)

describe.skipIf(!hasHelm && !process.env.CI)('student-app chart', () => {
  it('renders the target slot apps and the test Ingresses', async () => {
    const yaml = await helmTemplate(renderValues(input(), 'b', 'slot', 'stairnoworks.com'), 'proj-my-app')
    await expect(yaml).toMatchFileSnapshot('__snapshots__/chart-slot-b.yaml')
    expect(kinds(yaml).sort()).toEqual(
      ['ConfigMap/ai-b', 'ConfigMap/be-b', 'ConfigMap/fe-b', 'Deployment/ai-b', 'Deployment/be-b', 'Deployment/fe-b', 'Ingress/test', 'Service/ai-b', 'Service/be-b', 'Service/fe-b'],
    )
    const deployments = docs(yaml).filter((d) => /^kind: Deployment/m.test(d))
    // 검사 규칙 wanggane-student-pods가 요구하는 것과 배치(cluster.md §6).
    for (const d of deployments) {
      expect(d).toContain('automountServiceAccountToken: false')
      expect(d).toContain('drop: ["NET_RAW"]')
      expect(d).toContain('wanggane/pool: student')
      expect(d).toContain('wanggane/secret-hash: "sha256:abc"')
    }
    // Ingress에는 slot 라벨이 없다(슬롯 비우기에 지워지지 않게). 공개 서비스 둘의 경로를 대상 슬롯으로 보낸다(AI는 내부 전용).
    const ingress = docs(yaml).find((d) => /^kind: Ingress/m.test(d))!
    expect(ingress).not.toMatch(/slot:/)
    expect(ingress).toContain('host: "my-app.test.internal"')
    expect([...ingress.matchAll(/path: "(\S+)"[\s\S]*?name: (\S+)/g)].map((m) => [m[1], m[2]])).toEqual([
      ['/', 'fe-b'],
      ['/api', 'be-b'],
    ])
  })

  it('renders only the open Ingresses for the open part', async () => {
    const yaml = await helmTemplate(renderValues(input(), 'b', 'open', 'stairnoworks.com'), 'proj-my-app')
    await expect(yaml).toMatchFileSnapshot('__snapshots__/chart-open-b.yaml')
    expect(kinds(yaml)).toEqual(['Ingress/open'])
    expect(yaml).toContain('host: "my-app.stairnoworks.com"')
  })

  it('renders no Ingress for internal-only services and an empty ConfigMap as {}', async () => {
    const i = input()
    for (const s of i.spec.services) s.runtime.ingressPath = null
    const yaml = await helmTemplate(renderValues(i, 'a', 'slot', 'stairnoworks.com'), 'proj-my-app')
    expect(kinds(yaml).filter((k) => k.startsWith('Ingress'))).toEqual([])
    expect(docs(yaml).find((d) => d.includes('name: fe-a') && /^kind: ConfigMap/m.test(d))).toContain('data: {}')
  })

  it('stops instead of ignoring stripPrefix, which is not built yet', async () => {
    const i = input()
    i.spec.services[1].runtime.stripPrefix = true
    await expect(helmTemplate(renderValues(i, 'a', 'slot', 'stairnoworks.com'), 'proj-my-app')).rejects.toThrow('service be: stripPrefix is not supported yet')
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
