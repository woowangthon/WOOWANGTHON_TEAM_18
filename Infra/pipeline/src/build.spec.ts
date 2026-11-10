import { describe, expect, it, vi } from 'vitest'
import { AwsError } from './aws.js'
import { appDir, type BuildConfig, imageTag, MAX_POLL_ERRORS, runBuilds, startBuildRequest } from './build.js'
import type { Service } from './deploy-input.js'
import { COMMIT, deployInput, digest, HASH_BE, HASH_FE, IMAGE_REPO } from './fixtures.js'

const config: BuildConfig = {
  project: 'student-apps',
  imageRepo: IMAGE_REPO,
  ghcrUser: 'woowang-bot',
  ghcrTokenSecretId: 'ghcr-push-token',
  platformRepo: 'woowangthon/WOOWANGTHON_TEAM_18',
  platformCommit: 'f'.repeat(40),
  buildspec: 'version: 0.2\n',
}

describe('imageTag', () => {
  it('is <slug>-<name>-<first 12 hex chars of the hash>', () => {
    expect(imageTag('my-app', 'fe', HASH_FE)).toBe('my-app-fe-111111111111')
  })
})

describe('appDir', () => {
  const svc = (dir: string, context: string) => ({ name: 'fe', dir, build: { context } }) as Service
  it.each([
    ['FE', 'FE', '.'],
    ['FE', '.', 'FE'],
    ['.', '.', '.'],
    ['apps/web', 'apps', 'web'],
  ])('dir %s in context %s runs in %s', (dir, context, expected) => {
    expect(appDir(svc(dir, context))).toBe(expected)
  })

  it.each([
    ['BE', 'FE'],
    ['FE2', 'FE'],
    ['.', 'FE'],
  ])('refuses dir %s outside context %s', (dir, context) => {
    expect(() => appDir(svc(dir, context))).toThrow(`dir ${dir} is outside build.context ${context}`)
  })
})

describe('startBuildRequest', () => {
  const input = deployInput()
  const env = (req: ReturnType<typeof startBuildRequest>) => Object.fromEntries(req.environmentVariablesOverride.map((v) => [v.name, v.value]))

  it('builds a service without a Dockerfile from the build values, with no source of its own', () => {
    const req = startBuildRequest(input, input.spec.services[0], config)
    expect(req.projectName).toBe('student-apps')
    expect(req.sourceTypeOverride).toBe('NO_SOURCE')
    expect(req.buildspecOverride).toBe('version: 0.2\n')
    expect(req.environmentVariablesOverride.every((v) => v.type === 'PLAINTEXT')).toBe(true)
    expect(env(req)).toEqual({
      SOURCE_REPO: 'student/my-app',
      SOURCE_COMMIT: COMMIT,
      BUILD_CONTEXT: 'FE',
      FRAMEWORK: 'vite-react',
      APP_DIR: '.',
      NODE_VERSION: '22',
      INSTALL_CMD: 'pnpm install --frozen-lockfile',
      BUILD_CMD: 'pnpm run build',
      OUTPUT_DIR: 'dist',
      BUILD_ENV_B64: Buffer.from('VITE_API_URL=/api\0VITE_TITLE=a b "c" =d').toString('base64'),
      IMAGE_REPO,
      IMAGE_TAG: 'my-app-fe-111111111111',
      GHCR_USER: 'woowang-bot',
      GHCR_TOKEN_SECRET_ID: 'ghcr-push-token',
      PLATFORM_REPO: 'woowangthon/WOOWANGTHON_TEAM_18',
      PLATFORM_COMMIT: 'f'.repeat(40),
    })
  })

  it('sends only the Dockerfile path for a service with a Dockerfile, and no secret value', () => {
    const req = startBuildRequest(input, input.spec.services[1], config)
    expect(env(req)).toEqual({
      SOURCE_REPO: 'student/my-app',
      SOURCE_COMMIT: COMMIT,
      BUILD_CONTEXT: '.',
      DOCKERFILE: 'BE/Dockerfile',
      APP_DIR: 'BE',
      IMAGE_REPO,
      IMAGE_TAG: 'my-app-be-222222222222',
      GHCR_USER: 'woowang-bot',
      GHCR_TOKEN_SECRET_ID: 'ghcr-push-token',
      PLATFORM_REPO: 'woowangthon/WOOWANGTHON_TEAM_18',
      PLATFORM_COMMIT: 'f'.repeat(40),
    })
    expect(JSON.stringify(req)).not.toContain('DATABASE_URL')
  })
})


