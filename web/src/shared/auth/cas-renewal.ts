import { apiUrl } from '../api/client'
import type { MemberSession } from '../types'

const hintKey = 'fastresearch-cas-session-hint'
const attemptKey = 'fastresearch-cas-renewal-attempt'
let redirecting = false

// These tab-local values only schedule a new verified OIDC login. They never
// authenticate requests or contain credentials.
export function hasCASSessionHint() {
  try { return sessionStorage.getItem(hintKey) === 'true' } catch { return false }
}
export function rememberCASSession(member: MemberSession | null) {
  try {
    if (member?.source === 'fastcas') sessionStorage.setItem(hintKey, 'true')
    else sessionStorage.removeItem(hintKey)
  } catch { /* Cookie authentication continues when storage is unavailable. */ }
}
export function markCASRenewalFailed() {
  try { sessionStorage.setItem(attemptKey, String(Date.now())) } catch { /* Best effort loop guard. */ }
}
export function renewCASLogin() {
  if (redirecting) return true
  if (document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return false
  try {
    if (Date.now() - Number(sessionStorage.getItem(attemptKey) ?? 0) < 60_000) return false
    sessionStorage.setItem(attemptKey, String(Date.now()))
  } catch { /* The server still requires a fresh browser-bound transaction. */ }
  const next = window.location.pathname + window.location.search
  const login = new URL(apiUrl('/api/auth/fastcas/login'), window.location.origin)
  login.searchParams.set('next', next)
  redirecting = true
  window.location.assign(login.toString())
  return true
}
export function renewCASIfNeeded(member: MemberSession) {
  return member.source === 'fastcas' && member.expiresAt - Date.now() <= 60_000 && renewCASLogin()
}
