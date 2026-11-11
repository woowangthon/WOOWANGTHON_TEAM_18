// 배포 입력(docs/design/deploy-handoff.md). 플랫폼 서버(BE)가 검증하고 deploy_condition을 채워 넘긴 값이다.
// 이 패키지는 그 값을 믿고, 쓰는 칸의 모양만 확인한다(틀린 값으로 CodeBuild · k3s API를 부르지 않게).

export type Slot = 'a' | 'b'

export interface Build {
  context: string
  dockerfile: string | null
  framework: 'vite-react' | 'nextjs' | 'nest' | null
  nodeVersion: string | null
  install: string | null
  build: string | null
  start: string | null
  outputDir: string | null
  buildEnv: Record<string, string>
}

export interface Runtime {
  kind: 'server' | 'static'
  port: number
  health: { type: 'http' | 'tcp'; path: string | null; startupTimeoutSeconds: number }
  env: Record<string, string>
  secretKeys: string[]
  links: { env: string; service: string }[]
  ingressPath: string | null
  stripPrefix: boolean
  resources: { cpu: string; memory: string } | null
}

export interface Service {
  name: string
  role: 'fe' | 'be' | 'ai'
  dir: string
  build: Build
  runtime: Runtime
}

export interface Spec {
  project: { slug: string; repo: string }
  services: Service[]
}

export interface ServiceCondition {
  buildInputHash: string
  build: 'run' | 'reuse'
  image: string | null
}

export interface DeployInput {
  commitSha: string
  deploy_condition: { secretHash: string | null; services: Record<string, ServiceCondition> }
  spec: Spec
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const HASH = /^sha256:[0-9a-f]{64}$/
// BE의 저장 검사와 같은 모양(docs/design/deploy-handoff.md 검증 규칙): slug 1~40자, 서비스 이름 1~30자. 리소스 이름 `<name>-a`가 DNS 이름 한도 안이다.
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/
const SERVICE_NAME = /^[a-z]([a-z0-9-]{0,28}[a-z0-9])?$/
const IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9-]{0,38}\/student-apps@sha256:[0-9a-f]{64}$/

/** 이미지 digest 주소(태그가 아니라 `@sha256:`)인가. */
export const isImageDigest = (v: unknown): v is string => typeof v === 'string' && IMAGE.test(v)

/**
 * JSON 문자열을 배포 입력으로 읽는다. commit · slug · 서비스 이름과, 서비스마다 deploy_condition이 있는지(해시 모양, reuse면 image 있음)만 본다.
 * 어긋나면 무엇이 틀렸는지 담아 던진다.
 */
export function parseDeployInput(text: string): DeployInput {
  const input: unknown = JSON.parse(text)
  const fail = (what: string) => new Error(`deploy input: ${what}`)
  if (!isRecord(input) || !isRecord(input.spec) || !isRecord(input.deploy_condition)) throw fail('not an object with spec and deploy_condition')
  if (typeof input.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(input.commitSha)) throw fail('commitSha is not a 40-char SHA')
  const { spec, deploy_condition: condition } = input
  if (!isRecord(spec.project) || typeof spec.project.slug !== 'string' || !SLUG.test(spec.project.slug)) {
    throw fail('spec.project.slug is invalid')
  }
  if (!Array.isArray(spec.services) || spec.services.length === 0) throw fail('spec.services is empty')
  if (!isRecord(condition.services)) throw fail('deploy_condition.services is not filled')
  const services = condition.services
  for (const svc of spec.services as unknown[]) {
    const name = isRecord(svc) ? svc.name : undefined
    if (typeof name !== 'string' || !SERVICE_NAME.test(name)) throw fail('a service name is invalid')
    const c = services[name]
    if (!isRecord(c) || typeof c.buildInputHash !== 'string' || !HASH.test(c.buildInputHash)) throw fail(`deploy_condition.services.${name} has no build input hash`)
    if (c.build === 'reuse' ? !isImageDigest(c.image) : c.build !== 'run') throw fail(`deploy_condition.services.${name} is neither a run nor a reuse with an image`)
  }
  return input as unknown as DeployInput
}
