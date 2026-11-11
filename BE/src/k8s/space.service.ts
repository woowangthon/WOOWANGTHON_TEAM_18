import { Injectable } from '@nestjs/common'
import { SLUG } from '../deploys/deploy-input.js'
import { K8sClient } from './k8s.client.js'
import { spaceObjects } from './space-template.js'

/** 프로젝트의 학생 공간 `proj-<slug>`를 만든다. 설계는 docs/design/space.md. */
@Injectable()
export class SpaceService {
  constructor(private readonly k8s: K8sClient) {}

  /**
   * 양식의 객체 여섯을 차례로 만든다. 이미 있는 객체는 성공으로 보므로 같은 slug로 다시 불러도 되고, 중간에 끊긴 공간은 이어서 채운다.
   * 리더에 닿지 못하거나 만들지 못하면 503 CLUSTER_UNAVAILABLE이고, 그때까지 만든 것은 그대로 둔다.
   */
  async ensureSpace(slug: string): Promise<void> {
    // 요청 경로에 들어가는 값이다. 검증을 통과하지 않은 값은 부른 쪽의 버그다.
    if (!SLUG.test(slug)) throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`)
    for (const { path, body } of spaceObjects(slug)) await this.k8s.create(path, body)
  }
}
