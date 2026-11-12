import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Infra/gocd/job.sh의 student-trial 단계를 임시 폴더에서 돌린다. job.sh는 자기 위치의 ../..(레포 루트)로 옮겨 가므로
// 임시 루트에 Infra/gocd/job.sh를 복사하고, Infra/pipeline/dist/cli/*.js 자리에 받은 인자를 로그에 남기는 가짜 CLI를 둔다.
const JOB = fileURLToPath(new URL('../../gocd/job.sh', import.meta.url))
const YAML = readFileSync(fileURLToPath(new URL('../../gocd/student-trial.gocd.yaml', import.meta.url)), 'utf8')
const CLIS = ['fetch-input', 'build', 'prepare', 'render', 'apply', 'verify', 'trial-report', 'notify']

// 가짜 CLI: 이름 · 인자를 로그에 한 줄(JSON)로 남긴다. fetch-input은 입력 파일을 쓴다. FAKE_EXIT_<이름>이 있으면 그 코드로 끝난다.
const FAKE = (name: string) => `const fs = require('fs')
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cli: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n')
if (${JSON.stringify(name)} === 'fetch-input') {
  fs.mkdirSync('work', { recursive: true })
  fs.writeFileSync('work/deploy-input.json', '{"trial":true}\\n')
  fs.writeFileSync('work/slot', 'b')
  fs.writeFileSync('work/build-overrides.json', 'null\\n')
}
process.exit(Number(process.env['FAKE_EXIT_${name.replace('-', '_')}'] || 0))
`

