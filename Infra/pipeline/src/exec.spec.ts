import { describe, expect, it } from 'vitest'
import { run } from './exec.js'

describe('run', () => {
  it('returns stdout and passes input on stdin', async () => {
    expect(await run('cat', [], { input: 'hello' })).toBe('hello')
  })

  it('throws stderr when the command fails', async () => {
    await expect(run('sh', ['-c', 'echo out; echo bad >&2; exit 3'])).rejects.toThrow('bad')
  })

  it('throws stdout when a failing command writes no stderr', async () => {
    await expect(run('sh', ['-c', 'echo only-out; exit 1'])).rejects.toThrow('only-out')
  })

  it('kills a command that runs past the timeout', async () => {
    await expect(run('sleep', ['5'], { timeoutMs: 100 })).rejects.toThrow('sleep did not finish in 0.1s')
  })
})
