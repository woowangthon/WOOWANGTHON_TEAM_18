import { isRecord } from '../common/is-record.js'
import type { Spec } from '../deploys/deploy-input.js'

// 보안 검사(UC-10, #45)의 찾은 것과, 학생에게 보이는 경고(api.md "진행 상태 읽기"의 `warnings`).
// 도구의 결과에서 위치만 남긴다: 비밀값 자체(gitleaks의 Secret · Match)는 저장하지도 보여 주지도 않는다.

export type Finding =
  | { kind: 'secret'; file: string; line: number; rule: string }
  | { kind: 'env_file'; file: string }
  | { kind: 'vuln'; target: string; pkg: string; version: string; id: string; severity: Severity; fixed: string | null }

export type Severity = 'CRITICAL' | 'HIGH'

export interface DeployWarning {
  code: string
  message: string
  service: string | null
}

/** 한 응답에 싣는 경고 수. 넘는 것은 MORE_FINDINGS 한 줄로 센다. */
export const MAX_WARNINGS = 20
/** 한 commit에 저장하는 찾은 것 수(행 크기 상한). */
export const MAX_FINDINGS = 500
const MAX_TEXT = 200

// 학생 레포의 경로 · 이름이라 길이를 자른다. 화면(React)은 문자열로만 보여 준다.
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s)
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * gitleaks(`dir`, JSON 보고서)의 찾은 것. `File`은 검사한 폴더(`root`) 안의 경로로 바꾼다.
 * 모양이 틀린 보고서는 오류다: 도구가 바뀌었는데 "찾은 것 없음"으로 넘어가지 않게 한다.
 */
export function parseGitleaks(report: unknown, root: string): Finding[] {
  if (!Array.isArray(report)) throw new Error('gitleaks report is not an array')
  const prefix = root.endsWith('/') ? root : `${root}/`
  return report.map((f): Finding => {
    if (!isRecord(f)) throw new Error('gitleaks finding is not an object')
    const file = str(f.File)
    const rule = str(f.RuleID)
    const line = f.StartLine
    if (!file || !rule || typeof line !== 'number') throw new Error('gitleaks finding has no File, RuleID or StartLine')
    return { kind: 'secret', file: clip(file.startsWith(prefix) ? file.slice(prefix.length) : file), line, rule: clip(rule) }
  })
}

/** Trivy(`fs`, JSON 보고서)의 취약점. `--severity HIGH,CRITICAL`로 돌리므로 그 밖의 심각도는 버린다. */
export function parseTrivy(report: unknown): Finding[] {
  if (!isRecord(report) || report.SchemaVersion !== 2) throw new Error('trivy report is not schema version 2')
  const results = report.Results ?? []
  if (!Array.isArray(results)) throw new Error('trivy Results is not an array')
  const out: Finding[] = []
  for (const r of results) {
    if (!isRecord(r)) throw new Error('trivy result is not an object')
    const target = str(r.Target)
    const vulns = r.Vulnerabilities ?? []
    if (!target || !Array.isArray(vulns)) throw new Error('trivy result has no Target or Vulnerabilities')
    for (const v of vulns) {
      if (!isRecord(v)) throw new Error('trivy vulnerability is not an object')
      const pkg = str(v.PkgName)
      const version = str(v.InstalledVersion)
      const id = str(v.VulnerabilityID)
      const severity = v.Severity
      if (!pkg || !version || !id) throw new Error('trivy vulnerability has no PkgName, InstalledVersion or VulnerabilityID')
      if (severity !== 'CRITICAL' && severity !== 'HIGH') continue
      const fixed = str(v.FixedVersion)
      out.push({ kind: 'vuln', target: clip(target), pkg: clip(pkg), version: clip(version), id: clip(id), severity, fixed: fixed ? clip(fixed) : null })
    }
  }
  return out
}

// `.env`와 `.env.production` 같은 것. 예시 파일(`.env.example` 등)은 값이 없다고 보고 뺀다.
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/
const ENV_EXAMPLE = /\.(example|sample|template|dist)$/

/** 레포의 파일 경로(검사한 폴더 기준) 중 커밋된 `.env` 파일. 이름만 본다(내용은 gitleaks가 본다). */
export function envFiles(paths: string[]): Finding[] {
  return paths.filter((p) => ENV_FILE.test(p) && !ENV_EXAMPLE.test(p)).map((p) => ({ kind: 'env_file', file: clip(p) }))
}

