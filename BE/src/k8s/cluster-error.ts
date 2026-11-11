import { ServiceUnavailableException } from '@nestjs/common'

/** 클러스터 호출이 실패한 까닭. 뜻과 부르는 쪽이 잡을 만한 경우는 docs/design/cluster-client.md "오류 나누기". */
export type ClusterErrorKind = 'unconfigured' | 'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rejected' | 'unexpected'

const KINDS: Record<number, ClusterErrorKind> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'rejected' }

/**
 * 클러스터 호출의 모든 실패. 잡지 않으면 503 CLUSTER_UNAVAILABLE로 나가고, 잡으면 `kind`로 가른다.
 * 응답의 message는 객체 값을 담을 수 있어 싣지 않는다. 쿠버네티스가 답한 상태(apiStatus)와 Status의 reason(apiReason)만 있다.
 */
export class ClusterError extends ServiceUnavailableException {
  constructor(
    readonly kind: ClusterErrorKind,
    readonly apiStatus?: number,
    readonly apiReason?: string,
  ) {
    super({ code: 'CLUSTER_UNAVAILABLE', message: 'Could not reach the cluster' })
  }

  static ofStatus(status: number, reason: string | undefined): ClusterError {
    return new ClusterError(KINDS[status] ?? 'unexpected', status, reason)
  }
}
