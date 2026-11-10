import { type Aws, AwsError } from './aws.js'
import { type DeployInput, isImageDigest, type Service } from './deploy-input.js'

// W4 빌드(GoCD Build 스테이지, AWS 실행기). run인 서비스마다 CodeBuild를 병렬로 시작하고 BatchGetBuilds로 끝날 때까지 기다린다.
// reuse인 서비스는 이미 있는 이미지를 쓰고 빌드하지 않는다. 설계: docs/design/deploy-workflow.md W4, docs/design/deploy-handoff.md.

export interface BuildConfig {
  /** 모든 학생 빌드가 같이 쓰는 CodeBuild 프로젝트 이름 */
  project: string
  /** `ghcr.io/<봇 계정>/student-apps` */
  imageRepo: string
  /** GHCR에 push하는 봇 계정 이름 */
  ghcrUser: string
  /** push 토큰이 든 Secrets Manager 비밀의 이름 또는 ARN. 값이 아니다 */
  ghcrTokenSecretId: string
  /** 기본 Dockerfile · 빌드 스크립트를 받을 플랫폼 레포(`owner/name`, 공개)와 그 commit */
  platformRepo: string
  platformCommit: string
  /** `Infra/build/buildspec.yml` 내용. 학생 레포가 아니라 이 값을 buildspec으로 쓴다 */
  buildspec: string
}

export interface Clock {
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const POLL_MS = 10_000
// CodeBuild 프로젝트 제한 15분(timeoutInMinutes) + 대기열 · 시작 몫. 그보다 오래 IN_PROGRESS면 API 쪽 문제로 본다.
export const MAX_WAIT_MS = 20 * 60_000
export const LOG_LINES = 200

const TERMINAL_PHASE = ['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED', 'CLIENT_ERROR']

/** 태그 `<slug>-<name>-<해시 hex 앞 12자>`. 태그에는 `:`을 쓸 수 없어 `sha256:`을 뗀다. */
export const imageTag = (slug: string, name: string, buildInputHash: string) =>
  `${slug}-${name}-${buildInputHash.slice('sha256:'.length, 'sha256:'.length + 12)}`

/** 설치 · 빌드 명령을 돌릴 폴더: `dir`을 `build.context` 기준으로 적은 것. 서비스 폴더가 컨텍스트 밖이면 빌드할 수 없다. */
export function appDir(svc: Service): string {
  const { context } = svc.build
  if (svc.dir === context) return '.'
  if (context === '.') return svc.dir
  if (svc.dir.startsWith(`${context}/`)) return svc.dir.slice(context.length + 1)
  throw new Error(`service ${svc.name}: dir ${svc.dir} is outside build.context ${context}`)
}

/** `aws codebuild start-build --cli-input-json`에 넘길 요청. 값은 모두 공개 값이다(비밀 env는 빌드에 넘기지 않는다). */
export function startBuildRequest(input: DeployInput, svc: Service, config: BuildConfig) {
  const { build } = svc
  const hash = input.deploy_condition.services[svc.name].buildInputHash
  const env: Record<string, string | null> = {
    SOURCE_REPO: input.spec.project.repo,
    SOURCE_COMMIT: input.commitSha,
    BUILD_CONTEXT: build.context,
    DOCKERFILE: build.dockerfile,
    FRAMEWORK: build.framework,
    APP_DIR: appDir(svc),
    NODE_VERSION: build.nodeVersion,
    INSTALL_CMD: build.install,
    BUILD_CMD: build.build,
    START_CMD: build.start,
    OUTPUT_DIR: build.outputDir,
    // buildEnv의 `K=V`들을 NUL로 이어 base64로 싼다. 값에 공백 · 따옴표 · `=`이 있어도 그대로 build arg가 된다.
    BUILD_ENV_B64: Object.keys(build.buildEnv).length === 0 ? null : Buffer.from(Object.entries(build.buildEnv).map(([k, v]) => `${k}=${v}`).join('\0')).toString('base64'),
    IMAGE_REPO: config.imageRepo,
    IMAGE_TAG: imageTag(input.spec.project.slug, svc.name, hash),
    GHCR_USER: config.ghcrUser,
    GHCR_TOKEN_SECRET_ID: config.ghcrTokenSecretId,
    PLATFORM_REPO: config.platformRepo,
    PLATFORM_COMMIT: config.platformCommit,
  }
  return {
    projectName: config.project,
    // 소스는 buildspec이 공개 레포 두 개(학생 · 플랫폼)를 commit으로 받는다. CodeBuild의 GitHub 연결이 필요 없다.
    sourceTypeOverride: 'NO_SOURCE',
    buildspecOverride: config.buildspec,
    // 값이 없는 칸은 보내지 않는다(빌드 스크립트는 없으면 빈 값으로 읽는다).
    environmentVariablesOverride: Object.entries(env)
      .filter((e): e is [string, string] => e[1] !== null)
      .map(([name, value]) => ({ name, value, type: 'PLAINTEXT' })),
  }
}

type Raw = Record<string, unknown>

export type BuildFailure =
  | { service: string; kind: 'platform'; code: string; message: string }
  | { service: string; kind: 'build'; buildStatus: string; failedPhase: Raw | null; logTail: string[] | null; build: Raw }

export interface BuildReport {
  ok: boolean
  /** 받은 배포 입력에 이번에 만든 이미지를 채운 것. 실패한 서비스의 image는 null로 남는다 */
  input: DeployInput
  /** run인 서비스의 CodeBuild 빌드 id */
  builds: Record<string, string>
  failures: BuildFailure[]
}

/**
 * run인 서비스의 빌드를 모두 시작하고 끝까지 기다린다. 하나가 실패해도 나머지는 끝까지 기다려 결과를 모두 알린다.
 * 실패는 `platform`(CodeBuild API 오류 · 시간 초과 · digest 없음: AI 에이전트를 부르지 않는다)과 `build`(빌드 자체의 실패)로 나눈다.
 */
export async function runBuilds(input: DeployInput, config: BuildConfig, aws: Aws, clock: Clock): Promise<BuildReport> {
  const result = structuredClone(input)
  const conditions = result.deploy_condition.services
  const failures: BuildFailure[] = []
  const builds: Record<string, string> = {}

  const toRun = input.spec.services.filter((s) => conditions[s.name].build === 'run')
  await Promise.all(
    toRun.map(async (svc) => {
      try {
        const answer = (await aws(['codebuild', 'start-build', '--cli-input-json', JSON.stringify(startBuildRequest(input, svc, config))])) as { build?: { id?: unknown } }
        if (typeof answer.build?.id !== 'string') throw new AwsError(null, 'StartBuild answered without a build id')
        builds[svc.name] = answer.build.id
      } catch (err) {
        failures.push(platformFailure(svc.name, err))
      }
    }),
  )

  const pending = new Map(Object.entries(builds).map(([name, id]) => [id, name]))
  const started = clock.now()
  while (pending.size > 0) {
    if (clock.now() - started > MAX_WAIT_MS) {
      for (const name of pending.values()) failures.push({ service: name, kind: 'platform', code: 'BUILD_WAIT_TIMEOUT', message: `build did not finish in ${MAX_WAIT_MS / 60_000} minutes` })
      break
    }
    await clock.sleep(POLL_MS)
    let answer: { builds?: Raw[]; buildsNotFound?: string[] }
    try {
      answer = (await aws(['codebuild', 'batch-get-builds', '--ids', ...pending.keys()])) as typeof answer
    } catch (err) {
      for (const name of pending.values()) failures.push(platformFailure(name, err))
      break
    }
    for (const id of answer.buildsNotFound ?? []) {
      const name = pending.get(id)
      if (name === undefined) continue
      failures.push({ service: name, kind: 'platform', code: 'BUILD_NOT_FOUND', message: `BatchGetBuilds did not find ${id}` })
      pending.delete(id)
    }
    for (const build of answer.builds ?? []) {
      const name = typeof build.id === 'string' ? pending.get(build.id) : undefined
      if (name === undefined || build.buildStatus === 'IN_PROGRESS') continue
      pending.delete(build.id as string)
      if (build.buildStatus === 'SUCCEEDED') {
        const digest = exportedDigest(build)
        if (isImageDigest(digest) && digest.startsWith(`${config.imageRepo}@`)) conditions[name].image = digest
        else failures.push({ service: name, kind: 'platform', code: 'NO_IMAGE_DIGEST', message: 'the build succeeded without exporting an image digest of the image repository' })
      } else {
        failures.push({ service: name, kind: 'build', buildStatus: String(build.buildStatus), failedPhase: failedPhase(build), logTail: await logTail(build, aws), build })
      }
    }
  }

  // 시작한 순서와 상관없이 spec 순서로 알린다.
  const order = input.spec.services.map((s) => s.name)
  failures.sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service))
  return { ok: failures.length === 0, input: result, builds, failures }
}

