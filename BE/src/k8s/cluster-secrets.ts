import { Injectable } from '@nestjs/common'
import { SERVICE_NAME, SLUG } from '../deploys/deploy-input.js'
import { K8sClient } from './k8s.client.js'

/** 학생 서비스의 비밀값을 공간 `proj-<slug>`의 Secret `<service>-secrets`로 넣는다. 설계는 docs/design/cluster-client.md. */
@Injectable()
export class ClusterSecrets {
  constructor(private readonly k8s: K8sClient) {}

  /**
   * `values`가 Secret의 전부가 된다: 없으면 만들고, 이미 있으면 통째로 바꾼다(빠진 key는 지워진다). 다시 불러도 같은 결과다.
   * 서버 계정은 Secret을 읽지도 patch하지도 못한다(patch의 응답은 Secret 전체다). 그래서 POST 먼저, 409면 PUT이다.
   * 실패는 ClusterError다(공간이 없으면 not_found). 값은 로그 · 오류에 남지 않는다.
   */
  async write(slug: string, service: string, values: Record<string, string>): Promise<void> {
    // 요청 경로에 들어가는 값이다. 검증을 통과하지 않은 값은 부른 쪽의 버그다.
    if (!SLUG.test(slug)) throw new Error(`Not a valid slug: ${JSON.stringify(slug)}`)
    if (!SERVICE_NAME.test(service)) throw new Error(`Not a valid service name: ${JSON.stringify(service)}`)
    const namespace = `proj-${slug}`
    const name = `${service}-secrets`
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace },
      // 검사 규칙이 Opaque와 이 이름만 통과시킨다(cluster.md §8).
      type: 'Opaque',
      data: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value, 'utf8').toString('base64')])),
    }
    const path = `/api/v1/namespaces/${namespace}/secrets`
    if ((await this.k8s.create(path, secret)) === 'exists') await this.k8s.request('PUT', `${path}/${name}`, secret)
  }
}
