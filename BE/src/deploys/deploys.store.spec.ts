import { ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { DeploysStore } from './deploys.store.js'

const ID = '6f1c0a52-3b7e-4a40-9a6c-2f5d8e1b7c90'
const queryOf = (call: Parameters<typeof fetch>) => Object.fromEntries(new URL(call[0] as string).searchParams)
const store = () => new DeploysStore(new ConfigService<Env, true>({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'k' }))

afterEach(() => vi.unstubAllGlobals())

describe('DeploysStore.updateRun', () => {
  it('only changes a row that still has the status and stage the caller saw, and says whether it did', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json([])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await store().updateRun(ID, { status: 'running', stage: 'apply' }, { stage: 'verify' })).toBe(false)
    expect(queryOf(fetchMock.mock.calls[0])).toEqual({ deploy_id: `eq.${ID}`, select: 'deploy_id', status: 'eq.running', stage: 'eq.apply' })

    fetchMock.mockResolvedValueOnce(Response.json([{}]))
    expect(await store().updateRun(ID, {}, { stage: 'verify' })).toBe(true)
    expect(queryOf(fetchMock.mock.calls[1])).toEqual({ deploy_id: `eq.${ID}`, select: 'deploy_id' })
  })
})

describe('DeploysStore request headers', () => {
  it('asks PostgREST to return the deleted rows, so an empty-bodied 204 does not read as a database failure', async () => {
    // PostgREST는 Prefer: return=representation 없이 DELETE하면 204와 빈 본문으로 답한다(줄은 지워진다).
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(
        new Headers(init?.headers).get('Prefer') === 'return=representation' ? Response.json([{ deploy_id: ID }]) : new Response(null, { status: 204 }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(store().deleteRun(ID)).resolves.toBeUndefined()
    const init = fetchMock.mock.calls[0][1]
    expect(init?.method).toBe('DELETE')
    expect(queryOf(fetchMock.mock.calls[0])).toEqual({ deploy_id: `eq.${ID}`, select: 'deploy_id' })
    const headers = new Headers(init?.headers)
    expect(headers.get('Prefer')).toBe('return=representation')
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('does not send Prefer on a read', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json([])))
    vi.stubGlobal('fetch', fetchMock)
    await store().findRun(ID)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Prefer')).toBe(false)
  })
})
