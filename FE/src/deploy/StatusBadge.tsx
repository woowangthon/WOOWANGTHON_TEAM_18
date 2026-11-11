import { Badge } from '../components/ui/Badge.tsx'
import { statusLabel, statusVariant } from './progress.ts'
import type { DeployStatus } from './progress.ts'

// 배포 상태를 글자와 색으로 함께 보인다(색만으로 뜻을 전하지 않는다).
function StatusBadge({ status }: { status: DeployStatus }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
}

export default StatusBadge
