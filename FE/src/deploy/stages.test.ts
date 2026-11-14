import { expect, it } from 'vitest'
import { labelOfPipelineStage, PIPELINE_STAGES, ranStages } from './stages.ts'

const names = (input: Parameters<typeof ranStages>[0]) => ranStages(input).map((s) => s.stage)
const ALL = ['build', 'prepare', 'render', 'apply', 'verify', 'switch']
const failure = (stage: string) => ({ stage })

it('lists the six pipeline stages in order', () => {
  expect(PIPELINE_STAGES.map((s) => s.stage)).toEqual(ALL)
})

it('names a pipeline stage by its label and an unknown one by itself', () => {
  expect(labelOfPipelineStage('build')).toBe('빌드')
  expect(labelOfPipelineStage('switch')).toBe('전환')
  expect(labelOfPipelineStage('mystery')).toBe('mystery')
})

it('ran every stage when the deploy succeeded', () => {
  expect(names({ status: 'succeeded', failure: null })).toEqual(ALL)
})

it('ran the stages up to and including the one that failed', () => {
  expect(names({ status: 'failed', failure: failure('render') })).toEqual(['build', 'prepare', 'render'])
  expect(names({ status: 'failed', failure: failure('build') })).toEqual(['build'])
})

it('shows every stage when the failed stage is unknown or missing', () => {
  expect(names({ status: 'failed', failure: failure('mystery') })).toEqual(ALL)
  expect(names({ status: 'needs_user', failure: null })).toEqual(ALL)
})

it('shows every stage when the switch failed', () => {
  expect(names({ status: 'failed', failure: failure('switch') })).toEqual(ALL)
})
