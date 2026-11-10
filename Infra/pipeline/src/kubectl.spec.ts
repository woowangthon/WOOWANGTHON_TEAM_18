import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { kubectlDryRun } from './kubectl.js'

// PATH 앞에 가짜 kubectl을 둔다. 인자와 표준 입력을 파일로 남기고, FAKE_FAIL이면 실제 kubectl처럼 문장을 stderr에 내고 1로 끝난다.
let dir: string
let path: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kubectl-'))
  writeFileSync(
    join(dir, 'kubectl'),
    `#!/usr/bin/env bash\necho "$*" > "${dir}/args"\ncat > "${dir}/stdin"\nif [ -n "$FAKE_FAIL" ]; then echo 'Error from server (Forbidden): error when creating "STDIN": exceeded quota' >&2; exit 1; fi\necho 'deployment.apps/fe-a created (server dry run)'\n`,
  )
  chmodSync(join(dir, 'kubectl'), 0o755)
  path = process.env.PATH
  process.env.PATH = `${dir}:${path}`
})
afterEach(() => {
  process.env.PATH = path
  delete process.env.FAKE_FAIL
  rmSync(dir, { recursive: true, force: true })
})

const read = (f: string) => readFileSync(join(dir, f), 'utf8')

describe('kubectlDryRun', () => {
  it('server dry-runs the manifest from stdin in the namespace', async () => {
    expect(await kubectlDryRun('kind: X\n', 'proj-my-app')).toEqual({ ok: true })
    expect(read('args')).toBe('apply --dry-run=server --namespace proj-my-app --filename -\n')
    expect(read('stdin')).toBe('kind: X\n')
  })

  it('reports the kubectl message, with no Status (kubectl prints none)', async () => {
    process.env.FAKE_FAIL = '1'
    expect(await kubectlDryRun('kind: X\n', 'proj-my-app')).toEqual({
      ok: false,
      status: null,
      message: 'Error from server (Forbidden): error when creating "STDIN": exceeded quota',
    })
  })
})
