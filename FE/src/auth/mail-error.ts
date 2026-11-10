// 메일을 보내는 호출(가입 · 재발송 · 재설정)이 돌려주는 오류를 코드와 상태로 가른다. 모르는 오류는 'failed'다.
export type MailFailure = 'rate' | 'not-authorized' | 'failed'

export const mailFailureCopy: Record<MailFailure, { title: string; body: string }> = {
  rate: {
    title: '메일 발송이 몰렸어요',
    body: '잠시 후 다시 시도해 주세요.',
  },
  'not-authorized': {
    title: '이 주소로는 메일을 보낼 수 없어요',
    body: '제공된 테스트 계정으로 로그인해 주세요.',
  },
  failed: {
    title: '서버에 연결하지 못했어요',
    body: '잠시 후 다시 시도해 주세요.',
  },
}

export function classifyMailError(error: { code?: string; status?: number }): MailFailure {
  if (
    error.status === 429 ||
    error.code === 'over_email_send_rate_limit' ||
    error.code === 'over_request_rate_limit'
  ) {
    return 'rate'
  }
  if (error.code === 'email_address_not_authorized') return 'not-authorized'
  return 'failed'
}
