import { hasCASSessionHint, markCASRenewalFailed, rememberCASSession, renewCASIfNeeded, renewCASLogin } from '../../shared/auth/cas-renewal'
import { useEffect,useState } from 'react';
import { APIError, request } from '../../shared/api/client';
import type { AdminSession,MemberSession } from '../../shared/types';
type Identity = { session: string; person: string; keyId: string; accountId: string; source: string; expiresAt: number; role: 'member' | 'admin' }
export function useIdentity(notice: (value: string) => void) {
  const [restored, setRestored] = useState(false)
  const [member, setMember] = useState<MemberSession | null>(null)
  const [session, setSession] = useState<AdminSession | null>(null)
  const [casEnabled, setCasEnabled] = useState(false)
  const [legacyKeyEnabled, setLegacyKeyEnabled] = useState(true)
  useEffect(() => {
    let cancelled = false
    // Older versions stored a separate administrator bearer token in the browser.
    try {
      sessionStorage.removeItem('fastresearch-admin-session')
      localStorage.removeItem('fastresearch-member-session')
      sessionStorage.removeItem('fastresearch-member-session')
    } catch { /* Cookie sessions work without browser storage. */ }
    const params = new URLSearchParams(window.location.search)
    const marker = params.get('fastcas')
    const previousCAS = hasCASSessionHint()
    if (marker === 'failed') markCASRenewalFailed()
    if (marker) {
      const url = new URL(window.location.href)
      url.searchParams.delete('fastcas')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    const available = request<{ enabled: boolean; login_enabled: boolean; legacy_key_enabled: boolean }>('/api/auth/fastcas/available').then(value => {
      if (!cancelled) { setCasEnabled(value.enabled && value.login_enabled); setLegacyKeyEnabled(value.legacy_key_enabled !== false) }
      return value.enabled && value.login_enabled
    }).catch(() => false)
    void request<Identity>('/api/content/me').then(value => {
      if (cancelled) return
      setMember({ token: '', person: value.person, keyId: value.keyId, accountId: value.accountId, source: value.source, expiresAt: value.expiresAt, role: value.role })
      if (value.role === 'admin') setSession({ token: '', username: value.person, expiresAt: value.expiresAt })
      if (marker === 'complete') notice('FastCAS 登录成功')
    }).catch(async error => {
      if (cancelled) return
      if (error instanceof APIError && error.status === 401 && previousCAS && marker !== 'failed' && await available && !cancelled && renewCASLogin()) return
      if (marker === 'complete') notice('会话已失效，请重新登录')
    }).finally(() => { if (!cancelled) setRestored(true) })
    if (marker === 'failed') notice('FastCAS 登录未完成，请重试或联系管理员')
    return () => { cancelled = true }
  }, [notice])
  useEffect(() => {
    if (restored) rememberCASSession(member)
    if (!member || member.source !== 'fastcas' || !casEnabled) return
    let timer = 0
    const check = () => {
      window.clearTimeout(timer)
      if (renewCASIfNeeded(member)) return
      const remaining = member.expiresAt - Date.now() - 60_000
      timer = window.setTimeout(check, Math.min(24 * 60 * 60_000, Math.max(5000, remaining)))
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [member, casEnabled, restored])
  return { member, setMember, session, setSession, casEnabled, casLoginEnabled: casEnabled, legacyKeyEnabled }
}
