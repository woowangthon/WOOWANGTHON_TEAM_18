import { ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import { K8sClient } from './k8s.client.js'
import { SpaceService } from './space.service.js'

// 가짜 쿠버네티스 API. 받은 요청을 적어 두고, 경로마다 정한 답을 준다(없으면 201).
interface Seen {
  method: string
  path: string
  auth: string | undefined
  contentType: string | undefined
  body: unknown
}
type Answer = { status: number; body?: unknown } | 'hangup'

class FakeK8s {
  seen: Seen[] = []
  answers = new Map<string, Answer>()
  constructor(readonly server: http.Server | https.Server) {
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        this.seen.push({
          method: req.method ?? '',
          path: req.url ?? '',
          auth: req.headers.authorization,
          contentType: req.headers['content-type'],
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        })
        const answer = this.answers.get(req.url ?? '') ?? { status: 201 }
        if (answer === 'hangup') return void req.socket.destroy()
        res.writeHead(answer.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(answer.body ?? { kind: 'Status' }))
      })
    })
  }
  get paths() {
    return this.seen.map((s) => s.path)
  }
  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    const { port } = this.server.address() as AddressInfo
    return `${this.server instanceof https.Server ? 'https' : 'http'}://127.0.0.1:${port}`
  }
  close() {
    return new Promise<void>((r) => this.server.close(() => r()))
  }
}

const TOKEN = 'k8s-secret-token'
const configOf = (over: Partial<Record<'K8S_API_URL' | 'K8S_TOKEN' | 'K8S_CA', string | undefined>>) =>
  new ConfigService<Env, true>({ K8S_API_URL: undefined, K8S_TOKEN: TOKEN, K8S_CA: 'unused', ...over })
const serviceOf = (url: string | undefined, ca = 'unused') => new SpaceService(new K8sClient(configOf({ K8S_API_URL: url, K8S_CA: ca })))

const already = { status: 409, body: { kind: 'Status', reason: 'AlreadyExists', message: 'secret-looking detail' } }
const unavailable = { response: { code: 'CLUSTER_UNAVAILABLE' }, status: 503 }

