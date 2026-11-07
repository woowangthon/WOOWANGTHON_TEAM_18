import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Request } from 'express'

/** 검증한 로그인 토큰에서 꺼낸 사용자. */
export interface AuthUser {
  id: string
  email: string
  isAdmin: boolean
}

// accessToken은 AuthUser와 따로 둔다. GET /api/me가 AuthUser를 그대로 돌려주므로 거기 넣으면 토큰이 응답에 실린다.
export type AuthedRequest = Request & { user: AuthUser; accessToken: string }

export const IS_PUBLIC = 'isPublic'

/** 로그인 없이 부를 수 있는 라우트. 붙이지 않은 라우트는 전부 로그인 토큰이 필요하다. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** 가드가 요청에 붙인 사용자를 핸들러 인자로 받는다. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
)

/** 사용자 토큰을 그대로 다른 서비스(Supabase)에 넘겨야 할 때 쓴다. 로그를 포함해 어디에도 남기지 않는다. */
export const AccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().accessToken,
)
