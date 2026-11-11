import { Injectable } from '@nestjs/common'

/** 리더의 쿠버네티스 API 호출이 실패한 이유. `forbidden`: 닿았지만 서버 계정에 권한이 없다(401 · 403). `unreachable`: 그 밖의 모든 실패(닿지 못함, 시간 초과, 인증서 검증 실패, 설정 없음). */
export class ClusterApiError extends Error {
  constructor(readonly kind: 'unreachable' | 'forbidden') {
    super(`Cluster API ${kind}`)
  }
}

/**
 * 운영자 API가 클러스터를 읽고 고칠 때 쓰는 연결. 구현은 서버 계정 토큰으로 리더의 API를 부르는 클라이언트(#81)다.
 * 오류는 모두 ClusterApiError로 던진다. 오류에 요청 · 응답 본문과 토큰을 싣지 않는다.
 */
export abstract class ClusterApi {
  /** GET의 JSON 본문. 없는 객체(404)면 null. */
  abstract get(path: string): Promise<unknown>
  /** `application/merge-patch+json` PATCH. */
  abstract patch(path: string, body: object): Promise<void>
}

/** 리더 연결(#81)이 들어오기 전의 자리 채움. 항상 닿지 못한다. */
@Injectable()
export class UnavailableClusterApi extends ClusterApi {
  get(): Promise<unknown> {
    return Promise.reject(new ClusterApiError('unreachable'))
  }
  patch(): Promise<void> {
    return Promise.reject(new ClusterApiError('unreachable'))
  }
}
