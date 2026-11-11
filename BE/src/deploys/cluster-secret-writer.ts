import { Injectable } from '@nestjs/common'
import { ClusterSecrets } from '../k8s/cluster-secrets.js'
import { SpaceService } from '../k8s/space.service.js'
import { SecretWriter } from './secret-writer.js'

/**
 * SecretWriter의 실제 구현. 공간 `proj-<slug>`를 먼저 만들고(`ensureSpace`는 이미 있으면 성공이다) 그다음 Secret을 쓴다.
 * `ClusterSecrets.write`는 공간을 만들지 않고, 없으면 `not_found`로 실패하기 때문에 순서가 바뀌면 첫 쓰기가 실패한다.
 * 실패는 그대로 ClusterError(503 CLUSTER_UNAVAILABLE)로 올라간다.
 */
@Injectable()
export class ClusterSecretWriter extends SecretWriter {
  constructor(
    private readonly space: SpaceService,
    private readonly secrets: ClusterSecrets,
  ) {
    super()
  }

  async write(slug: string, service: string, values: Record<string, string>): Promise<void> {
    await this.space.ensureSpace(slug)
    await this.secrets.write(slug, service, values)
  }
}
