import { isRecord } from '../common/is-record.js'
import { type Issue, type Spec, validateSpec } from '../deploys/deploy-input.js'

// 시험용 수정안 `specPatch`(JSON Patch, RFC 6902)의 검사와 적용(docs/design/AIagent.md §6, api.md "파이프라인 ↔ 플랫폼 서버" 4번).
// 그 시험의 입력에만 적용하고 DB의 spec은 바꾸지 않는다.
// `build` · `runtime` 경로를 받는다. 빌드 경로를 고치면 그 서비스의 이미지는 run_build로 만든다(B3, 게이트웨이가 시험 입력을 만들 때 본다).
// 이름(`name` · `slug`)은 슬롯 · Secret 이름이 함께 바뀌어 대상 슬롯에서 시험할 수 없어 받지 않는다.

export type PatchProblem = { code: 'INVALID_ARGUMENT' | 'PATCH_FORBIDDEN' | 'INVALID_SPEC'; message: string; fields?: Issue[] }

type Op = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }

const MAX_OPS = 20
const RUNTIME = /^\/spec\/services\/(\d+)\/runtime(\/.*)?$/
const BUILD = /^\/spec\/services\/(\d+)\/build(\/.*)?$/
const NAMES = /^\/spec\/(services\/\d+\/name|project\/slug)$/

/** 모양 검사. 맞으면 연산 목록, 아니면 이유. */
function parseOps(value: unknown): Op[] | string {
  if (!Array.isArray(value)) return 'specPatch must be a JSON Patch array'
  if (value.length > MAX_OPS) return `specPatch has at most ${MAX_OPS} operations`
  const ops: Op[] = []
  for (const [i, raw] of value.entries()) {
    if (!isRecord(raw) || typeof raw.path !== 'string') return `specPatch[${i}] needs op and path`
    if (raw.op !== 'add' && raw.op !== 'remove' && raw.op !== 'replace') return `specPatch[${i}].op must be add, remove or replace`
    if (Object.keys(raw).some((k) => !['op', 'path', 'value'].includes(k))) return `specPatch[${i}] has an unknown key`
    if (raw.op !== 'remove' && !('value' in raw)) return `specPatch[${i}] needs value`
    ops.push({ op: raw.op, path: raw.path, value: raw.value })
  }
  return ops
}

/** 경로 규칙. 어긋나면 이유. */
function pathProblem(path: string): string | null {
  if (NAMES.test(path)) return `${path}: name and slug cannot be tried on the target slot (slot and Secret names follow them)`
  if (!RUNTIME.test(path) && !BUILD.test(path)) return `${path}: only /spec/services/{i}/build/... and /spec/services/{i}/runtime/... can be patched`
  return null
}

const unescape = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~')

/** 한 연산을 적용한다. 실패하면 이유. */
function applyOp(doc: Record<string, unknown>, op: Op): string | null {
  const keys = op.path.split('/').slice(1).map(unescape)
  // 프로토타입을 건드리는 키는 받지 않는다(받은 경로로 객체를 따라가므로).
  if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return `${op.path}: no such path`
  const last = keys.pop()!
  let parent: unknown = doc
  for (const k of keys) {
    parent = Array.isArray(parent) ? parent[Number(k)] : isRecord(parent) && Object.hasOwn(parent, k) ? parent[k] : undefined
    if (parent === undefined) return `${op.path}: no such path`
  }
  if (Array.isArray(parent)) {
    const i = last === '-' ? parent.length : /^\d+$/.test(last) ? Number(last) : NaN
    if (!(i >= 0 && i <= parent.length) || (op.op !== 'add' && i >= parent.length)) return `${op.path}: no such index`
    if (op.op === 'add') parent.splice(i, 0, op.value)
    else if (op.op === 'remove') parent.splice(i, 1)
    else parent[i] = op.value
    return null
  }
  if (!isRecord(parent)) return `${op.path}: no such path`
  if (op.op !== 'add' && !Object.hasOwn(parent, last)) return `${op.path}: no such key`
  if (op.op === 'remove') Reflect.deleteProperty(parent, last)
  else parent[last] = op.value
  return null
}

type Service = Spec['services'][number]

/**
 * live 경로 보호: stripPrefix Middleware(`<서비스>-strip`)는 슬롯 라벨이 없어 두 슬롯이 같이 쓰고 Apply가 test Ingress와 함께 적용한다.
 * live에서 `stripPrefix: true`인 서비스를 시험 입력에서도 `stripPrefix: true`로 두면서 `ingressPath`가 live와 다르면, Switch 전에 live 경로의 떼기가 바뀐다.
 * 수정안이 그 경로를 건드리지 않아도(실행 기록의 입력이 이미 다른 경로여도) 막는다. false → true, true → false는 live에 닿지 않아 받는다.
 */
export function livePathProblem(spec: Spec, live: Spec): string | null {
  for (const svc of spec.services) {
    const onLive = live.services.find((s: Service) => s.name === svc.name)
    if (!onLive?.runtime.stripPrefix || !svc.runtime.stripPrefix) continue
    if (svc.runtime.ingressPath !== onLive.runtime.ingressPath) {
      return `${svc.name}: ingressPath ${svc.runtime.ingressPath} differs from the live slot's ${onLive.runtime.ingressPath}; with stripPrefix the shared Middleware would change the live path before the switch. Keep the live ingressPath or set stripPrefix false`
    }
  }
  return null
}

/** 실행 기록의 입력에 수정안을 적용한다. 검사 순서: 모양 → 경로 → 적용 → spec 검증. live 경로 보호는 livePathProblem(패치가 없어도 본다). */
export function applySpecPatch(input: Record<string, unknown>, patch: unknown): { ok: true; input: Record<string, unknown> } | ({ ok: false } & PatchProblem) {
  const ops = parseOps(patch)
  if (typeof ops === 'string') return { ok: false, code: 'INVALID_ARGUMENT', message: ops }
  for (const op of ops) {
    const why = pathProblem(op.path)
    if (why) return { ok: false, code: 'PATCH_FORBIDDEN', message: why }
  }
  const next = structuredClone(input)
  for (const op of ops) {
    const why = applyOp(next, op)
    if (why) return { ok: false, code: 'INVALID_ARGUMENT', message: why }
  }
  const checked = validateSpec(next.spec)
  if (!checked.ok) return { ok: false, code: 'INVALID_SPEC', message: 'the patched spec breaks the deploy input rules (see fields)', fields: checked.issues }
  return { ok: true, input: next }
}
