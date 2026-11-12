import { useEffect,useState } from 'react';
import { request } from '../../shared/api/client';
import type { AdminSession,MemberSession } from '../../shared/types';
type Identity = { session: string; person: string; keyId: string; accountId: string; source: string; expiresAt: number; role: 'member' | 'admin' }
export function useIdentity(notice: (value: string) => void) {
  const [member, setMember] = useState<MemberSession | null>(null)
  const [session, setSession] = useState<AdminSession | null>(null)
  const [casEnabled, setCasEnabled] = useState(false)
  const [legacyKeyEnabled, setLegacyKeyEnabled] = useState(true)
  useEffect(() => {
    let cancelled = false
    // Older versions stored a separate administrator bearer token in the browser.
    sessionStorage.removeItem('fastresearch-admin-session')
    localStorage.removeItem('fastresearch-member-session')
    sessionStorage.removeItem('fastresearch-member-session')
    const params = new URLSearchParams(window.location.search)
    const marker = params.get('fastcas')
    if (marker) {
      const url = new URL(window.location.href)
      url.searchParams.delete('fastcas')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    void request<{ enabled: boolean; login_enabled: boolean; legacy_key_enabled: boolean }>('/api/auth/fastcas/available').then(value => {
      if (!cancelled) { setCasEnabled(value.enabled && value.login_enabled); setLegacyKeyEnabled(value.legacy_key_enabled !== false) }
    }).catch(() => {})
    void request<Identity>('/api/content/me').then(value => {
      if (cancelled) return
      setMember({ token: '', person: value.person, keyId: value.keyId, accountId: value.accountId, source: value.source, expiresAt: value.expiresAt, role: value.role })
      if (value.role === 'admin') setSession({ token: '', username: value.person, expiresAt: value.expiresAt })
      if (marker === 'complete') notice('FastCAS 登录成功')
    }).catch(() => { if (!cancelled && marker === 'complete') notice('会话已失效，请重新登录') })
    if (marker === 'failed') notice('FastCAS 登录未完成，请重试或联系管理员')
    return () => { cancelled = true }
  }, [notice])
  return { member, setMember, session, setSession, casEnabled, casLoginEnabled: casEnabled, legacyKeyEnabled }
}
