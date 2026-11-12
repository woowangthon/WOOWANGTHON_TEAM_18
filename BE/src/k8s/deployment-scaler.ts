import { Injectable } from '@nestjs/common'
import { space } from './cluster-reader.js'
import { K8sClient, MERGE_PATCH } from './k8s.client.js'

// Deployment 이름은 DNS 라벨이다. 요청 경로에 들어가는 값이다.
const DEPLOYMENT_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * 서버가 만든 공간 `proj-<slug>`의 Deployment를 replicas 0으로 내린다(운영자 강제 중지 FR-094, 배포 뒤 이전 슬롯 정리 W7).
 * 서버 계정의 권한은 scale 하위 리소스의 get · patch · update이고, 검사 규칙(`wanggane-platform-server-scale`)이 0 · 1만 통과시킨다
 * (docs/design/cluster.md §8). 호출 모양은 Infra/platform/check.sh와 같다. 실패는 ClusterError다: 권한이나 규칙에 걸리면 forbidden · rejected.
 */
@Injectable()
export class DeploymentScaler {
  constructor(private readonly k8s: K8sClient) {}

  async scaleToZero(slug: string, deployment: string): Promise<void> {
    if (!DEPLOYMENT_NAME.test(deployment)) throw new Error(`Not a valid deployment name: ${JSON.stringify(deployment)}`)
    await this.k8s.request('PATCH', `/apis/apps/v1/namespaces/${space(slug)}/deployments/${deployment}/scale`, { spec: { replicas: 0 } }, MERGE_PATCH)
  }
}