/** 파일 경로가 속한 서비스: 서비스 폴더(`dir`) 중 가장 긴 접두어. 없거나 같은 폴더의 서비스가 여럿이면 null. */
export function serviceOf(path: string, spec: Spec): string | null {
  let best: { name: string; depth: number } | null = null
  let tie = false
  // 저장된 spec은 검사를 거친 것이지만, 서비스 목록이 없으면 서비스를 모르는 것으로 둔다.
  for (const s of Array.isArray(spec.services) ? spec.services : []) {
    if (typeof s.dir !== 'string') continue
    const dir = s.dir === '.' || s.dir === '' ? '' : `${s.dir.replace(/\/+$/, '')}/`
    if (!path.startsWith(dir)) continue
    const depth = dir.length
    if (best === null || depth > best.depth) {
      best = { name: s.name, depth }
      tie = false
    } else if (depth === best.depth) tie = true
  }
  return best && !tie ? best.name : null
}

const RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1 }
const firstN = (xs: string[], n: number) => (xs.length > n ? `${xs.slice(0, n).join(', ')} 외 ${xs.length - n}개` : xs.join(', '))

/**
 * 찾은 것을 경고로: 비밀값 → `.env` 파일 → 취약한 패키지(CRITICAL이 있는 것 먼저) 순서이고, 취약점은 패키지 · 버전마다 한 줄이다.
 * MAX_WARNINGS를 넘으면 앞에서 자르고 남은 수를 MORE_FINDINGS 한 줄로 알린다.
 */
export function toWarnings(findings: Finding[], spec: Spec): DeployWarning[] {
  const secrets: DeployWarning[] = []
  const envs: DeployWarning[] = []
  const packages = new Map<string, { target: string; pkg: string; version: string; ids: Set<string>; fixed: Set<string>; top: Severity }>()
  for (const f of findings) {
    if (f.kind === 'secret') {
      secrets.push({
        code: 'SECRET_FOUND',
        message: `${f.file} ${f.line}번째 줄에 비밀값으로 보이는 값이 있어요(규칙 ${f.rule}). 레포에서 지우고, 진짜 키라면 새로 발급받으세요.`,
        service: serviceOf(f.file, spec),
      })
    } else if (f.kind === 'env_file') {
      envs.push({
        code: 'ENV_FILE_COMMITTED',
        message: `${f.file} 파일이 레포에 올라가 있어요. 비밀값이 들어 있다면 레포에서 지우고 비밀값 입력 단계에서 넣으세요.`,
        service: serviceOf(f.file, spec),
      })
    } else {
      const key = `${f.target}\0${f.pkg}\0${f.version}`
      const p = packages.get(key) ?? { target: f.target, pkg: f.pkg, version: f.version, ids: new Set<string>(), fixed: new Set<string>(), top: f.severity }
      p.ids.add(f.id)
      if (f.fixed) p.fixed.add(f.fixed)
      if (RANK[f.severity] < RANK[p.top]) p.top = f.severity
      packages.set(key, p)
    }
  }
  const vulns = [...packages.values()]
    .sort((a, b) => RANK[a.top] - RANK[b.top])
    .map((p): DeployWarning => {
      const ids = [...p.ids]
      const fix = p.fixed.size > 0 ? `고친 버전: ${firstN([...p.fixed], 3)}.` : '아직 고친 버전이 없어요.'
      return {
        code: 'VULNERABLE_DEPENDENCY',
        message: `${p.target}의 ${p.pkg} ${p.version}에 알려진 취약점이 ${ids.length}개 있어요(가장 높은 심각도 ${p.top}: ${firstN(ids, 3)}). ${fix}`,
        service: serviceOf(p.target, spec),
      }
    })
  const out = [...secrets, ...envs, ...vulns]
  if (out.length <= MAX_WARNINGS) return out
  const shown = out.slice(0, MAX_WARNINGS - 1)
  shown.push({ code: 'MORE_FINDINGS', message: `보여 주지 않은 항목이 ${out.length - shown.length}개 더 있어요. 위 항목부터 고쳐 보세요.`, service: null })
  return shown
}

/** 저장한 찾은 것을 다시 읽는다(우리가 쓴 값이지만 DB 행이라 모양을 확인한다). 틀린 항목이 있으면 undefined. */
export function readFindings(stored: unknown): Finding[] | undefined {
  if (!Array.isArray(stored)) return undefined
  const ok = stored.every(
    (f) =>
      isRecord(f) &&
      ((f.kind === 'secret' && typeof f.file === 'string' && typeof f.line === 'number' && typeof f.rule === 'string') ||
        (f.kind === 'env_file' && typeof f.file === 'string') ||
        (f.kind === 'vuln' &&
          ['target', 'pkg', 'version', 'id'].every((k) => typeof f[k] === 'string') &&
          (f.severity === 'CRITICAL' || f.severity === 'HIGH') &&
          (f.fixed === null || typeof f.fixed === 'string'))),
  )
  return ok ? (stored as Finding[]) : undefined
}
