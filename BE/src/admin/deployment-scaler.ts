import { Injectable } from '@nestjs/common'
import { ClusterError } from '../k8s/cluster-error.js'

/**
 * Deployment를 replicas 0으로 내리는 일(운영자 강제 중지). 읽기는 ClusterReader가 하고, 쓰기는 여기 둔다.
 * 실패는 ClusterError로 던진다. 구현은 서버 계정에 Deployment scale 권한(`patch deployments/scale`)이 생긴 뒤에 붙인다(cluster.md §8 "남은 것").
 */
export abstract class DeploymentScaler {
  abstract scaleToZero(slug: string, deployment: string): Promise<void>
}

/** scale 권한이 오기 전의 자리 채움. 항상 권한 없음이다(서버가 리더에 쓰지 않는다). */
@Injectable()
export class UnwiredDeploymentScaler extends DeploymentScaler {
  scaleToZero(): Promise<void> {
    return Promise.reject(new ClusterError('forbidden'))
  }
}
