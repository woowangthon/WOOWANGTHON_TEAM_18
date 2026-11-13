import { Badge } from '../components/ui/Badge.tsx'
import { Meter } from '../components/ui/Meter.tsx'
import { bytesText, cpuText } from '../lib/format.ts'
import AdminSection from './AdminSection.tsx'
import Row from './Row.tsx'
import type { AdminRead } from './useAdminRead.ts'
import type { AdminNode, NodesResponse } from './types.ts'

const USAGE_NOT_COLLECTED = '수집 전'
// 운영자만 보는 지표 화면. 학생 화면에는 넣지 않는다. 새 탭으로 열고 이 화면에 끼워 넣지(iframe) 않는다.
const GRAFANA_URL = 'https://grafana.stairnoworks.com'

// 사용량 막대. 할당 가능량을 읽지 못했거나 0이면 비율을 말할 수 없어서 그리지 않는다(값을 지어내지 않는다).
function UsageMeter({ label, used, allocatable }: { label: string; used: number; allocatable: number | null }) {
  if (allocatable === null || allocatable <= 0) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label} (할당 가능량 대비)</span>
      <Meter aria-label={`${label} 사용량`} value={used} max={allocatable} />
    </div>
  )
}

function NodeCard({ node, collected }: { node: AdminNode; collected: boolean }) {
  const { usage } = node
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold">{node.name}</span>
        <Badge variant="info">{node.role === 'leader' ? '리더' : '워커'}</Badge>
        <Badge variant={node.ready ? 'ok' : 'err'}>{node.ready ? 'Ready' : 'NotReady'}</Badge>
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label="CPU">
          {cpuText(node.cpu.capacityMillicores)} (할당 가능 {cpuText(node.cpu.allocatableMillicores)})
        </Row>
        <Row label="메모리">
          {bytesText(node.memory.capacityBytes)} (할당 가능 {bytesText(node.memory.allocatableBytes)})
        </Row>
        <Row label="디스크">
          {bytesText(node.disk.capacityBytes)} (할당 가능 {bytesText(node.disk.allocatableBytes)})
        </Row>
        <Row label="사용량">
          {collected && usage ? `CPU ${cpuText(usage.cpuMillicores)} · 메모리 ${bytesText(usage.memoryBytes)}` : USAGE_NOT_COLLECTED}
        </Row>
      </dl>
      {collected && usage && (
        <div className="flex flex-col gap-2">
          <UsageMeter label="CPU" used={usage.cpuMillicores} allocatable={node.cpu.allocatableMillicores} />
          <UsageMeter label="메모리" used={usage.memoryBytes} allocatable={node.memory.allocatableBytes} />
        </div>
      )}
      <a href={GRAFANA_URL} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-accent-text underline">
        Grafana에서 자세히 보기
      </a>
    </li>
  )
}

// 노드 현황(FR-083). 사용량은 서버가 아직 수집하지 않아 "수집 전"으로 보이고, 계산하지 않는다.
function NodesSection({ read }: { read: AdminRead<NodesResponse> }) {
  return (
    <AdminSection
      id="nodes-heading"
      title="노드 현황"
      read={read}
      failed="노드 현황을 읽지 못했어요"
      loading="노드 현황을 불러오는 중…"
      empty="보이는 노드가 없어요."
      isEmpty={(data) => data.nodes.length === 0}
    >
      {(data) => (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.nodes.map((node) => (
            <NodeCard key={node.name} node={node} collected={data.usageStatus === 'collected'} />
          ))}
        </ul>
      )}
    </AdminSection>
  )
}

export default NodesSection
