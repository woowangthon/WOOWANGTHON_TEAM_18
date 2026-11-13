import type { ReactNode } from 'react'
import { Badge } from '../components/ui/Badge.tsx'
import { Card } from '../components/ui/Card.tsx'
import { LogBlock } from '../components/ui/LogBlock.tsx'
import { Meter } from '../components/ui/Meter.tsx'
import { Sparkline } from '../components/ui/Sparkline.tsx'
import { Steps } from '../components/ui/Steps.tsx'
import { Table, Td, Th, THead } from '../components/ui/Table.tsx'
import {
  ADMIN_NODES,
  ADMIN_SERVICES,
  AGENT_CHANGE,
  AGENT_LOG,
  AGENT_STEPS,
  METRIC_SERVICES,
  SECURITY_WARNINGS,
  SLOTS,
  SWITCH_STEPS,
} from './sample.ts'

// 모든 예시 화면의 바깥틀. "예시 화면" 표시가 항상 붙고, 안의 것은 눌러 볼 수 없다(inert).
// 실제 화면의 컴포넌트에 예시 데이터를 넣은 것이라 누르면 아무 일도 일어나지 않기 때문이다.
export function Preview({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Badge>예시 화면</Badge>
        <span className="text-sm text-muted">{title}</span>
      </div>
      <div inert className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

export function AgentPreview() {
  return (
    <Preview title="AI 동료가 고치는 과정">
      <Card className="flex flex-col gap-4">
        <Steps aria-label="AI 동료가 고치는 단계 (예시)" steps={AGENT_STEPS} />
        <LogBlock aria-label="AI 동료가 본 로그 (예시)">{AGENT_LOG}</LogBlock>
      </Card>
      <Card className="flex flex-col gap-2">
        <p className="font-bold">바꾼 내용</p>
        <p className="text-sm">
          <span className="font-mono">{AGENT_CHANGE.field}</span>: <span className="font-mono">{AGENT_CHANGE.before}</span> →{' '}
          <span className="font-mono font-bold">{AGENT_CHANGE.after}</span>
        </p>
        <p className="text-sm text-muted">이유: {AGENT_CHANGE.reason}</p>
      </Card>
    </Preview>
  )
}

export function SecurityPreview() {
  return (
    <Preview title="배포 진행 화면의 보안 검사 결과">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="warn">경고 {SECURITY_WARNINGS.length}개</Badge>
          <span className="text-sm text-muted">배포는 이어지고, 알려 준 것만 고치면 돼요</span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {SECURITY_WARNINGS.map((w) => (
            <li key={w.code} className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <span className="font-mono text-xs text-muted">{w.code}</span>
              <span className="text-sm">{w.message}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <p className="text-sm text-muted">찾은 문제가 없으면 “보안 검사: 찾은 문제가 없어요”라고 알려 줘요.</p>
      </Card>
    </Preview>
  )
}

function SlotCard({ slot, badge }: { slot: typeof SLOTS.live; badge: ReactNode }) {
  return (
    <Card className="flex flex-1 flex-col gap-2">
      <p className="font-bold">{slot.name}</p>
      <p className="text-sm text-muted">{slot.version}</p>
      <div>{badge}</div>
    </Card>
  )
}

export function SlotsPreview() {
  return (
    <Preview title="새 버전으로 바꾸는 과정">
      <div className="flex gap-3">
        <SlotCard slot={SLOTS.live} badge={<Badge variant="ok">{SLOTS.live.state}</Badge>} />
        <SlotCard slot={SLOTS.next} badge={<Badge variant="info">{SLOTS.next.state}</Badge>} />
      </div>
      <Card className="flex flex-col gap-3">
        <Steps aria-label="주소를 바꾸는 단계 (예시)" steps={SWITCH_STEPS} />
      </Card>
      <Card className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="err">실패</Badge>
          <span className="text-sm font-bold">준비 확인을 통과하지 못하면</span>
        </div>
        <p className="text-sm text-muted">공개 주소는 슬롯 A에 그대로 있어요. 서비스가 끊기지 않아요.</p>
      </Card>
    </Preview>
  )
}

export function MetricsPreview() {
  return (
    <Preview title="배포 화면의 서비스 상태 카드">
      <Card className="flex flex-col gap-4">
        {METRIC_SERVICES.map((s) => (
          <div key={s.name} className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{s.name}</span>
              <Badge variant="ok">{s.state}</Badge>
              <span className="text-sm text-muted">다시 시작된 횟수 {s.restarts}번 (지금 실행 이후)</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted">CPU {s.cpu}</span>
                <Sparkline values={s.cpuSeries} label={`${s.name} CPU 사용량(예시)`} emptyText="아직 수집하지 못했어요" format={(v) => `${v}m`} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted">메모리 {s.memory}</span>
                <Sparkline values={s.memorySeries} label={`${s.name} 메모리 사용량(예시)`} emptyText="아직 수집하지 못했어요" format={(v) => `${v}MiB`} />
              </div>
            </div>
          </div>
        ))}
      </Card>
    </Preview>
  )
}

export function AdminPreview() {
  return (
    <Preview title="운영자 화면">
      <div className="grid gap-3 sm:grid-cols-2">
        {ADMIN_NODES.map((n) => (
          <Card key={n.name} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold">{n.name}</span>
              <Badge variant="info">{n.role}</Badge>
              <Badge variant="ok">Ready</Badge>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">CPU (할당 가능량 대비)</span>
              <Meter aria-label={`${n.name} CPU 사용량 (예시)`} value={n.cpu} />
              <span className="text-xs text-muted">메모리 (할당 가능량 대비)</span>
              <Meter aria-label={`${n.name} 메모리 사용량 (예시)`} value={n.memory} />
            </div>
          </Card>
        ))}
      </div>
      <Table aria-label="서비스 목록 (예시)">
        <THead>
          <tr>
            <Th>프로젝트</Th>
            <Th>서비스</Th>
            <Th>상태</Th>
            <Th>조치</Th>
          </tr>
        </THead>
        <tbody>
          {ADMIN_SERVICES.map((s) => (
            <tr key={`${s.project}-${s.service}`}>
              <Td>{s.project}</Td>
              <Td>{s.service}</Td>
              <Td>{s.state}</Td>
              <Td>
                <span className="inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-sm font-bold">강제 중지</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Preview>
  )
}
