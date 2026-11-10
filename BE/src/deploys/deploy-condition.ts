import { createHash } from 'node:crypto'
import { isRecord } from '../common/is-record.js'
import type { Issue, IssueCode, Spec } from './deploy-input.js'

// W4 시작 때 플랫폼 서버가 정하는 값: 대상 슬롯, 서비스별 빌드 입력 해시와 run/reuse. 규칙 코드이고 AI가 아니다.
// 설계는 docs/design/deploy-handoff.md "deploy_condition.services"와 docs/design/deploy-workflow.md §4.

/** 슬롯 이름. 리소스 이름(`<서비스>-a`)과 Pod 라벨 `slot`에 그대로 쓰므로 소문자다. */
export type Slot = 'a' | 'b'

/** 대상 슬롯은 live 슬롯의 반대쪽이다. live 슬롯이 없으면(첫 배포) A다. */
export const targetSlot = (live: Slot | null): Slot => (live === 'a' ? 'b' : 'a')

/**
 * 플랫폼 기본 Dockerfile의 버전. 그 Dockerfile을 바꾸면 여기 숫자를 올린다: 올리지 않으면 바뀌기 전 Dockerfile로 만든 이미지를
 * 빌드 캐시가 그대로 다시 쓴다. 학생 Dockerfile로 빌드하는 서비스의 해시에는 들어가지 않는다.
 */
export const DEFAULT_DOCKERFILE_VERSIONS = { 'vite-react': '1', nextjs: '1', nest: '1' } as const

type Build = Spec['services'][number]['build']

/** 빌드 입력 해시의 재료. 두 SHA는 GitHub가 준 git object SHA다. */
export interface BuildSource {
  /** `commitSha` 시점 `build.context` 폴더의 git tree SHA */
  contextTree: string
  /** `build.dockerfile` 파일의 git blob SHA. Dockerfile이 없으면 null */
  dockerfileBlob: string | null
}

/**
 * `sha256:` + 64자 hex. 같은 컨텍스트 폴더 · Dockerfile · 빌드 값 · 기본 Dockerfile 버전이면 커밋이 달라도 같다.
 * 키 순서가 달라도 같은 값이 나오도록 객체 키를 정렬한 JSON을 해시한다.
 */
export function buildInputHash(build: Build, source: BuildSource): string {
  // 검증한 spec에서 framework는 Dockerfile이 없을 때만 있다.
  const defaultDockerfile = build.framework === null ? null : `${build.framework}@${DEFAULT_DOCKERFILE_VERSIONS[build.framework]}`
  const input = { build, contextTree: source.contextTree, defaultDockerfile, dockerfileBlob: source.dockerfileBlob }
  return `sha256:${createHash('sha256').update(canonicalJson(input)).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export interface ServiceCondition {
  buildInputHash: string
  build: 'run' | 'reuse'
  /** 이미지 digest 주소. reuse면 W4 시작 때, run이면 빌드가 끝난 뒤 채운다 */
  image: string | null
}

export type ServiceConditions = Record<string, ServiceCondition>

const HASH = /^sha256:[0-9a-f]{64}$/
// 모든 프로젝트 · 서비스가 공개 패키지 하나를 쓴다(docs/design/deploy-handoff.md). 봇 계정 이름은 아직 정하지 않아 GitHub 사용자 이름 모양만 본다.
const IMAGE = /^ghcr\.io\/[a-z0-9](?:[a-z0-9-]{0,38})\/student-apps@sha256:[0-9a-f]{64}$/

/** build_cache · deploy_condition에 넣을 수 있는 이미지 digest 주소인가. */
export const isImageDigest = (v: unknown): v is string => typeof v === 'string' && IMAGE.test(v)

/**
 * W4가 채운 `deploy_condition.services`의 검증(docs/design/deploy-handoff.md 검증 규칙 "W4가 채운 뒤"). 빌드 전 값을 본다:
 * 키 집합이 `spec.services[].name`과 같고, reuse면 image가 있고 run이면 image는 null이다. 어긴 칸을 `deploy_condition.services.<name>.<칸>`으로 알린다.
 */
export function validateServiceConditions(spec: Spec, services: unknown): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, code: IssueCode) => issues.push({ path: `deploy_condition.services${path}`, code })
  if (!isRecord(services)) {
    add('', 'INVALID_TYPE')
    return issues
  }
  const names = spec.services.map((s) => s.name)
  for (const name of names) if (!Object.hasOwn(services, name)) add(`.${name}`, 'REQUIRED')
  for (const [name, raw] of Object.entries(services)) {
    if (!names.includes(name)) {
      add(`.${name}`, 'UNKNOWN_SERVICE')
      continue
    }
    if (!isRecord(raw)) {
      add(`.${name}`, 'INVALID_TYPE')
      continue
    }
    for (const k of Object.keys(raw)) if (!['buildInputHash', 'build', 'image'].includes(k)) add(`.${name}.${k}`, 'UNKNOWN_KEY')
    if (typeof raw.buildInputHash !== 'string' || !HASH.test(raw.buildInputHash)) add(`.${name}.buildInputHash`, 'INVALID_VALUE')
    if (raw.build === 'reuse') {
      if (raw.image === null || raw.image === undefined) add(`.${name}.image`, 'REQUIRED')
      else if (!isImageDigest(raw.image)) add(`.${name}.image`, 'INVALID_VALUE')
    } else if (raw.build === 'run') {
      if (raw.image !== null) add(`.${name}.image`, 'MUST_BE_NULL')
    } else {
      add(`.${name}.build`, 'INVALID_VALUE')
    }
  }
  return issues
}
