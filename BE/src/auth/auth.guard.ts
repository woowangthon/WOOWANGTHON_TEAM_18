import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { Env } from '../config/env.js'
import { type AuthedRequest, type AuthUser, IS_PUBLIC } from './auth.decorators.js'

interface SupabaseClaims {
  sub: string
  email: string
  // 사용자가 고칠 수 없는 값. user_metadata는 사용자가 고칠 수 있어 권한에 쓰지 않는다.
  app_metadata?: { role?: unknown }
}

// 공개 키 목록을 받거나 읽지 못했을 때 jose가 던지는 오류. 토큰 탓이 아니다.
// (네트워크 오류는 JOSE 오류가 아니라 fetch의 TypeError로 온다.)
const KEY_SET_ERRORS = new Set([errors.JOSEError.code, errors.JWKSTimeout.code, errors.JWKSInvalid.code])

// 모든 라우트에 걸리는 전역 가드. @Public()이 붙은 라우트만 건너뛴다.
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name)
  private readonly issuer: string
  // 공개 키는 처음 필요할 때 받아 두고, 모르는 kid가 오면 다시 받는다(키 교체를 따라간다).
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = `${config.get('SUPABASE_URL', { infer: true })}/auth/v1`
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`))
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest<AuthedRequest>()
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1]
    if (!token) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Login required' })
    }
    req.user = await this.verify(token)
    req.accessToken = token
    return true
  }

  private async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify<SupabaseClaims>(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        // algorithms는 따로 막지 않는다. jose는 토큰의 alg에 맞는 종류의 키만 키 목록에서 고르고,
        // 공개 키 목록에는 HMAC 키가 없으며 alg none은 늘 거부한다(테스트로 확인).
        // jose는 exp가 있을 때만 만료를 본다. 없으면 영원히 유효한 토큰이 되므로 필수로 둔다.
        requiredClaims: ['sub', 'email', 'exp'],
      })
      return { id: payload.sub, email: payload.email, isAdmin: payload.app_metadata?.role === 'admin' }
    } catch (err) {
      if (err instanceof errors.JOSEError && !KEY_SET_ERRORS.has(err.code)) {
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid or expired login token' })
      }
      // 인증 서버 쪽 문제를 401로 돌려주면 FE가 멀쩡한 사용자를 로그아웃시킨다.
      this.logger.error(err)
      throw new ServiceUnavailableException({ code: 'AUTH_UNAVAILABLE', message: 'Could not check the login token' })
    }
  }
}