function platformFailure(service: string, err: unknown): BuildFailure {
  if (err instanceof AwsError) return { service, kind: 'platform', code: err.code ?? 'AWS_CLI_FAILED', message: err.message }
  return { service, kind: 'platform', code: 'AWS_CLI_FAILED', message: err instanceof Error ? err.message : String(err) }
}

// buildspec의 env.exported-variables로 내보낸 IMAGE_DIGEST.
function exportedDigest(build: Raw): unknown {
  const vars = build.exportedEnvironmentVariables
  if (!Array.isArray(vars)) return undefined
  return (vars as { name?: unknown; value?: unknown }[]).find((v) => v.name === 'IMAGE_DIGEST')?.value
}

function failedPhase(build: Raw): Raw | null {
  const phases = Array.isArray(build.phases) ? (build.phases as Raw[]) : []
  return phases.find((p) => TERMINAL_PHASE.includes(String(p.phaseStatus))) ?? null
}

// 로그 마지막 LOG_LINES줄. 로그를 못 읽어도 빌드 실패 보고는 그대로 한다(null).
async function logTail(build: Raw, aws: Aws): Promise<string[] | null> {
  const logs = build.logs as { groupName?: unknown; streamName?: unknown } | undefined
  if (typeof logs?.groupName !== 'string' || typeof logs.streamName !== 'string') return null
  try {
    const answer = (await aws([
      'logs',
      'get-log-events',
      '--log-group-name',
      logs.groupName,
      '--log-stream-name',
      logs.streamName,
      '--limit',
      String(LOG_LINES),
      '--no-start-from-head',
    ])) as { events?: { message?: unknown }[] }
    return (answer.events ?? []).map((e) => (typeof e.message === 'string' ? e.message.replace(/\r?\n$/, '') : ''))
  } catch {
    return null
  }
}
