import { afterEach, describe, expect, it } from 'vitest'
import { fetchInput } from './fetch-input.js'
import { deployInput } from './fixtures.js'
import { DEPLOY_ID, fakePlatform, TOKEN } from './platform-fake.js'

const sleep = () => Promise.resolve()

describe('fetchInput', () => {
  let platform: Awaited<ReturnType<typeof fakePlatform>> | undefined
  const conn = () => ({ url: new URL(platform!.url), token: TOKEN })
  const serve = async (answer: unknown, status = 200) => {
    platform = await fakePlatform(() => ({ status, body: answer }))
  }
  afterEach(async () => {
    await platform?.close()
    platform = undefined
  })

  it('reads the input and the slot of the run, asking by deploy id with the token', async () => {
    await serve({ deployId: DEPLOY_ID, slot: 'b', input: deployInput() })
    expect(await fetchInput(conn(), DEPLOY_ID, sleep)).toEqual({ slot: 'b', input: deployInput() })
    expect(platform!.seen).toHaveLength(1)
    expect(platform!.seen[0]).toMatchObject({ method: 'GET', url: `/api/pipeline/deploys/${DEPLOY_ID}/input` })
    expect(platform!.seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('accepts the deploy id in the other letter case', async () => {
    await serve({ deployId: DEPLOY_ID.toUpperCase(), slot: 'a', input: deployInput() })
    expect((await fetchInput(conn(), DEPLOY_ID, sleep)).slot).toBe('a')
  })

  it('stops on an answer for another deploy', async () => {
    await serve({ deployId: '22222222-2222-4222-8222-222222222222', slot: 'a', input: deployInput() })
    await expect(fetchInput(conn(), DEPLOY_ID, sleep)).rejects.toThrow('not usable: deployId is not the one asked for')
  })

  it.each([undefined, 'c', 'A', null, 1])('stops on the slot %j', async (slot) => {
    await serve({ deployId: DEPLOY_ID, slot, input: deployInput() })
    await expect(fetchInput(conn(), DEPLOY_ID, sleep)).rejects.toThrow('not usable: slot is neither a nor b')
  })

  it.each([
    ['no input', undefined, 'not usable: input is not an object'],
    ['an input that is a list', [], 'not usable: input is not an object'],
    ['an input without deploy_condition services', { ...deployInput(), deploy_condition: { secretHash: null } }, 'deploy_condition.services is not filled'],
    ['a commit that is not a SHA', { ...deployInput(), commitSha: 'main' }, 'commitSha is not a 40-char SHA'],
  ])('stops on %s (the later stages must not call CodeBuild or k3s with it)', async (_, input, why) => {
    await serve({ deployId: DEPLOY_ID, slot: 'a', input })
    await expect(fetchInput(conn(), DEPLOY_ID, sleep)).rejects.toThrow(why)
  })

  it.each([[null], ['"text"'], [[]]])('stops on an answer that is %j', async (answer) => {
    await serve(answer)
    await expect(fetchInput(conn(), DEPLOY_ID, sleep)).rejects.toThrow('not usable: not an object')
  })

  it('passes a 404 on (no run for the id)', async () => {
    await serve({ error: { code: 'DEPLOY_NOT_FOUND', message: 'x' } }, 404)
    await expect(fetchInput(conn(), DEPLOY_ID, sleep)).rejects.toMatchObject({ status: 404, message: `GET /api/pipeline/deploys/${DEPLOY_ID}/input answered 404: DEPLOY_NOT_FOUND` })
  })
})
