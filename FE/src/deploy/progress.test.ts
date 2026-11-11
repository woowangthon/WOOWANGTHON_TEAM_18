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

it('polls only while the deploy is running or being fixed', () => {
  const polled: DeployStatus[] = ['running', 'fixing']
  const all: DeployStatus[] = ['not_started', 'running', 'fixing', 'needs_user', 'succeeded', 'failed']
  expect(all.filter(isActive)).toEqual(polled)
})

it('keeps polling a status it does not know, and labels it with the raw value', () => {
  expect(isActive('queued')).toBe(true)
  expect(statusLabel('queued')).toBe('queued')
  expect(statusVariant('queued')).toBe('neutral')
})

it('knows which failure codes are the platform fault', () => {
  for (const code of ['CODEBUILD_API_ERROR', 'IMAGE_PULL_FAILED', 'LIVE_SLOT_PROTECTED', 'AGENT_UNAVAILABLE']) {
    expect(isPlatformProblem(code)).toBe(true)
  }
  for (const code of ['BUILD_FAILED', 'DEPLOY_FAILED', 'VERIFY_FAILED', 'SWITCH_FAILED']) {
    expect(isPlatformProblem(code)).toBe(false)
  }
})
