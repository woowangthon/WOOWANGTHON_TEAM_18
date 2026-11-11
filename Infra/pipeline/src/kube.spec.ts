import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyDoc, applyQuery, deleteObject, getJson, KubeError, type KubeCall, kubeFromEnv, KubeRefused, listItems, listPath, makeKube, makeServerDryRun, splitManifest } from './kube.js'

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.fake.token'

describe('kubeFromEnv', () => {
  const files: Record<string, string> = { '/t': `${TOKEN}\n`, '/ca': 'CA PEM' }
  const read = (p: string) => files[p]
  const env = (over: Record<string, string | undefined> = {}) => ({ KUBE_API_URL: 'https://100.64.0.1:6443', KUBE_TOKEN_FILE: '/t', KUBE_CA_FILE: '/ca', ...over })

  it('reads the API address, the token file (trimmed) and the CA file', () => {
    const conn = kubeFromEnv(env(), read)
    expect(conn.url.href).toBe('https://100.64.0.1:6443/')
    expect(conn.token).toBe(TOKEN)
    expect(conn.ca).toBe('CA PEM')
  })

  it.each(['http://127.0.0.1:8080', 'http://localhost:8080', 'http://[::1]:8080'])('allows plain http on loopback (%s) for local tests', (url) => {
    expect(() => kubeFromEnv(env({ KUBE_API_URL: url }), read)).not.toThrow()
  })

  it.each([undefined, '', 'http://100.64.0.1:6443', 'https://100.64.0.1:6443/api', 'https://100.64.0.1:6443/?x=1', 'ftp://h', 'not a url'])('refuses KUBE_API_URL %s', (url) => {
    expect(() => kubeFromEnv(env({ KUBE_API_URL: url }), read)).toThrow('KUBE_API_URL must look like https://<leader>:6443')
  })

  it.each(['KUBE_TOKEN_FILE', 'KUBE_CA_FILE'])('wants %s', (name) => {
    expect(() => kubeFromEnv(env({ [name]: undefined }), read)).toThrow('KUBE_TOKEN_FILE and KUBE_CA_FILE are required')
  })

  it.each(['', 'two tokens', 'a\nb'])('refuses a token file holding %j, without printing it', (token) => {
    expect(() => kubeFromEnv(env(), (p) => (p === '/t' ? token : 'CA'))).toThrow(/^KUBE_TOKEN_FILE must hold one token$/)
  })
})

