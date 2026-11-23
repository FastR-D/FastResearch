import { Alert, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { PanelBody, PanelHeading, PanelRow } from '../../shared/ui/WorkspaceLayout'
import { ShieldCheck } from 'lucide-react'
import { useEffect,useState } from 'react'
import { APIError, apiUrl, request } from '../../shared/api/client'
import type { Copy } from '../../shared/copy'
import type { AdminSession,PersonalKey } from '../../shared/types'

export function AdminPanel({ session, onLogout, onSessionExpired, t }: {
  session: AdminSession | null
  onLogout: () => void
  onSessionExpired: () => void
  t: Copy
}) {
  const [accounts, setAccounts] = useState<PersonalKey[]>([])
  const [loading, setLoading] = useState(Boolean(session))
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setAccounts([])
    setLoading(Boolean(session))
    setError('')
    if (session) void request<{ keys: PersonalKey[] }>('/api/admin/keys', {}, session).then(value => {
      if (!cancelled) setAccounts(value.keys)
    }).catch(err => {
      if (cancelled) return
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) onSessionExpired()
      else setError(err instanceof Error ? err.message : t('admin.accountsFailed'))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [onSessionExpired, session, t])
  const logout = async () => {
    setLoggingOut(true)
    setError('')
    try {
      await request('/api/auth/logout', { method: 'POST' })
      onLogout()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.logoutFailed'))
    } finally {
      setLoggingOut(false)
    }
  }
  const next = new URLSearchParams({ next: window.location.pathname + window.location.search })
  return <Section aria-label={t('admin.manageAccount')}>
    {session && <PanelHeading>
      <ShieldCheck size={18} />
      <h2 className="min-w-0 break-words">{t('admin.identity', { username: session.username })}</h2>
      <Button className="ml-auto" variant="quiet" loading={loggingOut} onClick={() => void logout()}>{t('auth.logout')}</Button>
    </PanelHeading>}
    {session ? <PanelBody>
      <p>{t('admin.centralPolicy')}</p>
      {loading ? <Loading label={t('admin.accountsLoading')} /> : accounts.length ? <ul>{accounts.map(account => <li key={account.id}><PanelRow><div className="min-w-0 break-words"><strong>{account.person}</strong><p>{account.id}</p></div></PanelRow></li>)}</ul> : !error && <EmptyState title={t('admin.accountsEmpty')} />}
      {error && <Alert tone="danger">{error}</Alert>}
    </PanelBody> : <PanelBody>
      <p>{t('admin.loginPolicy')}</p>
      <div><a className="fastui-button fastui-button--primary" href={apiUrl(`/api/auth/fastcas/login?${next}`)}>{t('auth.loginCAS')}</a></div>
    </PanelBody>}
  </Section>
}