// aws CLI 대역. 부른 인자를 남기고, 명령(`codebuild start-build` 등)마다 정해 둔 답을 차례로 준다.
function fakeAws(answers: Record<string, unknown[]>) {
  const calls: string[][] = []
  const aws = vi.fn((args: string[]) => {
    calls.push(args)
    const key = `${args[0]} ${args[1]}`
    const queue = answers[key]
    if (!queue || queue.length === 0) return Promise.reject(new Error(`unexpected aws ${key}`))
    const next = queue.length === 1 ? queue[0] : queue.shift()
    const value = typeof next === 'function' ? (next as (a: string[]) => unknown)(args) : next
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  })
  return { aws, calls }
}

function fakeClock() {
  let t = 0
  return {
    sleep: vi.fn((ms: number) => {
      t += ms
      return Promise.resolve()
    }),
    now: () => t,
  }
}

const started = (args: string[]) => {
  const req = JSON.parse(args[3]) as ReturnType<typeof startBuildRequest>
  const tag = req.environmentVariablesOverride.find((v) => v.name === 'IMAGE_TAG')!.value
  return { build: { id: `student-apps:${tag}` } }
}
const FE_ID = 'student-apps:my-app-fe-111111111111'
const BE_ID = 'student-apps:my-app-be-222222222222'
const succeeded = (id: string, c: string) => ({ id, buildStatus: 'SUCCEEDED', exportedEnvironmentVariables: [{ name: 'IMAGE_DIGEST', value: digest(c) }] })
const inProgress = (id: string) => ({ id, buildStatus: 'IN_PROGRESS' })

