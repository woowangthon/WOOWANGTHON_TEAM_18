import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
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
      const error: Record<string, unknown> = { code: codeOf(body, status), message: exception.message }
      // 검증 오류가 칸마다 알리는 목록(INVALID_SPEC). 다른 오류에는 없다.
      if (typeof body === 'object' && 'fields' in body && Array.isArray(body.fields)) error.fields = body.fields
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
