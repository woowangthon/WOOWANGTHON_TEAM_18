import { describe, expect, it } from 'vitest'
import { validSpec } from '../../test/spec-fixture.js'
import type { Spec } from '../deploys/deploy-input.js'
import { applySpecPatch, livePathProblem } from './spec-patch.js'

const input = () => ({ commitSha: 'a'.repeat(40), deploy_condition: { services: {} }, spec: validSpec() })
const services = (i: Record<string, unknown>) => (i.spec as Spec).services

describe('applySpecPatch', () => {
  it('applies runtime replace · add · remove to a copy and leaves the run input alone', () => {
    const before = input()
    const out = applySpecPatch(
      before,
      [
        { op: 'replace', path: '/spec/services/1/runtime/port', value: 8000 },
        { op: 'add', path: '/spec/services/1/runtime/env/LOG_LEVEL', value: 'debug' },
        { op: 'remove', path: '/spec/services/1/runtime/env/NODE_ENV' },
      ],
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(services(out.input)[1].runtime.port).toBe(8000)
    expect(services(out.input)[1].runtime.env).toEqual({ LOG_LEVEL: 'debug' })
    expect(services(before)[1].runtime.port).toBe(3000)
    expect(applySpecPatch(before, [])).toEqual({ ok: true, input: before })
  })

  it('applies a build path too (its image comes from run_build)', () => {
    const out = applySpecPatch(input(), [{ op: 'replace', path: '/spec/services/0/build/outputDir', value: 'build' }])
    expect(out.ok).toBe(true)
    if (out.ok) expect(services(out.input)[0].build.outputDir).toBe('build')
  })

  it.each([
    ['a service name', '/spec/services/0/name', 'name and slug'],
    ['the slug', '/spec/project/slug', 'name and slug'],
    ['anything outside build and runtime', '/spec/services/0/role', 'only /spec/services/{i}/build'],
    ['the commit', '/commitSha', 'only /spec/services/{i}/build'],
  ])('refuses %s as PATCH_FORBIDDEN', (_label, path, why) => {
    const out = applySpecPatch(input(), [{ op: 'replace', path, value: 'x' }])
    expect(out).toMatchObject({ ok: false, code: 'PATCH_FORBIDDEN' })
    if (!out.ok) expect(out.message).toContain(why)
  })

  it.each([
    ['not an array', { op: 'replace' }],
    ['an unknown op', [{ op: 'move', path: '/spec/services/0/runtime/port', from: '/x' }]],
    ['a missing value', [{ op: 'replace', path: '/spec/services/0/runtime/port' }]],
    ['a missing path', [{ op: 'replace', path: '/spec/services/5/runtime/port', value: 1 }]],
    ['a missing key to replace', [{ op: 'replace', path: '/spec/services/0/runtime/nope', value: 1 }]],
    ['a prototype key', [{ op: 'add', path: '/spec/services/0/runtime/__proto__/polluted', value: 1 }]],
    ['too many operations', Array.from({ length: 21 }, () => ({ op: 'replace', path: '/spec/services/0/runtime/port', value: 1 }))],
  ])('refuses %s as INVALID_ARGUMENT', (_label, patch) => {
    expect(applySpecPatch(input(), patch)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('refuses a patch that breaks the deploy input rules as INVALID_SPEC with the fields', () => {
    const out = applySpecPatch(input(), [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 70000 }])
    expect(out).toMatchObject({ ok: false, code: 'INVALID_SPEC', fields: [{ path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' }] })
  })

  describe('live path protection (the stripPrefix Middleware is shared by both slots)', () => {
    const specWith = (stripPrefix: boolean, ingressPath = '/api') => {
      const spec = validSpec() as unknown as Spec
      Object.assign(spec.services[1].runtime, { stripPrefix, ingressPath })
      return spec
    }

    it('refuses a trial input whose ingressPath differs from live for a service that strips on both', () => {
      expect(livePathProblem(specWith(true, '/v2'), specWith(true))).toMatch(/differs from the live slot/)
    })

    it.each([
      ['the same path', specWith(true), specWith(true)],
      ['false → true (demo V2)', specWith(true), specWith(false)],
      ['true → false with a new path', specWith(false, '/v2'), specWith(true)],
      ['a new path when live does not strip', specWith(true, '/v2'), specWith(false)],
    ])('accepts %s', (_label, spec, live) => {
      expect(livePathProblem(spec, live)).toBeNull()
    })
  })
})