describe('SpaceService.ensureSpace (plain http, loopback)', () => {
  let fake: FakeK8s
  let url: string
  let service: SpaceService
  beforeAll(async () => {
    fake = new FakeK8s(http.createServer())
    url = await fake.listen()
    service = serviceOf(url)
  })
  afterEach(() => {
    fake.seen = []
    fake.answers.clear()
  })
  afterAll(() => fake.close())

  const NS = 'proj-my-app'
  const five = [
    '/api/v1/namespaces',
    `/api/v1/namespaces/${NS}/limitranges`,
    `/api/v1/namespaces/${NS}/resourcequotas`,
    `/apis/networking.k8s.io/v1/namespaces/${NS}/networkpolicies`,
    `/apis/rbac.authorization.k8s.io/v1/namespaces/${NS}/rolebindings`,
  ]

  it('creates the five objects in order with the bearer token and a JSON body', async () => {
    await service.ensureSpace('my-app')
    expect(fake.paths).toEqual(five)
    expect(fake.seen.every((s) => s.method === 'POST' && s.auth === `Bearer ${TOKEN}` && s.contentType === 'application/json')).toBe(true)
    expect(fake.seen.map((s) => (s.body as { kind: string }).kind)).toEqual(['Namespace', 'LimitRange', 'ResourceQuota', 'NetworkPolicy', 'RoleBinding'])
    expect(fake.seen[0].body).toMatchObject({ metadata: { name: NS } })
  })

  it('counts 409 AlreadyExists as success, so calling again (or resuming) works', async () => {
    for (const p of five) fake.answers.set(p, already)
    await expect(service.ensureSpace('my-app')).resolves.toBeUndefined()
    expect(fake.paths).toEqual(five)
  })

  it('resumes after a half-made space: the first two exist, the rest are created', async () => {
    fake.answers.set(five[0], already)
    fake.answers.set(five[1], already)
    await service.ensureSpace('my-app')
    expect(fake.paths).toEqual(five)
  })

  it.each([
    ['401 (token refused)', { status: 401, body: { reason: 'Unauthorized' } }],
    ['403 (no permission)', { status: 403, body: { reason: 'Forbidden' } }],
    ['422 (admission rule)', { status: 422, body: { reason: 'Invalid', message: 'ValidatingAdmissionPolicy wanggane-space-quota denied' } }],
    ['500', { status: 500 }],
    ['409 that is not AlreadyExists', { status: 409, body: { reason: 'Conflict' } }],
    ['409 with no reason', { status: 409 }],
    ['an answer that is not JSON', { status: 502, body: 'bad gateway' }],
    ['a 200 that is not 201', { status: 200 }],
  ] as [string, Answer][])('answers 503 CLUSTER_UNAVAILABLE on %s and stops there', async (_, answer) => {
    fake.answers.set(five[1], answer)
    await expect(service.ensureSpace('my-app')).rejects.toMatchObject(unavailable)
    // 공간(1)은 만들었고, 실패한 둘째에서 멈춘다.
    expect(fake.paths).toEqual(five.slice(0, 2))
  })

  it('answers 503 when the connection is dropped', async () => {
    fake.answers.set(five[0], 'hangup')
    await expect(service.ensureSpace('my-app')).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('answers 503 when nothing listens at the address', async () => {
    const closed = new FakeK8s(http.createServer())
    const closedUrl = await closed.listen()
    await closed.close()
    await expect(serviceOf(closedUrl).ensureSpace('my-app')).rejects.toMatchObject(unavailable)
  })

  it('keeps the token and the answer text out of the error', async () => {
    fake.answers.set(five[0], { status: 403, body: { reason: 'Forbidden', message: 'secret-looking detail' } })
    const err = (await service.ensureSpace('my-app').catch((e: unknown) => e)) as ServiceUnavailableException
    expect(JSON.stringify(err.getResponse())).not.toMatch(/secret|token/i)
    expect(err.message).toBe('Could not reach the cluster')
  })

  it.each(['', 'My-App', '-a', 'a-', 'a/b', 'a b', '../x', 'a'.repeat(41)])('refuses the invalid slug %j before calling anything', async (slug) => {
    await expect(service.ensureSpace(slug)).rejects.toThrow(/Not a valid slug/)
    expect(fake.seen).toEqual([])
  })

  it('accepts the shortest and the longest slug', async () => {
    await service.ensureSpace('a')
    await service.ensureSpace('a'.repeat(40))
    expect(fake.paths).toHaveLength(10)
  })
})

describe('SpaceService.ensureSpace (not configured)', () => {
  it('answers 503 CLUSTER_UNAVAILABLE without any network call', async () => {
    const service = new SpaceService(new K8sClient(new ConfigService<Env, true>({ K8S_API_URL: undefined, K8S_TOKEN: undefined, K8S_CA: undefined })))
    await expect(service.ensureSpace('my-app')).rejects.toMatchObject(unavailable)
  })
})

// 리더 API처럼 자체 CA가 서명한 인증서로 답하는 https. 시험용 CA와 서버 인증서를 openssl로 만든다(키는 레포에 두지 않는다).
describe('SpaceService.ensureSpace (https with a private CA)', () => {
  let dir: string
  let caPem: string
  let otherCaPem: string
  let fake: FakeK8s
  let url: string

  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'k8s-test-'))
    for (const name of ['ca', 'other']) {
      openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=${name}`)
    }
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=leader')
    writeFileSync(join(dir, 'ext'), 'subjectAltName=IP:127.0.0.1')
    openssl('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', 'ext')
    caPem = readFileSync(join(dir, 'ca.pem'), 'utf8')
    otherCaPem = readFileSync(join(dir, 'other.pem'), 'utf8')
    fake = new FakeK8s(https.createServer({ key: readFileSync(join(dir, 'srv.key')), cert: readFileSync(join(dir, 'srv.pem')) }))
    url = await fake.listen()
  })
  afterEach(() => {
    fake.seen = []
  })
  afterAll(async () => {
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('trusts the configured CA', async () => {
    await serviceOf(url, caPem).ensureSpace('my-app')
    expect(fake.seen).toHaveLength(5)
  })

  it('refuses a server whose certificate the CA did not sign, before sending the token', async () => {
    await expect(serviceOf(url, otherCaPem).ensureSpace('my-app')).rejects.toMatchObject(unavailable)
    expect(fake.seen).toEqual([])
  })
})
