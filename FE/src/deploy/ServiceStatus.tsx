import { Link } from 'react-router'
import { Alert } from '../components/ui/Alert.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Skeleton } from '../components/ui/Skeleton.tsx'
import { LineChart } from '../components/ui/LineChart.tsx'
import { ApiError } from '../lib/api.ts'
import { cpuText, memoryText } from '../lib/format.ts'
import { NOT_COLLECTED, slotsOf, slotTimeText, stateText, stateVariant, waitingText } from './metrics.ts'
import type { Metrics, MetricsService, Series } from './metrics.ts'
import { useMetrics } from './useMetrics.ts'

function Usage({ service }: { service: MetricsService }) {
  const { usage } = service
  return (
    <p className="text-sm">
      {usage ? (
        <>
          지금 CPU <span className="font-mono">{cpuText(usage.cpuMillicores)}</span> · 메모리 <span className="font-mono">{memoryText(usage.memoryBytes)}</span>
        </>
      ) : (
        <span className="text-muted">지금 사용량: {NOT_COLLECTED}</span>
      )}
    </p>
  )
}

function ServiceRow({ service, series }: { service: MetricsService; series: Series | null }) {
  const found = series?.services.find((s) => s.name === service.name)
  // 모든 서비스의 그래프가 서버가 준 같은 끝 시각(series.endT)의 눈금을 쓴다. 점이 없는 서비스는 칸이 없다([]).
  const slots = (key: 'cpuMillicores' | 'memoryBytes') =>
    series ? slotsOf(found?.[key] ?? [], series.endT, series.windowSeconds, series.stepSeconds) : []
  // 칸의 시각(이 브라우저의 시간대). 가로축 눈금과 말풍선이 쓴다.
  const xAt = (i: number) => (series ? slotTimeText(series, i) : '')
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-base">{service.name}</h3>
        <Badge variant={stateVariant(service.state)}>{stateText(service.state)}</Badge>
        {service.state === 'starting' && <span className="text-sm text-muted">{waitingText(service.waiting)}</span>}
      </div>
      <p className="text-sm">
        다시 시작된 횟수 <span className="font-mono">{service.restarts}</span>번 <span className="text-muted">(지금 실행 이후)</span>
      </p>
      <Usage service={service} />
      {series?.status === 'collected' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <LineChart values={slots('cpuMillicores')} label={`${service.name} CPU 사용량(최근 1시간)`} format={cpuText} emptyText={NOT_COLLECTED} xAt={xAt} />
          <LineChart values={slots('memoryBytes')} label={`${service.name} 메모리 사용량(최근 1시간)`} format={memoryText} emptyText={NOT_COLLECTED} xAt={xAt} />
        </div>
      )}
    </div>
  )
}

function Body({ metrics }: { metrics: Metrics }) {
  if (metrics.state === 'not_live') {
    return metrics.reason === 'superseded' ? (
      <p className="text-sm">
        더 새 배포가 공개 중이에요. 지금 상태는 그 배포에서 볼 수 있어요.{' '}
        <Link to="/deploys" className="text-accent-text underline">
          내 배포 목록으로 가기
        </Link>
      </p>
    ) : (
      <p className="text-sm text-muted">이 배포는 아직 공개 중이 아니에요.</p>
    )
  }
  return (
    <>
      {metrics.series?.status === 'not_collected' && <p className="text-sm text-muted">최근 1시간 그래프: {NOT_COLLECTED}</p>}
      {metrics.services.length === 0 && <p className="text-sm text-muted">실행 중인 서비스가 없어요.</p>}
      <div className="flex flex-col gap-4">
        {metrics.services.map((service) => (
          <ServiceRow key={service.deployment} service={service} series={metrics.series} />
        ))}
      </div>
    </>
  )
}

// 성공한 배포의 서비스 상태(UC-15). 보는 동안 15초마다 다시 읽는다. 읽기 실패는 마지막으로 읽은 값을 지우지 않고 안내만 더한다.
function ServiceStatus({ deployId }: { deployId: string }) {
  const query = useMetrics(deployId)

  // 배포가 없다는 답은 위의 진행 화면이 이미 알린다. 여기서는 카드를 그리지 않는다.
  if (query.error instanceof ApiError && query.error.status === 404) return null

  return (
    <Card role="region" aria-label="서비스 상태" className="flex flex-col gap-4 p-6">
      <h2 className="text-lg">서비스 상태</h2>
      {query.isError && (
        <Alert variant="warn" title="지금 상태를 읽지 못했어요">
          잠시 뒤에 다시 읽어요.
        </Alert>
      )}
      {query.data === undefined && !query.isError && (
        <div className="flex flex-col gap-3" role="status" aria-label="서비스 상태를 불러오는 중">
          <Skeleton className="w-1/3" />
          <Skeleton block />
        </div>
      )}
      {query.data !== undefined && <Body metrics={query.data} />}
    </Card>
  )
}

export default ServiceStatus
