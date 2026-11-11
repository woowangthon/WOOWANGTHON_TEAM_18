import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { spaceObjects } from './space-template.js'

const yaml = readFileSync(new URL('../../../Infra/student/space.yaml', import.meta.url), 'utf8')

// 모든 값(글자 · 숫자)을 모은다.
function leaves(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(leaves)
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => [k, ...leaves(x)])
  return [String(v)]
}

describe('spaceObjects', () => {
  const objects = spaceObjects('my-app')

  it('lists the five objects of the template in creation order, the namespace first and the read binding last', () => {
    expect(objects.map((o) => (o.body as { kind: string }).kind)).toEqual([
      'Namespace',
      'LimitRange',
      'ResourceQuota',
      'NetworkPolicy',
      'RoleBinding',
    ])
  })

  it('posts each object where the API expects it', () => {
    expect(objects.map((o) => o.path)).toEqual([
      '/api/v1/namespaces',
      '/api/v1/namespaces/proj-my-app/limitranges',
      '/api/v1/namespaces/proj-my-app/resourcequotas',
      '/apis/networking.k8s.io/v1/namespaces/proj-my-app/networkpolicies',
      '/apis/rbac.authorization.k8s.io/v1/namespaces/proj-my-app/rolebindings',
    ])
  })

  it('names the space proj-<slug> and puts every other object in it', () => {
    const metas = objects.map((o) => (o.body as { metadata: { name: string; namespace?: string } }).metadata)
    expect(metas[0]).toMatchObject({ name: 'proj-my-app' })
    expect(metas.slice(1).map((m) => m.namespace)).toEqual(Array<string>(4).fill('proj-my-app'))
    expect(metas.slice(1).map((m) => m.name)).toEqual(['container-defaults', 'project-cap', 'project-isolation', 'platform-server-read'])
  })

  it('carries exactly the two Pod Security labels and nothing else', () => {
    expect(objects[0].body).toMatchObject({
      metadata: { labels: { 'pod-security.kubernetes.io/enforce': 'baseline', 'pod-security.kubernetes.io/warn': 'restricted' } },
    })
    expect(Object.keys((objects[0].body as { metadata: { labels: object } }).metadata.labels)).toHaveLength(2)
  })

  // 양식은 Infra/student/space.yaml이 정본이다(검사 규칙이 같은 값만 통과시킨다). 값이 하나라도 다르면 만들 때 422가 난다.
  // 한 방향만 본다(코드의 값이 파일에 있는가). 파일에만 있는 값이 빠진 것까지는 잡지 못한다.
  it('uses only values that appear in Infra/student/space.yaml', () => {
    const text = yaml.replaceAll('proj-demo', 'proj-my-app').replaceAll(/["']/g, '')
    const missing = objects.flatMap((o) => leaves(o.body)).filter((v) => !text.includes(v))
    expect(missing).toEqual([])
  })

  it('copies every ResourceQuota line of the template', () => {
    const block = yaml.split('hard:\n')[1].split('\n---')[0]
    const fromFile = block.split('\n').filter((l) => /^ {4}[\w.-]+: /.test(l)).map((l) => l.trim().split(':')[0])
    const quota = objects[2].body as { spec: { hard: Record<string, string> } }
    expect(Object.keys(quota.spec.hard).sort()).toEqual(fromFile.sort())
  })
})
