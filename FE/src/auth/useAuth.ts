import { useContext } from 'react'
import { AuthContext } from './auth-context.ts'
import type { AuthValue } from './auth-context.ts'

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
