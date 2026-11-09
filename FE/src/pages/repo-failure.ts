import { ApiError } from '../lib/api.ts'

export type Failure =
  | 'not-linked'
  | 'not-owned'
  | 'not-found'
  | 'not-personal'
  | 'unavailable'
  | 'unknown'

export const failureCopy: Record<Failure, { title: string; body: string }> = {
  'not-linked': {
    title: 'GitHub 계정이 연동되지 않았어요',
    body: '먼저 프로필에서 GitHub를 연동해 주세요.',
  },
  'not-owned': {
    title: '내 GitHub 계정의 레포가 아니에요',
    body: '연동한 GitHub 계정이 소유한 공개 레포만 배포할 수 있어요. 다른 사람이나 조직의 레포는 지원하지 않아요.',
  },
  'not-found': {
    title: '레포를 찾을 수 없어요',
    body: '주소를 찾을 수 없어요. 오타가 없는지 확인해 주세요. 비공개 레포라면 공개로 바꾼 뒤 다시 확인해 주세요.',
  },
  'not-personal': {
    title: '지금은 개인 레포만 지원해요',
    body: '조직이 소유한 레포는 아직 배포할 수 없어요.',
  },
  unavailable: {
    title: '서버와 연결하지 못했어요',
    body: '사용자 잘못이 아니에요. 잠시 후 다시 시도해 주세요.',
  },
  unknown: {
    title: '레포를 확인하지 못했어요',
    body: '잠시 후 다시 시도해 주세요.',
  },
}

// 오류는 메시지 문장이 아니라 코드로 가른다. 로그인 만료(401)는 apiFetch가 로그아웃시키고 가드가 화면을 옮긴다.
// 레포 확인과 Dockerfile 확인은 같은 소유 확인을 하므로 같은 코드가 온다.
export function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return 'unknown'
  switch (error.code) {
    case 'GITHUB_NOT_LINKED':
      return 'not-linked'
    case 'REPO_NOT_OWNED':
      return 'not-owned'
    case 'REPO_NOT_FOUND':
      return 'not-found'
    case 'REPO_NOT_PERSONAL':
      return 'not-personal'
  }
  return error.status === 503 || error.code === 'NETWORK_ERROR' ? 'unavailable' : 'unknown'
}

// 서버나 네트워크 문제는 다시 시도하면 될 수 있다. 소유 확인 오류는 그렇지 않다.
export const isRetryable = (failure: Failure) => failure === 'unavailable' || failure === 'unknown'
