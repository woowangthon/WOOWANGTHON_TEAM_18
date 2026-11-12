import { describe, expect, it } from 'vitest'
import type { Spec } from '../deploys/deploy-input.js'
import { envFiles, type Finding, MAX_WARNINGS, parseGitleaks, parseTrivy, readFindings, serviceOf, toWarnings } from './findings.js'

const ROOT = '/tmp/wcp-scan-x/src'
// 서비스 폴더만 쓰는 spec.
const spec = (...dirs: [string, string][]) => ({ project: { slug: 'my-app', repo: 'a/b' }, services: dirs.map(([name, dir]) => ({ name, dir })) }) as unknown as Spec

// gitleaks 8.30 `dir --report-format json`의 한 항목(실제 출력의 칸 그대로).
const leak = (file: string, line: number, rule = 'aws-access-token') => ({
  RuleID: rule,
  Description: 'x',
  StartLine: line,
  EndLine: line,
  StartColumn: 14,
  EndColumn: 33,
  Match: 'key = "AKIAQYLPMN5HHHFPZAM2"',
  Secret: 'AKIAQYLPMN5HHHFPZAM2',
  File: `${ROOT}/${file}`,
  SymlinkFile: '',
  Commit: '',
  Entropy: 3.6,
  Author: '',
  Email: '',
  Date: '',
  Message: '',
  Tags: [],
  Fingerprint: `${ROOT}/${file}:aws-access-token:${line}`,
})
// Trivy 0.76 `fs --format json`의 모양(쓰는 칸만).
const trivy = (results: unknown[]) => ({ SchemaVersion: 2, ArtifactName: ROOT, ArtifactType: 'filesystem', Results: results })
const vuln = (id: string, severity: string, fixed = '', pkg = 'lodash', version = '4.17.15') => ({
  VulnerabilityID: id,
  PkgName: pkg,
  InstalledVersion: version,
  FixedVersion: fixed,
  Severity: severity,
  Title: 'x',
})

describe('parseGitleaks', () => {
  it('keeps only the place and the rule: the secret and the matched text are dropped', () => {
    const found = parseGitleaks([leak('backend/config.js', 3)], ROOT)
    expect(found).toEqual([{ kind: 'secret', file: 'backend/config.js', line: 3, rule: 'aws-access-token' }])
    expect(JSON.stringify(found)).not.toContain('AKIA')
  })

  it('reads an empty report as nothing found', () => {
    expect(parseGitleaks([], ROOT)).toEqual([])
  })

  it.each([
    ['not an array', { findings: [] }],
    ['a finding without a file', [{ ...leak('a.js', 1), File: '' }]],
    ['a finding without a line', [{ ...leak('a.js', 1), StartLine: '1' }]],
  ])('refuses a report that is %s (a changed tool must not read as "nothing found")', (_, report) => {
    expect(() => parseGitleaks(report, ROOT)).toThrow()
  })
})

describe('parseTrivy', () => {
  it('keeps HIGH and CRITICAL vulnerabilities with the lock file, package, version and fixed version', () => {
    const report = trivy([
      { Target: 'backend/package-lock.json', Class: 'lang-pkgs', Type: 'npm', Vulnerabilities: [vuln('CVE-2021-23337', 'HIGH', '4.17.21'), vuln('CVE-1', 'MEDIUM', '1')] },
      { Target: 'frontend/package-lock.json', Class: 'lang-pkgs', Type: 'npm' },
    ])
    expect(parseTrivy(report)).toEqual([
      { kind: 'vuln', target: 'backend/package-lock.json', pkg: 'lodash', version: '4.17.15', id: 'CVE-2021-23337', severity: 'HIGH', fixed: '4.17.21' },
    ])
  })

  it('reads a report without results (no lock file) as nothing found, and an empty fixed version as null', () => {
    expect(parseTrivy({ SchemaVersion: 2 })).toEqual([])
    expect(parseTrivy(trivy([{ Target: 'a/package-lock.json', Vulnerabilities: [vuln('CVE-9', 'CRITICAL')] }]))[0]).toMatchObject({ fixed: null })
  })

  it.each([
    ['another schema version', { SchemaVersion: 3, Results: [] }],
    ['results that are not a list', { SchemaVersion: 2, Results: {} }],
    ['a vulnerability without a package', trivy([{ Target: 'x', Vulnerabilities: [{ ...vuln('CVE-1', 'HIGH'), PkgName: undefined }] }])],
  ])('refuses %s', (_, report) => {
    expect(() => parseTrivy(report)).toThrow()
  })
})

describe('envFiles', () => {
  it('finds committed .env files by name, not their example files', () => {
    expect(envFiles(['.env', 'backend/.env.production', 'frontend/.env.example', 'a/.env.sample', '.envrc', 'docs/env.md', 'x/.env.local'])).toEqual([
      { kind: 'env_file', file: '.env' },
      { kind: 'env_file', file: 'backend/.env.production' },
      { kind: 'env_file', file: 'x/.env.local' },
    ])
  })
})

