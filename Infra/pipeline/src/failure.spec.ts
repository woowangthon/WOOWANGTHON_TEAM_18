import { describe, expect, it } from 'vitest'
import { clusterFailure, describe as describeFailure, platformRefusal, stripManaged } from './failure.js'
import { KubeError } from './kube.js'

describe('platformRefusal', () => {
  it('sees a missing space', () => {
    expect(platformRefusal({ code: 404, message: 'namespaces "proj-x" not found', details: { kind: 'namespaces' } })).toEqual({ code: 'SPACE_MISSING', message: 'namespaces "proj-x" not found' })
    expect(platformRefusal({ code: 404, message: 'namespaces "proj-x" not found' })).toMatchObject({ code: 'SPACE_MISSING' })
  })
  it('sees a missing executor permission (RBAC)', () => {
    expect(platformRefusal({ code: 403, message: 'deployments.apps is forbidden: User "x" cannot patch resource "deployments"' })).toMatchObject({ code: 'EXECUTOR_FORBIDDEN' })
  })
  it('sees a platform admission policy', () => {
    expect(platformRefusal({ code: 422, message: "x is forbidden: ValidatingAdmissionPolicy 'wanggane-student-middlewares' with binding 'b' denied request" })).toMatchObject({ code: 'POLICY_REJECTED' })
  })
  it.each([
    ['a quota refusal (fixable with resources)', { code: 403, message: 'pods "x" is forbidden: exceeded quota: project-cap' }],
    ['an invalid field', { code: 422, message: 'Service "fe-a" is invalid: spec.ports[0].port: Invalid value: 70000' }],
    ['another 404 (an object, not the space)', { code: 404, message: 'deployments.apps "fe-a" not found', details: { kind: 'deployments' } }],
    ['no Status', null],
  ])('leaves %s to the student', (_, status) => {
    expect(platformRefusal(status)).toBeNull()
  })
})

describe('clusterFailure', () => {
  it('turns a KubeError into a platform failure', () => {
    expect(clusterFailure(new KubeError('K8S_UNREACHABLE', 'x'), 'be')).toEqual({ kind: 'platform', code: 'K8S_UNREACHABLE', service: 'be', message: 'x' })
  })
  it('rethrows anything else (a bug)', () => {
    expect(() => clusterFailure(new TypeError('bug'))).toThrow('bug')
  })
})

describe('stripManaged', () => {
  it('drops managedFields and the last-applied annotation only, without changing the input', () => {
    const obj = { kind: 'Pod', metadata: { name: 'p', managedFields: [1], annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}', a: 'b' } }, spec: {} }
    expect(stripManaged(obj)).toEqual({ kind: 'Pod', metadata: { name: 'p', annotations: { a: 'b' } }, spec: {} })
    expect(obj.metadata.managedFields).toEqual([1])
  })
  it('leaves an object without metadata as it is', () => {
    expect(stripManaged({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('describe', () => {
  it('summarizes a failure in one line', () => {
    expect(describeFailure({ kind: 'platform', code: 'X', service: null, message: 'm' })).toBe('platform X')
    expect(describeFailure({ kind: 'student', service: 'be', errorMessage: 'be-b: OOMKilled', raw: { pod: null, events: [], status: null } })).toBe('student (be): be-b: OOMKilled')
  })
})
