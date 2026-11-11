import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { spaceObjects } from './space-template.js'

const yaml = readFileSync(new URL('../../../Infra/student/space.yaml', import.meta.url), 'utf8')

// 값 하나하나를 "칸이름: 값" 한 줄(글자 · 숫자 칸)이나 값 하나(글자 목록의 항목)로 바꾼다. 빈 객체(`{}`)는 센 값이 없다.
function leaves(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === 'object' && x !== null) leaves(x, out)
      else out.push(String(x))
    }
  } else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'object' && x !== null) leaves(x, out)
      else out.push(`${k}: ${String(x)}`)
    }
  }
  return out
}

// space.yaml을 같은 모양으로 읽는다(이 파일이 쓰는 작은 부분만: 블록 YAML, 한 줄 목록 `[..]`, 따옴표, 주석).
function fileLeaves(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^- /, '').replaceAll(/["']/g, '')
    if (line === '' || line.startsWith('#') || line === '---' || line.endsWith(':')) continue
    const list = /^[\w.-]+: \[(.*)\]$/.exec(line)
    if (list) out.push(...list[1].split(',').map((x) => x.trim()))
    else if (!line.endsWith(': {}')) out.push(line)
  }
  return out
}

describe('spaceObjects', () => {
  const objects = spaceObjects('my-app')

  it('names the space proj-<slug> and puts every other object in it', () => {
    const metas = objects.map((o) => (o.body as { metadata: { name: string; namespace?: string } }).metadata)
    expect(metas[0]).toMatchObject({ name: 'proj-my-app' })
    expect(metas.slice(1).map((m) => m.namespace)).toEqual(Array<string>(5).fill('proj-my-app'))
    expect(metas.slice(1).map((m) => m.name)).toEqual(['container-defaults', 'project-cap', 'project-isolation', 'platform-server-read', 'deploy-executor'])
  })

  // 양식은 Infra/student/space.yaml이 정본이다(검사 규칙이 같은 값만 통과시킨다). 값이 하나라도 다르거나 빠지거나 늘면 만들 때 422가 난다.
  it('has exactly the values of Infra/student/space.yaml (only the name differs)', () => {
    const fromCode = objects.flatMap((o) => leaves(o.body)).sort()
    const fromFile = fileLeaves(yaml.replaceAll('proj-demo', 'proj-my-app')).sort()
    expect(fromCode).toEqual(fromFile)
  })
})
