import { describe, expect, it } from 'vitest'
import { ownsPod, seriesByService, serviceUsage, sumPoints, usageByPod } from './service-metrics.js'

const pts = (...vs: [number, number][]) => vs.map(([t, v]) => ({ t, v }))

describe('ownsPod', () => {
  it('matches the Deployment name, a ReplicaSet hash and five characters', () => {
    expect(ownsPod('fe-a', 'fe-a-6d9f8c7b5-x1y2z')).toBe(true)
  })
  it('does not match another Deployment that shares a prefix', () => {
    expect(ownsPod('fe', 'fe-a-6d9f8c7b5-x1y2z')).toBe(false)
    expect(ownsPod('fe-a', 'fe-a-extra-6d9f8c7b5-x1y2z')).toBe(false)
    expect(ownsPod('fe-a', 'fe-a-6d9f8c7b5')).toBe(false)
  })
  it('treats regex characters in the name literally', () => {
    expect(ownsPod('f.-a', 'fe-a-1-aaaaa')).toBe(false)
  })
})

describe('usageByPod and serviceUsage', () => {
  const infos = [
    { name: 'p1', containers: [{ cpu: '10m', memory: '1Mi' }, { cpu: '5m', memory: '1Mi' }] },
    { name: 'p2', containers: [{ cpu: '20m', memory: '2Mi' }] },
    { name: 'bad', containers: [{ cpu: 'zzz', memory: '1Mi' }] },
    { name: 'none', containers: [] },
  ]
  it('sums containers and leaves out Pods it cannot read', () => {
    expect([...usageByPod(infos)]).toEqual([
      ['p1', { cpuMillicores: 15, memoryBytes: 2 * 1024 ** 2 }],
      ['p2', { cpuMillicores: 20, memoryBytes: 2 * 1024 ** 2 }],
    ])
  })
  it('sums the Pods of one service, only those present', () => {
    expect(serviceUsage(['p1', 'p2', 'gone'], usageByPod(infos))).toEqual({ cpuMillicores: 35, memoryBytes: 4 * 1024 ** 2 })
  })
  it('is null when no Pod of the service has a reading or usage was not read', () => {
    expect(serviceUsage(['gone', 'bad'], usageByPod(infos))).toBeNull()
    expect(serviceUsage([], usageByPod(infos))).toBeNull()
    expect(serviceUsage(['p1'], null)).toBeNull()
  })
})

describe('sumPoints and seriesByService', () => {
  it('adds points with the same time, sorts by time and scales and rounds', () => {
    const out = sumPoints([{ pod: 'a', points: pts([120, 0.1], [60, 0.0004]) }, { pod: 'b', points: pts([60, 0.0004]) }], 1000)
    expect(out).toEqual([{ t: 60, v: 1 }, { t: 120, v: 100 }])
  })
  it('is empty for no series', () => {
    expect(sumPoints([])).toEqual([])
  })
  it('splits series by service in the given order and keeps services without points', () => {
    const cpu = [{ pod: 'fe-a-1-aaaaa', points: pts([60, 0.5]) }, { pod: 'fe-a-2-bbbbb', points: pts([60, 0.25]) }, { pod: 'be-a-1-ccccc', points: pts([60, 1]) }]
    const memory = [{ pod: 'be-a-1-ccccc', points: pts([60, 7]) }]
    expect(seriesByService([{ name: 'fe', deployment: 'fe-a' }, { name: 'be', deployment: 'be-a' }, { name: 'ai', deployment: 'ai-a' }], cpu, memory)).toEqual([
      { name: 'fe', cpuMillicores: [{ t: 60, v: 750 }], memoryBytes: [] },
      { name: 'be', cpuMillicores: [{ t: 60, v: 1000 }], memoryBytes: [{ t: 60, v: 7 }] },
      { name: 'ai', cpuMillicores: [], memoryBytes: [] },
    ])
  })
})
