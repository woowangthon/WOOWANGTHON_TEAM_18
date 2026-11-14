import type { ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { ClusterCapacity } from './cluster-capacity.js'
import { ClusterError } from './cluster-error.js'
import type { ClusterReader, NodeInfo, NodeUsageInfo } from './cluster-reader.js'

const node = (name: string, over: Partial<NodeInfo> = {}): NodeInfo => ({
  name,
  ready: true,
  roles: [],
  capacity: {},
  allocatable: { cpu: '4', memory: '8Gi' },
  ...over,
})
const usage = (name: string, cpu: string, memory: string): NodeUsageInfo => ({ name, usage: { cpu, memory } })

let nodes: NodeInfo[] | Error
let usages: NodeUsageInfo[] | Error
let reads: number
const reader = {
  nodes: () => {
    reads++
    return nodes instanceof Error ? Promise.reject(nodes) : Promise.resolve(nodes)
  },
  nodeUsage: () => (usages instanceof Error ? Promise.reject(usages) : Promise.resolve(usages)),
} as unknown as ClusterReader
const capacity = (percent = 80) => new ClusterCapacity(reader, { get: () => percent } as unknown as ConfigService<Env, true>)

beforeEach(() => {
  vi.useFakeTimers()
  reads = 0
  nodes = [node('w1'), node('w2')]
  usages = [usage('w1', '1', '1Gi'), usage('w2', '1', '1Gi')]
})
afterEach(() => vi.useRealTimers())

describe('ClusterCapacity.isFull', () => {
  it('is not full below the threshold', async () => {
    expect(await capacity().isFull()).toBe(false)
  })

  it('is full when CPU use of the workers reaches the threshold', async () => {
    usages = [usage('w1', '3200m', '1Gi'), usage('w2', '3200m', '1Gi')]
    expect(await capacity().isFull()).toBe(true)
  })

  it('is full when memory alone reaches the threshold (the larger of the two counts)', async () => {
    usages = [usage('w1', '100m', '7Gi'), usage('w2', '100m', '6Gi')]
    expect(await capacity().isFull()).toBe(true)
  })

  it('uses the configured percent', async () => {
    usages = [usage('w1', '2', '1Gi'), usage('w2', '2', '1Gi')]
    expect(await capacity(50).isFull()).toBe(true)
    expect(await capacity(51).isFull()).toBe(false)
  })

  it('leaves out control-plane nodes, nodes that are not Ready, and nodes with no reading yet', async () => {
    nodes = [node('leader', { roles: ['control-plane'] }), node('down', { ready: false }), node('fresh'), node('w1')]
    usages = [usage('leader', '4', '8Gi'), usage('down', '4', '8Gi'), usage('w1', '1', '1Gi')]
    expect(await capacity().isFull()).toBe(false)
  })

  it('does not block when no worker can be measured', async () => {
    nodes = [node('leader', { roles: ['control-plane'] })]
    expect(await capacity().isFull()).toBe(false)
  })

  it.each([
    ['the node list', () => (nodes = new ClusterError('unreachable'))],
    ['the usage (metrics server)', () => (usages = new ClusterError('not_found', 404))],
  ])('does not block when %s cannot be read', async (_what, fail) => {
    fail()
    expect(await capacity().isFull()).toBe(false)
  })

  it('reads the cluster once per 10 seconds', async () => {
    const c = capacity()
    await c.isFull()
    await c.isFull()
    expect(reads).toBe(1)
    vi.advanceTimersByTime(10_001)
    await c.isFull()
    expect(reads).toBe(2)
  })
})
