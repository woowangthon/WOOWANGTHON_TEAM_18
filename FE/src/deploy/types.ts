// `POST /api/repos/deploy-spec`의 응답 (docs/design/api.md, 모양은 #46까지 잠정)
export type Detected<T = string> = { value: T | null; source: string | null; candidates?: string[] }

export type DraftProject = {
  dir: string
  framework: Detected
  install: Detected
  build: Detected & { script?: string | null }
  start: Detected & { script?: string | null }
  outputDir: Detected
  port: Detected<number>
  nodeVersion: string | null
  lockfile: string | null
  dockerfile: boolean
  needsReview: string[]
}

export type DeploySpecDraft = {
  repo: string
  commit: string | null
  projects: DraftProject[]
  truncated: boolean
}

// `POST /api/deploys`의 요청 spec과 응답 (docs/design/api.md "배포 입력 저장")
export type EnvMap = Record<string, string>

export type ServiceSpec = {
  name: string
  role: string
  dir: string
  build: {
    context: string
    dockerfile: string | null
    framework: string | null
    nodeVersion: string | null
    install: string | null
    build: string | null
    start: string | null
    outputDir: string | null
    buildEnv: EnvMap
  }
  runtime: {
    kind: string
    port: number
    health: { type: string; path: string | null; startupTimeoutSeconds: number }
    env: EnvMap
    secretKeys: string[]
    links: { env: string; service: string }[]
    ingressPath: string | null
    stripPrefix: boolean
    resources: null
  }
}

export type Spec = { project: { slug: string; repo: string }; services: ServiceSpec[] }

export type SavedDeploy = { id: string; repo: string; commit: string; spec: Spec; createdAt: string }

// 서버가 칸마다 알려 주는 오류. `code`로 구분한다(message 문장이 아니다).
export type Issue = { path: string; code: string }
