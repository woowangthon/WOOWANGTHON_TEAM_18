import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Request } from 'express'

/** 검증한 로그인 토큰에서 꺼낸 사용자. */
export interface AuthUser {
  id: string
  email: string
  isAdmin: boolean
}

export type AuthedRequest = Request & { user: AuthUser }

export const IS_PUBLIC = 'isPublic'

/** 로그인 없이 부를 수 있는 라우트. 붙이지 않은 라우트는 전부 로그인 토큰이 필요하다. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** 가드가 요청에 붙인 사용자를 핸들러 인자로 받는다. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
)
