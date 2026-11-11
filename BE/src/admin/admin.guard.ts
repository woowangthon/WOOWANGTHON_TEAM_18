import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import type { AuthedRequest } from '../auth/auth.decorators.js'

/** 운영자(`isAdmin`)만 통과시킨다. 로그인 가드(전역)가 먼저 돌아 `req.user`가 있다. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest<AuthedRequest>().user.isAdmin) {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Administrator only' })
    }
    return true
  }
}
