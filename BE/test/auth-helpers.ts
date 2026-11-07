import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect } from 'vitest'

export const ISSUER = new URL('/auth/v1', process.env.SUPABASE_URL).href
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`

// 테스트에서 만든 키. 진짜 Supabase 대신 이 키의 공개 키 목록을 fetch 자리에서 돌려준다.
export const kid = 'test-key'
export const signer = await generateKeyPair('ES256')
export const stranger = await generateKeyPair('ES256')
export const keySet = { keys: [{ ...(await exportJWK(signer.publicKey)), kid, alg: 'ES256', use: 'sig' }] }

export const now = () => Math.floor(Date.now() / 1000)

// 기본값은 유효한 토큰이다. 덮어쓴 claim만 바뀌고, undefined를 주면 그 claim이 빠진다.
export function token(
  claims: Record<string, unknown> = {},
  { alg = 'ES256', key = signer.privateKey }: { alg?: string; key?: Parameters<SignJWT['sign']>[0] } = {},
) {
  return new SignJWT({
    sub: 'user-1',
    email: 'student@example.com',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now() + 300,
    ...claims,
  })
    .setProtectedHeader({ alg, kid })
    .setIssuedAt()
    .sign(key)
}

export const errorBody = (code: string) => ({ error: { code, message: expect.any(String) as string } })