let root: string
let log: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gocd-trial-'))
  mkdirSync(join(root, 'Infra/gocd'), { recursive: true })
  copyFileSync(JOB, join(root, 'Infra/gocd/job.sh'))
  mkdirSync(join(root, 'Infra/pipeline/dist/cli'), { recursive: true })
  for (const name of CLIS) writeFileSync(join(root, `Infra/pipeline/dist/cli/${name}.js`), FAKE(name))
  log = join(root, 'cli.log')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function job(args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync('bash', [join(root, 'Infra/gocd/job.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    // node가 PATH에 있게 지금 돌고 있는 node의 폴더를 앞에 둔다.
    env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, FAKE_LOG: log, DEPLOY_ID: 'd', TRIAL_ID: 'tr_0123456789ab', TRIAL_STAGES: 'prepare,render,apply', GO_REVISION_PLATFORM: 'f'.repeat(40), ...env },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { cli: string; args: string[] }) : [])

describe('job.sh trial', () => {
  it.each([[''], ['apply'], ['render,verify'], [undefined]])('fails (exit 2) on TRIAL_STAGES %j instead of skipping every stage', (stages) => {
    const r = job(['trial', 'render', 'trial-fetch-input'], { TRIAL_STAGES: stages })
    expect(r.code).toBe(2)
    expect(r.out).toContain('TRIAL_STAGES must be build, render, prepare,render,apply or verify')
    expect(calls()).toEqual([])
  })

  it('a stage outside TRIAL_STAGES does nothing and passes, and leaves an out/ for the artifact', () => {
    for (const step of [['clean', 'build'], ['setup'], ['trial-fetch-input'], ['build'], ['trial-report', 'build']]) {
      expect(job(['trial', 'build', ...step]).code).toBe(0)
    }
    expect(calls()).toEqual([])
    expect(existsSync(join(root, 'work'))).toBe(false)
    expect(readFileSync(join(root, 'out/.out-of-scope'), 'utf8')).toContain('stage build is not in this trial (prepare,render,apply)')
  })

  it('an in-scope stage reads the trial input first and keeps it as the built input', () => {
    expect(job(['trial', 'render', 'trial-fetch-input']).code).toBe(0)
    expect(calls()).toEqual([{ cli: 'fetch-input', args: ['work'] }])
    expect(readFileSync(join(root, 'work/deploy-input.built.json'), 'utf8')).toBe('{"trial":true}\n')
  })

  it('runs the stage CLI on the built input and the slot', () => {
    job(['trial', 'render', 'trial-fetch-input'])
    expect(job(['trial', 'render', 'render']).code).toBe(0)
    expect(calls()[1]).toEqual({ cli: 'render', args: ['work/deploy-input.built.json', 'b', 'out'] })
  })

  it('a trial build passes build-overrides.json; a student-deploy build does not', () => {
    job(['trial', 'build', 'trial-fetch-input'], { TRIAL_STAGES: 'build' })
    expect(job(['trial', 'build', 'build'], { TRIAL_STAGES: 'build' }).code).toBe(0)
    expect(calls()[1]).toEqual({ cli: 'build', args: ['work/deploy-input.json', 'work/build-report.json', 'work/build-overrides.json'] })
    expect(job(['build'], { TRIAL_ID: undefined }).code).toBe(0)
    expect(calls()[2]).toEqual({ cli: 'build', args: ['work/deploy-input.json', 'work/build-report.json'] })
  })

  it('a failed stage CLI fails the step with its code', () => {
    job(['trial', 'apply', 'trial-fetch-input'])
    expect(job(['trial', 'apply', 'apply'], { FAKE_EXIT_apply: '1' }).code).toBe(1)
  })

  it.each([
    ['apply', 'out/apply-report.json'],
    ['prepare', 'out/prepare-report.json'],
  ])('trial-report %s sends that stage report with the trial input', (stage, report) => {
    expect(job(['trial', stage, 'trial-report', stage]).code).toBe(0)
    expect(calls()).toEqual([{ cli: 'trial-report', args: [stage, report, 'work/deploy-input.json'] }])
  })

  it('trial-report build reads the build report', () => {
    expect(job(['trial', 'build', 'trial-report', 'build'], { TRIAL_STAGES: 'build' }).code).toBe(0)
    expect(calls()).toEqual([{ cli: 'trial-report', args: ['build', 'work/build-report.json', 'work/deploy-input.json'] }])
  })

  it('trial-report without the built CLI says so and fails (no result: the gateway answers TRIAL_TIMEOUT)', () => {
    rmSync(join(root, 'Infra/pipeline/dist/cli/trial-report.js'))
    const r = job(['trial', 'apply', 'trial-report', 'apply'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('the CLI is not built')
  })

  it('stops before any request with an empty TRIAL_ID or DEPLOY_ID', () => {
    expect(job(['trial', 'render', 'trial-fetch-input'], { TRIAL_ID: '' }).code).not.toBe(0)
    expect(job(['trial', 'render', 'trial-fetch-input'], { DEPLOY_ID: '' }).code).not.toBe(0)
    expect(calls()).toEqual([])
  })
})

describe('student-trial.gocd.yaml', () => {
  it('has the five trial stages and no Switch, and never notifies the run', () => {
    expect([...YAML.matchAll(/^ {6}- (\w+):$/gm)].map((m) => m[1])).toEqual(['build', 'prepare', 'render', 'apply', 'verify'])
    expect(YAML).not.toMatch(/- switch:|job\.sh, (trial, \w+, )?switch/)
    expect(YAML).not.toContain('notify]')
  })

  it('wraps every task in `trial <stage>` of its own stage, reads the input before the stage CLI and reports with run_if any', () => {
    for (const stage of ['build', 'prepare', 'render', 'apply', 'verify']) {
      const block = YAML.split(/^ {6}- /m).find((b) => b.startsWith(`${stage}:`))!
      const steps = [...block.matchAll(/arguments: \[Infra\/gocd\/job\.sh, trial, (\w+), ([\w-]+)(?:, (\w+))?\]\n\s+run_if: (\w+)/g)].map((m) => {
        expect(m[1]).toBe(stage)
        return `${m[2]}${m[3] ? ` ${m[3]}` : ''} (${m[4]})`
      })
      expect(steps).toEqual([`clean ${stage} (passed)`, 'setup (passed)', 'trial-fetch-input (passed)', `${stage} (passed)`, `trial-report ${stage} (any)`])
    }
  })

  it('starts only by the schedule call and gives Build at least 30 minutes', () => {
    expect(YAML).toMatch(/- build:\n {10}approval:\n {12}type: manual/)
    expect(Number(/build:\n[\s\S]*?timeout: (\d+)/.exec(YAML.split(/^ {6}- prepare:/m)[0])![1])).toBeGreaterThanOrEqual(30)
    for (const name of ['DEPLOY_ID', 'TRIAL_ID', 'TRIAL_STAGES']) expect(YAML).toContain(`      ${name}: ""`)
  })
})
