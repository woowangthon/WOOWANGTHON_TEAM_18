import { Injectable, ServiceUnavailableException } from '@nestjs/common'

/**
 * 서비스의 비밀값을 리더의 Secret `<서비스>-secrets`(공간 `proj-<slug>`)로 통째로 바꾸는 일. PUT /api/deploys/:id/secrets(#43)가 부르고,
 * 구현은 클러스터 호출 모듈(#111)이 채운다. 구현이 지킬 것:
 * - 공간 `proj-<slug>`가 없으면 먼저 만든다(`SpaceService.ensureSpace`).
 * - Secret이 없으면 만들고(POST), 이미 있으면(409) 통째로 바꾼다(PUT). 서버 계정은 Secret을 읽거나 patch할 수 없다.
 * - 리더에 닿지 못하거나 거절하면 `503 CLUSTER_UNAVAILABLE`(ServiceUnavailableException)을 던진다. 값은 로그 · 오류에 싣지 않는다.
 * 인자는 검증을 통과한 값이다(slug · 서비스 이름 · env 이름은 deploy-input의 규칙).
 */
export abstract class SecretWriter {
  abstract write(slug: string, service: string, values: Record<string, string>): Promise<void>
}

/** #111이 실제 구현을 묶기 전의 자리. 쓰지 못한다고 정직하게 답한다. */
@Injectable()
export class UnavailableSecretWriter extends SecretWriter {
  write(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException({ code: 'CLUSTER_UNAVAILABLE', message: 'Could not reach the cluster' }))
  }
}
