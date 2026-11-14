import { expect, it } from 'vitest'
import { isActive, isPlatformProblem, stageStatesOf, statusLabel, statusVariant } from './progress.ts'
import type { DeployStatus } from './progress.ts'
import type { StageKey } from './stages.ts'

const steps = (states: Record<StageKey, string>) => Object.entries(states).map(([key, state]) => ({ key, state }))
const atDeploy = steps({
  intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'done',
  deploy: 'active', verify: 'pending', done: 'pending',
})

it('maps each server step state onto a stage state while running', () => {
  expect(stageStatesOf({ status: 'running', steps: atDeploy })).toEqual({
    intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'done',
    deploy: 'active', verify: 'pending', done: 'pending',
  })
})

it('lays "fixing" and "needs user" over the stage that is still active, and nothing else', () => {
  expect(stageStatesOf({ status: 'fixing', steps: atDeploy }).deploy).toBe('fixing')
  expect(stageStatesOf({ status: 'needs_user', steps: atDeploy }).deploy).toBe('action')
  expect(stageStatesOf({ status: 'fixing', steps: atDeploy }).build).toBe('done')
  expect(stageStatesOf({ status: 'fixing', steps: atDeploy }).verify).toBe('pending')
})

it('keeps a failed step failed', () => {
  const failed = steps({
    intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'failed',
    deploy: 'pending', verify: 'pending', done: 'pending',
  })
  const states = stageStatesOf({ status: 'failed', steps: failed })
  expect(states.build).toBe('failed')
  expect(states.deploy).toBe('pending')
})

it('shows the secrets stage as waiting for the user before the deploy is started', () => {
  const before = steps({
    intake: 'done', analysis: 'done', config: 'done', secrets: 'active',
    build: 'pending', deploy: 'pending', verify: 'pending', done: 'pending',
  })
  expect(stageStatesOf({ status: 'not_started', steps: before }).secrets).toBe('action')
})

it('leaves a stage the server did not mention, or gave a value we do not know, as waiting', () => {
  const odd = [{ key: 'intake', state: 'done' }, { key: 'build', state: 'exploding' }]
  const states = stageStatesOf({ status: 'running', steps: odd })
  expect(states.intake).toBe('done')
  expect(states.build).toBe('pending')
  expect(states.done).toBe('pending')
})

it('polls only while the deploy is waiting, running or being fixed', () => {
  const polled: DeployStatus[] = ['queued', 'running', 'fixing']
  const all: DeployStatus[] = ['not_started', 'queued', 'running', 'fixing', 'needs_user', 'succeeded', 'failed']
  expect(all.filter(isActive)).toEqual(polled)
})

it('keeps polling a status it does not know, and labels it with the raw value', () => {
  expect(isActive('paused')).toBe(true)
  expect(statusLabel('paused')).toBe('paused')
  expect(statusVariant('paused')).toBe('neutral')
})

it('labels a waiting deploy and shows its build stage as waiting for its turn', () => {
  expect(statusLabel('queued')).toBe('배포 대기')
  expect(statusVariant('queued')).toBe('info')
  const atBuild = steps({
    intake: 'done', analysis: 'done', config: 'done', secrets: 'done', build: 'active',
    deploy: 'pending', verify: 'pending', done: 'pending',
  })
  expect(stageStatesOf({ status: 'queued', steps: atBuild })).toMatchObject({ secrets: 'done', build: 'queued', deploy: 'pending' })
})

it('counts a failure as the platform fault unless the code is one of the student-side codes', () => {
  for (const code of ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED']) {
    expect(isPlatformProblem(code)).toBe(false)
  }
  // 계약이 이름 붙인 학생 쪽이 아닌 코드, 열려 있는 플랫폼 코드, 목록에 없는 코드(AWS 코드 포함).
  const others = ['SWITCH_FAILED', 'TIMED_OUT', 'AGENT_UNAVAILABLE', 'CODEBUILD_API_ERROR', 'IMAGE_PULL_FAILED', 'LIVE_SLOT_PROTECTED']
  const open = ['BUILD_WAIT_TIMEOUT', 'NO_IMAGE_DIGEST', 'CHART_RENDER_FAILED', 'SPACE_MISSING', 'K8S_UNREACHABLE', 'AccountLimitExceededException']
  for (const code of [...others, ...open]) {
    expect(isPlatformProblem(code)).toBe(true)
  }
})

it('does not count AGENT_GAVE_UP as a platform problem, since the AI looked at the student failure and could not fix it', () => {
  expect(isPlatformProblem('AGENT_GAVE_UP')).toBe(false)
  expect(isPlatformProblem('AGENT_UNAVAILABLE')).toBe(true)
})
