import { describe, expect, it } from 'vitest'
import { parseDeployInput } from './deploy-input.js'
import { deployInput, digest } from './fixtures.js'

type Json = Record<string, unknown>
const text = (change: (input: Json) => void = () => undefined) => {
  const input = deployInput() as unknown as Json
  change(input)
  return JSON.stringify(input)
}
const spec = (input: Json) => input.spec as Json
const services = (input: Json) => (input.deploy_condition as Json).services as Record<string, Json>

describe('parseDeployInput', () => {
  it('returns the input as it is', () => {
    expect(parseDeployInput(text())).toEqual(deployInput())
  })

  it.each([
    ['not an object', () => '[]', 'not an object with spec and deploy_condition'],
    ['no spec', () => text((i) => delete i.spec), 'not an object with spec and deploy_condition'],
    ['no deploy_condition', () => text((i) => delete i.deploy_condition), 'not an object with spec and deploy_condition'],
    ['a short commit', () => text((i) => (i.commitSha = 'a1b2c3d')), 'commitSha is not a 40-char SHA'],
    ['an uppercase commit', () => text((i) => (i.commitSha = 'A'.repeat(40))), 'commitSha is not a 40-char SHA'],
    ['a bad slug', () => text((i) => (spec(i).project = { slug: 'My App' })), 'spec.project.slug is invalid'],
    ['no project', () => text((i) => delete spec(i).project), 'spec.project.slug is invalid'],
    ['a 41-char slug', () => text((i) => (spec(i).project = { slug: 'a'.repeat(41) })), 'spec.project.slug is invalid'],
    ['a 31-char service name', () => text((i) => ((spec(i).services as Json[])[0].name = 'a'.repeat(31))), 'a service name is invalid'],
    ['no services', () => text((i) => (spec(i).services = [])), 'spec.services is empty'],
    ['services not filled (W3 sends null)', () => text((i) => ((i.deploy_condition as Json).services = null)), 'deploy_condition.services is not filled'],
    ['a bad service name', () => text((i) => ((spec(i).services as Json[])[0].name = '../x')), 'a service name is invalid'],
    ['a service without a condition', () => text((i) => delete services(i).be), 'deploy_condition.services.be has no build input hash'],
    ['a bad hash', () => text((i) => (services(i).fe.buildInputHash = 'abc')), 'deploy_condition.services.fe has no build input hash'],
    ['a reuse without an image', () => text((i) => (services(i).ai.image = null)), 'deploy_condition.services.ai is neither a run nor a reuse with an image'],
    ['a reuse with a tag', () => text((i) => (services(i).ai.image = 'ghcr.io/b/student-apps:t')), 'deploy_condition.services.ai is neither a run nor a reuse with an image'],
    ['an unknown build', () => text((i) => (services(i).fe.build = 'skip')), 'deploy_condition.services.fe is neither a run nor a reuse with an image'],
  ])('refuses %s', (_, make, message) => {
    expect(() => parseDeployInput(make())).toThrow(`deploy input: ${message}`)
  })

  it('accepts a 40-char slug and a 30-char service name', () => {
    const input = deployInput()
    input.spec.project.slug = 'a'.repeat(40)
    input.spec.services[2].name = 'a'.repeat(30)
    input.deploy_condition.services['a'.repeat(30)] = input.deploy_condition.services.ai
    expect(() => parseDeployInput(JSON.stringify(input))).not.toThrow()
  })

  it('accepts a run that already has an image (a retried build overwrites it)', () => {
    expect(() => parseDeployInput(text((i) => (services(i).fe.image = digest('d'))))).not.toThrow()
  })
})
