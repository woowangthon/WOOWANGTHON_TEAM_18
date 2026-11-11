import { describe, expect, it } from 'vitest'
import { validSpec } from '../../test/spec-fixture.js'
import type { Spec } from '../deploys/deploy-input.js'
import { applySpecPatch } from './spec-patch.js'

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
      null,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(services(out.input)[1].runtime.port).toBe(8000)
    expect(services(out.input)[1].runtime.env).toEqual({ LOG_LEVEL: 'debug' })
    expect(services(before)[1].runtime.port).toBe(3000)
    expect(applySpecPatch(before, [], null)).toEqual({ ok: true, input: before })
  })

  it.each([
    ['a build path (run_build is not open)', '/spec/services/0/build/outputDir', 'build'],
    ['a service name', '/spec/services/0/name', 'name and slug'],
    ['the slug', '/spec/project/slug', 'name and slug'],
    ['anything outside runtime', '/spec/services/0/role', 'only /spec/services/{i}/runtime'],
    ['the commit', '/commitSha', 'only /spec/services/{i}/runtime'],
  ])('refuses %s as PATCH_FORBIDDEN', (_label, path, why) => {
    const out = applySpecPatch(input(), [{ op: 'replace', path, value: 'x' }], null)
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
    expect(applySpecPatch(input(), patch, null)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('refuses a patch that breaks the deploy input rules as INVALID_SPEC with the fields', () => {
    const out = applySpecPatch(input(), [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 70000 }], null)
    expect(out).toMatchObject({ ok: false, code: 'INVALID_SPEC', fields: [{ path: 'services[1].runtime.port', code: 'OUT_OF_RANGE' }] })
  })

  describe('live path protection (the stripPrefix Middleware is shared by both slots)', () => {
    const liveWith = (stripPrefix: boolean, ingressPath = '/api') => {
      const spec = validSpec() as unknown as Spec
      Object.assign(spec.services[1].runtime, { stripPrefix, ingressPath })
      return spec
    }
    const withBe = (stripPrefix: boolean) => {
      const i = input()
      Object.assign(services(i)[1].runtime, { stripPrefix })
      return i
    }

    it('refuses changing ingressPath of a service that is stripPrefix on live and stays so', () => {
      const out = applySpecPatch(withBe(true), [{ op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' }], liveWith(true))
      expect(out).toMatchObject({ ok: false, code: 'PATCH_FORBIDDEN' })
      if (!out.ok) expect(out.message).toContain('Middleware')
    })

    it.each([
      ['false → true (demo V2)', withBe(false), [{ op: 'replace', path: '/spec/services/1/runtime/stripPrefix', value: true }], liveWith(false)],
      ['true → false with a new path', withBe(true), [
        { op: 'replace', path: '/spec/services/1/runtime/stripPrefix', value: false },
        { op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' },
      ], liveWith(true)],
      ['a new path when live does not strip', withBe(true), [{ op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' }], liveWith(false)],
      ['the first deploy (no live slot)', withBe(true), [{ op: 'replace', path: '/spec/services/1/runtime/ingressPath', value: '/v2' }], null],
      ['another runtime field of a stripPrefix service', withBe(true), [{ op: 'replace', path: '/spec/services/1/runtime/port', value: 8000 }], liveWith(true)],
    ])('accepts %s', (_label, base, patch, live) => {
      expect(applySpecPatch(base, patch, live)).toMatchObject({ ok: true })
    })
  })
})
