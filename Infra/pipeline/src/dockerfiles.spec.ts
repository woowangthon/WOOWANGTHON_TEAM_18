import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 기본 Dockerfile을 바꿨는데 버전을 올리지 않으면, 빌드 캐시가 바뀌기 전 Dockerfile로 만든 이미지를 그대로 다시 쓴다.
// 그래서 파일 내용의 sha256을 versions.json에 적어 두고, 그 버전이 BE의 해시 재료(DEFAULT_DOCKERFILE_VERSIONS)와 같은지 본다.
const dir = new URL('../../build/dockerfiles/', import.meta.url)
const versions = JSON.parse(readFileSync(new URL('versions.json', dir), 'utf8')) as Record<string, { version: string; sha256: string }>
const beSource = readFileSync(new URL('../../../BE/src/deploys/deploy-condition.ts', import.meta.url), 'utf8')
const beVersions = JSON.parse(
  /DEFAULT_DOCKERFILE_VERSIONS = (\{[^}]*\})/
    .exec(beSource)![1]
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([a-z]+):/g, '$1"$2":'),
) as Record<string, string>

describe('default Dockerfiles', () => {
  it('cover exactly the frameworks of the deploy input', () => {
    expect(Object.keys(versions).sort()).toEqual(['nest', 'nextjs', 'vite-react'])
    expect(Object.keys(beVersions).sort()).toEqual(['nest', 'nextjs', 'vite-react'])
  })

  it.each(Object.keys(versions))('%s matches its recorded sha256 and the BE version', (framework) => {
    const content = readFileSync(new URL(`${framework}.Dockerfile`, dir))
    expect(createHash('sha256').update(content).digest('hex'), 'Dockerfile changed: bump its version in versions.json and BE DEFAULT_DOCKERFILE_VERSIONS, then update sha256').toBe(
      versions[framework].sha256,
    )
    expect(beVersions[framework]).toBe(versions[framework].version)
  })
})
