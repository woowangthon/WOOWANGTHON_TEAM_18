import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployEvents } from '../deploys/deploy-events.js'
import type { DeployRunRow, DeploysStore } from '../deploys/deploys.store.js'
import { deployMessage, DeployResultNotifier } from './deploy-result.notifier.js'
import type { DiscordNotifier } from './discord.notifier.js'
import type { IncidentsStore } from './incidents.store.js'

const HOOK = 'https://discord.com/api/webhooks/222/student-token'
const run = (over: Partial<DeployRunRow>) => ({ slug: 'my-app', status: 'succeeded', failure: null, agent_result: null, user_id: 'u1', ...over }) as DeployRunRow

describe('deployMessage', () => {
  it('says the deploy finished', () => {
    expect(deployMessage(run({}))).toBe('[my-app] 배포를 마쳤어요.')
  })

  it('gives the stage, the code, its message and the AI summary of a failure', () => {
    const text = deployMessage(run({ status: 'failed', failure: { code: 'AGENT_GAVE_UP', stage: 'apply', service: 'be' }, agent_result: { summary: '시작할 때 없는 파일을 읽어요.' } }))
    expect(text.split('\n')[0]).toBe('[my-app] 배포하지 못했어요 (apply · AGENT_GAVE_UP).')
    expect(text.split('\n')).toHaveLength(3)
    expect(text).toContain('AI: 시작할 때 없는 파일을 읽어요.')
  })

  it('links the PR the AI opened and asks to merge and deploy again', () => {
    const text = deployMessage(run({ status: 'needs_user', agent_result: { status: 'pr_opened', pr: { url: 'https://github.com/s/app/pull/3' } } }))
    expect(text).toBe('[my-app] AI가 고친 PR을 열었어요: https://github.com/s/app/pull/3\n머지한 뒤 다시 배포해 주세요.')
  })

  it('passes on what the student has to do', () => {
    expect(deployMessage(run({ status: 'needs_user', agent_result: { userRequest: { message: 'DB_URL 비밀값을 넣어 주세요.' } } }))).toBe(
      '[my-app] 배포를 이어 가려면 확인이 필요해요.\nDB_URL 비밀값을 넣어 주세요.',
    )
    expect(deployMessage(run({ status: 'needs_user' }))).toBe('[my-app] 배포를 이어 가려면 확인이 필요해요.')
  })
})

describe('DeployResultNotifier', () => {
  let events: DeployEvents
  let findRun: ReturnType<typeof vi.fn>
  let webhook: ReturnType<typeof vi.fn>
  let sent: { url: string | null; content: string }[]
  let notifier: DeployResultNotifier

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    events = new DeployEvents()
    findRun = vi.fn(() => Promise.resolve(run({})))
    webhook = vi.fn(() => Promise.resolve(HOOK))
    sent = []
    const discord = { toStudent: (url: string | null, content: string) => (sent.push({ url, content }), Promise.resolve()) }
    notifier = new DeployResultNotifier(events, { findRun } as unknown as DeploysStore, { webhook } as unknown as IncidentsStore, discord as unknown as DiscordNotifier)
    notifier.onModuleInit()
  })
  afterEach(() => vi.restoreAllMocks())

  it('sends the result of an ended run to the owner\'s webhook', async () => {
    events.ended('d1')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(findRun).toHaveBeenCalledWith('d1')
    expect(webhook).toHaveBeenCalledWith('u1')
    expect(sent[0]).toEqual({ url: HOOK, content: '[my-app] 배포를 마쳤어요.' })
  })

  it('does not throw when the run or the webhook cannot be read', async () => {
    findRun.mockRejectedValueOnce(new Error('db down'))
    await expect(notifier.notify('d1')).resolves.toBeUndefined()
    webhook.mockRejectedValueOnce(new Error('db down'))
    await expect(notifier.notify('d1')).resolves.toBeUndefined()
    findRun.mockResolvedValueOnce(undefined)
    await notifier.notify('d1')
    expect(sent).toEqual([])
  })
})
