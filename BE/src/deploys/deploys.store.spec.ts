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
