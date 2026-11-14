import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import ServiceMap from './ServiceMap.tsx'
import type { ServiceSpec } from './types.ts'

const svc = (name: string, role: string, links: string[], ingressPath: string | null, kind = 'server'): ServiceSpec => ({
  name,
  role,
  dir: name,
  build: { context: name, dockerfile: null, framework: null, nodeVersion: null, install: null, build: null, start: null, outputDir: null, buildEnv: {} },
  runtime: {
    kind,
    port: 3000,
    health: { type: 'http', path: '/', startupTimeoutSeconds: 10 },
    env: {},
    secretKeys: ['DATABASE_URL'],
    links: links.map((s) => ({ env: 'X', service: s })),
    ingressPath,
    stripPrefix: false,
    resources: null,
  },
})
const services = [svc('fe', 'fe', ['be'], '/', 'static'), svc('be', 'be', [], '/api')]

it('draws a box per service with its role, kind, public path and secrets, and a state from the overall status', () => {
  render(<ServiceMap services={services} status="running" failureService={null} metrics={undefined} />)
  const fe = within(screen.getByRole('group', { name: '서비스 fe' }))
  expect(fe.getByText('정적 웹 · 공개 / · 비밀값 1개')).toBeTruthy()
  expect(fe.getByText('배포 중')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: '서비스 be' })).getByText('서버 · 공개 /api · 비밀값 1개')).toBeTruthy()
})

it('shows the links as arrows and also says them in words for screen readers', () => {
  const { container } = render(<ServiceMap services={services} status="running" failureService={null} metrics={undefined} />)
  expect(container.querySelectorAll('svg path[marker-end]')).toHaveLength(1)
  expect(screen.getByText('fe가 be의 주소를 받아 써요')).toBeTruthy()
  expect(screen.getByText('화살표는 주소를 받아 쓰는 방향이에요.')).toBeTruthy()
})

it('draws no arrow note when there are no links, and no database box', () => {
  render(<ServiceMap services={[svc('web', 'fe', [], null)]} status="queued" failureService={null} metrics={undefined} />)
  expect(screen.queryByText('화살표는 주소를 받아 쓰는 방향이에요.')).toBeNull()
  expect(screen.getByText(/내부 전용/)).toBeTruthy()
  expect(screen.queryByText(/DB|데이터베이스/)).toBeNull()
})

it('marks the service a failure names', () => {
  render(<ServiceMap services={services} status="failed" failureService="be" metrics={undefined} />)
  expect(within(screen.getByRole('group', { name: '서비스 be' })).getByText('실패')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: '서비스 fe' })).getByText('배포 중단')).toBeTruthy()
})