describe('serviceOf', () => {
  const s = spec(['fe', 'frontend'], ['be', 'backend'], ['root', '.'])

  it('picks the service whose folder is the longest prefix of the path', () => {
    expect(serviceOf('backend/src/a.js', s)).toBe('be')
    expect(serviceOf('frontend/.env', s)).toBe('fe')
    expect(serviceOf('README.md', s)).toBe('root')
    // backendx는 backend/ 아래가 아니다.
    expect(serviceOf('backendx/a.js', s)).toBe('root')
  })

  it('is null when no service folder holds the path, or two services share the folder', () => {
    expect(serviceOf('docs/a.md', spec(['fe', 'frontend']))).toBeNull()
    expect(serviceOf('app/a.js', spec(['web', 'app'], ['worker', 'app']))).toBeNull()
    expect(serviceOf('a.js', { project: { slug: 'x', repo: 'a/b' } } as unknown as Spec)).toBeNull()
  })
})

describe('toWarnings', () => {
  const s = spec(['fe', 'frontend'], ['be', 'backend'])

  it('lists secrets, then .env files, then one line per vulnerable package with the worst severity first', () => {
    const findings: Finding[] = [
      { kind: 'vuln', target: 'backend/package-lock.json', pkg: 'lodash', version: '4.17.15', id: 'CVE-A', severity: 'HIGH', fixed: '4.17.19' },
      { kind: 'vuln', target: 'backend/package-lock.json', pkg: 'lodash', version: '4.17.15', id: 'CVE-B', severity: 'HIGH', fixed: '4.17.21' },
      { kind: 'vuln', target: 'frontend/package-lock.json', pkg: 'axios', version: '0.21.0', id: 'CVE-C', severity: 'CRITICAL', fixed: null },
      { kind: 'env_file', file: 'backend/.env' },
      { kind: 'secret', file: 'backend/config.js', line: 3, rule: 'aws-access-token' },
    ]
    expect(toWarnings(findings, s)).toEqual([
      {
        code: 'SECRET_FOUND',
        message: 'backend/config.js 3번째 줄에 비밀값으로 보이는 값이 있어요(규칙 aws-access-token). 레포에서 지우고, 진짜 키라면 새로 발급받으세요.',
        service: 'be',
      },
      {
        code: 'ENV_FILE_COMMITTED',
        message: 'backend/.env 파일이 레포에 올라가 있어요. 비밀값이 들어 있다면 레포에서 지우고 비밀값 입력 단계에서 넣으세요.',
        service: 'be',
      },
      {
        code: 'VULNERABLE_DEPENDENCY',
        message: 'frontend/package-lock.json의 axios 0.21.0에 알려진 취약점이 1개 있어요(가장 높은 심각도 CRITICAL: CVE-C). 아직 고친 버전이 없어요.',
        service: 'fe',
      },
      {
        code: 'VULNERABLE_DEPENDENCY',
        message: 'backend/package-lock.json의 lodash 4.17.15에 알려진 취약점이 2개 있어요(가장 높은 심각도 HIGH: CVE-A, CVE-B). 고친 버전: 4.17.19, 4.17.21.',
        service: 'be',
      },
    ])
  })

  it('raises the package to its worst severity and shortens long id lists', () => {
    const ids = ['CVE-1', 'CVE-2', 'CVE-3', 'CVE-4']
    const findings: Finding[] = ids.map((id, i) => ({ kind: 'vuln', target: 'p.json', pkg: 'x', version: '1', id, severity: i === 2 ? 'CRITICAL' : 'HIGH', fixed: null }))
    expect(toWarnings(findings, s)[0].message).toContain('취약점이 4개 있어요(가장 높은 심각도 CRITICAL: CVE-1, CVE-2, CVE-3 외 1개)')
  })

  it('shows at most MAX_WARNINGS lines and counts the rest in MORE_FINDINGS', () => {
    const findings: Finding[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'secret', file: `f${i}.js`, line: 1, rule: 'r' }))
    const out = toWarnings(findings, s)
    expect(out).toHaveLength(MAX_WARNINGS)
    expect(out.at(-2)?.message).toContain(`f${MAX_WARNINGS - 2}.js`)
    expect(out.at(-1)).toEqual({ code: 'MORE_FINDINGS', message: `보여 주지 않은 항목이 ${30 - (MAX_WARNINGS - 1)}개 더 있어요. 위 항목부터 고쳐 보세요.`, service: null })
  })

  it('shows exactly MAX_WARNINGS lines without a MORE_FINDINGS line, and nothing for a clean repo', () => {
    const findings: Finding[] = Array.from({ length: MAX_WARNINGS }, (_, i) => ({ kind: 'secret', file: `f${i}.js`, line: 1, rule: 'r' }))
    expect(toWarnings(findings, s).map((w) => w.code)).toEqual(Array(MAX_WARNINGS).fill('SECRET_FOUND'))
    expect(toWarnings([], s)).toEqual([])
  })
})

describe('readFindings', () => {
  it('reads back what was stored and refuses a row of another shape', () => {
    const stored: Finding[] = [
      { kind: 'secret', file: 'a', line: 1, rule: 'r' },
      { kind: 'env_file', file: '.env' },
      { kind: 'vuln', target: 't', pkg: 'p', version: '1', id: 'CVE-1', severity: 'HIGH', fixed: null },
    ]
    expect(readFindings(stored)).toEqual(stored)
    expect(readFindings({})).toBeUndefined()
    expect(readFindings([{ kind: 'secret', file: 'a', line: '1', rule: 'r' }])).toBeUndefined()
    expect(readFindings([{ kind: 'vuln', target: 't', pkg: 'p', version: '1', id: 'C', severity: 'LOW', fixed: null }])).toBeUndefined()
  })
})