describe('runBuilds', () => {
  it('starts every run service in parallel, skips reuse, polls until all finish and fills the digests', async () => {
    const { aws, calls } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [
        { builds: [inProgress(FE_ID), inProgress(BE_ID)] },
        { builds: [succeeded(FE_ID, 'd'), inProgress(BE_ID)] },
        { builds: [succeeded(BE_ID, 'e')] },
      ],
    })
    const clock = fakeClock()
    const report = await runBuilds(deployInput(), config, aws, clock)

    expect(report.ok).toBe(true)
    expect(report.failures).toEqual([])
    expect(report.builds).toEqual({ fe: FE_ID, be: BE_ID })
    expect(report.input.deploy_condition.services).toEqual({
      fe: { buildInputHash: HASH_FE, build: 'run', image: digest('d') },
      be: { buildInputHash: HASH_BE, build: 'run', image: digest('e') },
      ai: deployInput().deploy_condition.services.ai,
    })
    expect(calls.filter((c) => c[1] === 'start-build')).toHaveLength(2)
    // 끝난 빌드는 다시 묻지 않는다.
    expect(calls.filter((c) => c[1] === 'batch-get-builds').map((c) => c.slice(3))).toEqual([[FE_ID, BE_ID], [FE_ID, BE_ID], [BE_ID]])
    expect(clock.sleep).toHaveBeenCalledTimes(3)
    expect(clock.sleep).toHaveBeenCalledWith(10_000)
  })

  it('does not change the input it was given', async () => {
    const input = deployInput()
    const { aws } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [{ builds: [succeeded(FE_ID, 'd'), succeeded(BE_ID, 'e')] }] })
    await runBuilds(input, config, aws, fakeClock())
    expect(input).toEqual(deployInput())
  })

  it('calls nothing when every service reuses its image', async () => {
    const input = deployInput()
    input.deploy_condition.services.fe = { buildInputHash: HASH_FE, build: 'reuse', image: digest('d') }
    input.deploy_condition.services.be = { buildInputHash: HASH_BE, build: 'reuse', image: digest('e') }
    const { aws } = fakeAws({})
    const report = await runBuilds(input, config, aws, fakeClock())
    expect(report).toEqual({ ok: true, input, builds: {}, failures: [] })
    expect(aws).not.toHaveBeenCalled()
  })

  it('reports a failed build with the raw build, the failed phase and the last 200 log lines', async () => {
    const failedBuild = {
      id: BE_ID,
      buildStatus: 'FAILED',
      phases: [
        { phaseType: 'SUBMITTED', phaseStatus: 'SUCCEEDED' },
        { phaseType: 'BUILD', phaseStatus: 'FAILED', contexts: [{ statusCode: 'COMMAND_EXECUTION_ERROR', message: 'exit status 1' }] },
        { phaseType: 'POST_BUILD', phaseStatus: 'FAILED' },
        { phaseType: 'COMPLETED' },
      ],
      logs: { groupName: '/aws/codebuild/student-apps', streamName: 'abc' },
    }
    const { aws, calls } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [{ builds: [succeeded(FE_ID, 'd'), failedBuild] }],
      'logs get-log-events': [{ events: [{ message: 'npm ERR! missing script: build\n' }, { message: 'exit 1\r\n' }, { message: 'done' }] }],
    })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())

    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([
      { service: 'be', kind: 'build', buildStatus: 'FAILED', failedPhase: failedBuild.phases[1], logTail: ['npm ERR! missing script: build', 'exit 1', 'done'], build: failedBuild },
    ])
    expect(report.failures[0].kind === 'build' && report.failures[0].build).toBe(failedBuild)
    expect(report.input.deploy_condition.services.fe.image).toBe(digest('d'))
    expect(report.input.deploy_condition.services.be.image).toBeNull()
    expect(calls.find((c) => c[0] === 'logs')).toEqual([
      'logs',
      'get-log-events',
      '--log-group-name',
      '/aws/codebuild/student-apps',
      '--log-stream-name',
      'abc',
      '--limit',
      '200',
      '--no-start-from-head',
    ])
  })

  it.each(['FAULT', 'TIMED_OUT', 'STOPPED', 'CLIENT_ERROR'])('takes a %s phase as the failed phase', async (status) => {
    const build = { id: FE_ID, buildStatus: 'FAILED', phases: [{ phaseType: 'DOWNLOAD_SOURCE', phaseStatus: 'SUCCEEDED' }, { phaseType: 'BUILD', phaseStatus: status }] }
    const { aws } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [{ builds: [build, succeeded(BE_ID, 'e')] }] })
    const [failure] = (await runBuilds(deployInput(), config, aws, fakeClock())).failures
    expect(failure).toMatchObject({ service: 'fe', kind: 'build', failedPhase: build.phases[1], logTail: null })
  })

  it('still reports the failed build when its logs cannot be read', async () => {
    const build = { id: FE_ID, buildStatus: 'TIMED_OUT', logs: { groupName: 'g', streamName: 's' } }
    const { aws } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [{ builds: [build, succeeded(BE_ID, 'e')] }],
      'logs get-log-events': [new AwsError('AccessDeniedException', 'denied')],
    })
    const [failure] = (await runBuilds(deployInput(), config, aws, fakeClock())).failures
    expect(failure).toEqual({ service: 'fe', kind: 'build', buildStatus: 'TIMED_OUT', failedPhase: null, logTail: null, build })
  })

  it('reports a StartBuild API error as a platform failure and still waits for the other build', async () => {
    const { aws } = fakeAws({
      'codebuild start-build': [(args: string[]) => (args[3].includes('my-app-fe') ? new AwsError('AccountLimitExceededException', 'An error occurred (AccountLimitExceededException)') : started(args))],
      'codebuild batch-get-builds': [{ builds: [succeeded(BE_ID, 'e')] }],
    })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures).toEqual([{ service: 'fe', kind: 'platform', code: 'AccountLimitExceededException', message: 'An error occurred (AccountLimitExceededException)' }])
    expect(report.builds).toEqual({ be: BE_ID })
    expect(report.input.deploy_condition.services.be.image).toBe(digest('e'))
  })

  it.each([
    ['an answer without a build id', { build: {} }, 'AWS_CLI_FAILED', 'StartBuild answered without a build id'],
    ['an error without an AWS code', new AwsError(null, 'aws: command not found'), 'AWS_CLI_FAILED', 'aws: command not found'],
    ['an error that is not from the CLI', new Error('boom'), 'AWS_CLI_FAILED', 'boom'],
  ])('reports %s from StartBuild as a platform failure', async (_, answer, code, message) => {
    const input = deployInput()
    input.deploy_condition.services.be = { buildInputHash: HASH_BE, build: 'reuse', image: digest('e') }
    const { aws } = fakeAws({ 'codebuild start-build': [answer] })
    const report = await runBuilds(input, config, aws, fakeClock())
    expect(report).toMatchObject({ ok: false, builds: {}, failures: [{ service: 'fe', kind: 'platform', code, message }] })
  })

  it.each([
    ['no IMAGE_DIGEST', { id: FE_ID, buildStatus: 'SUCCEEDED', exportedEnvironmentVariables: [{ name: 'OTHER', value: digest('d') }] }],
    ['no exported variables', { id: FE_ID, buildStatus: 'SUCCEEDED' }],
    ['a tag instead of a digest', { id: FE_ID, buildStatus: 'SUCCEEDED', exportedEnvironmentVariables: [{ name: 'IMAGE_DIGEST', value: `${IMAGE_REPO}:t` }] }],
    ['a digest of another repository', { id: FE_ID, buildStatus: 'SUCCEEDED', exportedEnvironmentVariables: [{ name: 'IMAGE_DIGEST', value: `ghcr.io/other/student-apps@sha256:${'d'.repeat(64)}` }] }],
  ])('reports a success with %s as a platform failure', async (_, build) => {
    const { aws } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [{ builds: [build, succeeded(BE_ID, 'e')] }] })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures).toEqual([{ service: 'fe', kind: 'platform', code: 'NO_IMAGE_DIGEST', message: 'the build succeeded without exporting an image digest of the image repository' }])
    expect(report.input.deploy_condition.services.fe.image).toBeNull()
  })

  it('reports a build that BatchGetBuilds does not find', async () => {
    const { aws } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [{ builds: [succeeded(BE_ID, 'e')], buildsNotFound: [FE_ID, 'other:id'] }] })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures).toEqual([{ service: 'fe', kind: 'platform', code: 'BUILD_NOT_FOUND', message: `BatchGetBuilds did not find ${FE_ID}` }])
  })

  it('ignores builds in the answer that it did not ask about', async () => {
    const { aws } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [{ builds: [{ id: 'other:id', buildStatus: 'FAILED' }, succeeded(FE_ID, 'd'), succeeded(BE_ID, 'e')] }],
    })
    expect((await runBuilds(deployInput(), config, aws, fakeClock())).ok).toBe(true)
  })

  it('stops polling after three BatchGetBuilds errors in a row and reports every pending build', async () => {
    const { aws, calls } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [new AwsError('ThrottlingException', 'slow down')] })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures).toEqual([
      { service: 'fe', kind: 'platform', code: 'ThrottlingException', message: 'slow down' },
      { service: 'be', kind: 'platform', code: 'ThrottlingException', message: 'slow down' },
    ])
    expect(calls.filter((c) => c[1] === 'batch-get-builds')).toHaveLength(MAX_POLL_ERRORS)
  })

  it('keeps waiting through BatchGetBuilds errors that are not three in a row', async () => {
    const timeout = new AwsError('CLI_TIMEOUT', 'aws codebuild batch-get-builds did not answer in 60s')
    const { aws, calls } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [timeout, timeout, { builds: [inProgress(FE_ID), inProgress(BE_ID)] }, timeout, timeout, { builds: [succeeded(FE_ID, 'd'), succeeded(BE_ID, 'e')] }],
    })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report).toMatchObject({ ok: true, failures: [] })
    expect(report.input.deploy_condition.services.fe.image).toBe(digest('d'))
    expect(calls.filter((c) => c[1] === 'batch-get-builds')).toHaveLength(6)
  })

  it('gives up after 20 minutes of IN_PROGRESS', async () => {
    const { aws, calls } = fakeAws({ 'codebuild start-build': [started], 'codebuild batch-get-builds': [{ builds: [inProgress(FE_ID), succeeded(BE_ID, 'e')] }] })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures).toEqual([{ service: 'fe', kind: 'platform', code: 'BUILD_WAIT_TIMEOUT', message: 'build did not finish in 20 minutes' }])
    // 10초마다 묻는다. 20분째(120번째)에는 아직 넘기지 않았으므로 한 번 더 묻고 멈춘다.
    expect(calls.filter((c) => c[1] === 'batch-get-builds')).toHaveLength(121)
  })

  it('lists failures in spec order', async () => {
    const { aws } = fakeAws({
      'codebuild start-build': [started],
      'codebuild batch-get-builds': [{ builds: [inProgress(FE_ID), { id: BE_ID, buildStatus: 'FAILED' }] }, { builds: [{ id: FE_ID, buildStatus: 'FAILED' }] }],
    })
    const report = await runBuilds(deployInput(), config, aws, fakeClock())
    expect(report.failures.map((f) => f.service)).toEqual(['fe', 'be'])
  })
})
