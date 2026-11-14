import { type ArgumentsHost, BadRequestException, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Response } from 'express'

// 모든 오류를 SRS §2.4의 공통 모양 { error: { code, message } }로 돌려준다.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      const error: Record<string, unknown> = { code: codeOf(body, status), message: isBodyParseError(exception) ? 'Request body is not valid JSON' : exception.message }
      // 검증 오류가 칸마다 알리는 목록(INVALID_SPEC). 다른 오류에는 없다.
      if (typeof body === 'object' && 'fields' in body && Array.isArray(body.fields)) error.fields = body.fields
      // 다시 시도할 수 있는 시각(ISO, GITHUB_RATE_LIMITED). 다른 오류에는 없다.
      if (typeof body === 'object' && 'retryAt' in body && typeof body.retryAt === 'string') error.retryAt = body.retryAt
      res.status(status).json({ error })
      return
    }

    // 예상하지 못한 오류는 내용을 응답에 싣지 않고 로그에만 남긴다.
    this.logger.error(exception)
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
}

// 던질 때 { code }를 주면 그 값을, 아니면 HTTP 상태 이름(NOT_FOUND 등)을 쓴다.
function codeOf(body: string | object, status: number): string {
  if (typeof body === 'object' && 'code' in body && typeof body.code === 'string') return body.code
  // HttpStatus에 없는 상태(예: 499)는 이름이 undefined다.
  return HttpStatus[status] ?? 'ERROR'
}

// Express의 본문 파서가 JSON이 아닌 본문을 받으면 Nest가 SyntaxError의 문구를 그대로 BadRequestException으로 만든다(우리 코드가 던지는 것과 달리 `code`가 없다).
// V8의 문구는 본문 조각을 담을 수 있다(`Unexpected token 'l', "leaky-value" is not valid JSON`). 비밀값을 받는 API가 있어 이 문구는 응답에 싣지 않는다.
// 문구를 검사하면 V8이 문구를 바꿀 때 조용히 샌다. 우리 코드는 항상 `code`를 주므로 `code`가 없는 BadRequestException은 모두 그렇게 본다.
function isBodyParseError(exception: HttpException): boolean {
  const body = exception.getResponse()
  const hasCode = typeof body === 'object' && 'code' in body
  return exception instanceof BadRequestException && !hasCode
}