describe('makeKube', () => {
  let server: http.Server
  let port: number
  let seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[]
  let answer: (res: http.ServerResponse) => void

  beforeEach(async () => {
    seen = []
    answer = (res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"kind":"ConfigMap"}')
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
        answer(res)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  const kube = (timeoutMs?: number) => makeKube({ url: new URL(`http://127.0.0.1:${port}`), token: TOKEN, ca: '' }, timeoutMs)

  it('sends the method, path, token and body, and returns the status and raw body', async () => {
    const result = await kube()('PATCH', '/api/v1/namespaces/proj-x/configmaps/fe-a?dryRun=All', 'kind: ConfigMap\n', 'application/apply-patch+yaml')
    expect(result).toEqual({ status: 200, body: '{"kind":"ConfigMap"}' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: 'PATCH', url: '/api/v1/namespaces/proj-x/configmaps/fe-a?dryRun=All', body: 'kind: ConfigMap\n' })
    expect(seen[0].headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/apply-patch+yaml', 'content-length': '16' })
  })

  it('sends no body headers on a GET', async () => {
    await kube()('GET', '/api/v1/namespaces/proj-x/pods')
    expect(seen[0].headers['content-type']).toBeUndefined()
    expect(seen[0].body).toBe('')
  })

  it('returns an error answer as it is (the caller reads the Status)', async () => {
    answer = (res) => res.writeHead(403).end('{"kind":"Status","reason":"Forbidden"}')
    expect(await kube()('GET', '/x')).toEqual({ status: 403, body: '{"kind":"Status","reason":"Forbidden"}' })
  })

  it('fails with K8S_TIMEOUT when the API does not answer in time', async () => {
    answer = () => undefined
    const err = await kube(50)('GET', '/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KubeError)
    expect(err).toMatchObject({ code: 'K8S_TIMEOUT', message: 'GET /x did not answer in 0.05s' })
  })

  it('fails with K8S_UNREACHABLE and only the error code, never the token or address', async () => {
    const closed = makeKube({ url: new URL('http://127.0.0.1:1'), token: TOKEN, ca: '' })
    const err = await closed('GET', '/x').catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'K8S_UNREACHABLE', message: 'GET /x failed: ECONNREFUSED' })
    expect(String((err as Error).message)).not.toContain(TOKEN)
  })
})

// 차트 스냅샷(진짜 helm 출력)을 그대로 나눈다.
const slotManifest = readFileSync(new URL('__snapshots__/chart-slot-b.yaml', import.meta.url), 'utf8')

describe('splitManifest', () => {
  it('splits the chart output into objects with their API paths', () => {
    expect(splitManifest(slotManifest, 'proj-my-app').map((d) => d.path)).toEqual([
      '/api/v1/namespaces/proj-my-app/configmaps/fe-b',
      '/api/v1/namespaces/proj-my-app/configmaps/be-b',
      '/api/v1/namespaces/proj-my-app/configmaps/ai-b',
      '/api/v1/namespaces/proj-my-app/services/fe-b',
      '/api/v1/namespaces/proj-my-app/services/be-b',
      '/api/v1/namespaces/proj-my-app/services/ai-b',
      '/apis/apps/v1/namespaces/proj-my-app/deployments/fe-b',
      '/apis/apps/v1/namespaces/proj-my-app/deployments/be-b',
      '/apis/apps/v1/namespaces/proj-my-app/deployments/ai-b',
      '/apis/networking.k8s.io/v1/namespaces/proj-my-app/ingresses/test-fe',
      '/apis/networking.k8s.io/v1/namespaces/proj-my-app/ingresses/test-be',
      '/apis/traefik.io/v1alpha1/namespaces/proj-my-app/middlewares/be-strip',
    ])
  })

  it('keeps each document whole, as YAML', () => {
    const [cm] = splitManifest(slotManifest, 'proj-my-app')
    expect(cm).toMatchObject({ kind: 'ConfigMap', name: 'fe-b' })
    expect(cm.text).toContain('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fe-b\n')
    expect(cm.text).not.toContain('---')
  })

  it.each([
    ['an unknown kind', 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: x\n'],
    ['a known kind of another API version', 'apiVersion: extensions/v1beta1\nkind: Ingress\nmetadata:\n  name: x\n'],
    ['an object without a name', 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  labels: {}\n'],
  ])('refuses %s', (_, doc) => {
    expect(() => splitManifest(`---\n${doc}`, 'proj-x')).toThrow('manifest has an object the pipeline cannot apply')
  })

  it('skips documents with no object (helm comments, empty parts)', () => {
    expect(splitManifest('---\n# Source: x\n---\n', 'proj-x')).toEqual([])
  })
})

describe('applyQuery', () => {
  it('is a forced server-side apply as student-app, dry-run when asked', () => {
    expect(applyQuery(true)).toBe('?fieldManager=student-app&force=true&dryRun=All')
    expect(applyQuery(false)).toBe('?fieldManager=student-app&force=true')
  })
})

describe('makeServerDryRun', () => {
  const two = '---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fe-a\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: fe-a\n'

  it('dry-runs every object as a server-side apply and passes when all are accepted', async () => {
    const call = vi.fn<KubeCall>(() => Promise.resolve({ status: 200, body: '{}' }))
    expect(await makeServerDryRun(call)(two, 'proj-x')).toEqual({ ok: true })
    expect(call.mock.calls).toEqual([
      ['PATCH', '/api/v1/namespaces/proj-x/configmaps/fe-a?fieldManager=student-app&force=true&dryRun=All', '\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fe-a\n', 'application/apply-patch+yaml'],
      ['PATCH', '/api/v1/namespaces/proj-x/services/fe-a?fieldManager=student-app&force=true&dryRun=All', '\napiVersion: v1\nkind: Service\nmetadata:\n  name: fe-a\n', 'application/apply-patch+yaml'],
    ])
  })

  it('stops at the first refusal and keeps the k3s Status as it is', async () => {
    const status = { kind: 'Status', apiVersion: 'v1', status: 'Failure', message: 'exceeded quota: project-cap', reason: 'Forbidden', code: 403 }
    const call = vi.fn<KubeCall>(() => Promise.resolve({ status: 403, body: JSON.stringify(status) }))
    expect(await makeServerDryRun(call)(two, 'proj-x')).toEqual({ ok: false, status, message: 'exceeded quota: project-cap' })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('accepts any 2xx (201 Created on a first apply)', async () => {
    const call = vi.fn<KubeCall>(() => Promise.resolve({ status: 201, body: '{}' }))
    expect(await makeServerDryRun(call)(two, 'proj-x')).toEqual({ ok: true })
  })

  it.each([
    ['a body that is not JSON', 'upstream connect error', null],
    ['a Status without a message', '{"kind":"Status","code":500}', { kind: 'Status', code: 500 }],
  ])('names the object when the refusal has %s', async (_, body, status) => {
    const call = vi.fn<KubeCall>(() => Promise.resolve({ status: 500, body }))
    expect(await makeServerDryRun(call)(two, 'proj-x')).toEqual({ ok: false, status, message: 'ConfigMap fe-a: API answered 500' })
  })

  it('lets a transport error through (the Render reports it as a cluster failure)', async () => {
    const call = vi.fn<KubeCall>(() => Promise.reject(new KubeError('K8S_TIMEOUT', 'slow')))
    await expect(makeServerDryRun(call)(two, 'proj-x')).rejects.toBeInstanceOf(KubeError)
  })
})

describe('getJson · listItems · deleteObject · applyDoc', () => {
  const answer = (status: number, body: unknown) => vi.fn<KubeCall>(() => Promise.resolve({ status, body: typeof body === 'string' ? body : JSON.stringify(body) }))

  it('reads JSON and the items of a list', async () => {
    expect(await getJson(answer(200, { a: 1 }), '/x')).toEqual({ a: 1 })
    expect(await listItems(answer(200, { items: [{ a: 1 }, 'junk'] }), '/x')).toEqual([{ a: 1 }])
    expect(await listItems(answer(200, {}), '/x')).toEqual([])
  })

  it('throws KubeRefused with the Status on a non-2xx answer, and on a body that is not an object', async () => {
    const err = await getJson(answer(403, { kind: 'Status', message: 'denied' }), '/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KubeRefused)
    expect(err).toMatchObject({ httpStatus: 403, status: { kind: 'Status', message: 'denied' }, message: 'denied' })
    await expect(getJson(answer(200, '[]'), '/x')).rejects.toMatchObject({ httpStatus: 200, status: null, message: 'API answered 200' })
  })

  it('deletes, taking an already missing object as deleted', async () => {
    await expect(deleteObject(answer(200, {}), '/x')).resolves.toBeUndefined()
    await expect(deleteObject(answer(404, {}), '/x')).resolves.toBeUndefined()
    await expect(deleteObject(answer(409, { message: 'conflict' }), '/x')).rejects.toMatchObject({ httpStatus: 409, message: 'conflict' })
  })

  it('applies a document as a forced server-side apply, not a dry run', async () => {
    const call = answer(200, {})
    const [doc] = splitManifest(slotManifest, 'proj-my-app')
    await applyDoc(call, doc)
    expect(call.mock.calls[0]).toEqual(['PATCH', `${doc.path}?fieldManager=student-app&force=true`, doc.text, 'application/apply-patch+yaml'])
    await expect(applyDoc(answer(422, { message: 'invalid' }), doc)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('builds a list path with an encoded label selector', () => {
    expect(listPath('/api/v1', 'pods', 'proj-x', 'app=be,slot=a')).toBe('/api/v1/namespaces/proj-x/pods?labelSelector=app%3Dbe%2Cslot%3Da')
    expect(listPath('/api/v1', 'events', 'proj-x')).toBe('/api/v1/namespaces/proj-x/events')
  })
})
