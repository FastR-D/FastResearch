import { Alert, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { PanelRow } from '../../shared/ui/WorkspaceLayout'
import { ShieldCheck } from 'lucide-react'
import { useEffect,useState } from 'react'
import { apiUrl,request } from '../../shared/api/client'
import type { Copy } from '../../shared/copy'
import type { AdminSession,PersonalKey } from '../../shared/types'
import { Dialog } from '../../shared/ui/Dialog'

export function AdminDialog({ session, onLogout, onClose, t }: {
  session: AdminSession | null
  onLogout: () => void
  onClose: () => void
  t: Copy
}) {
  const [accounts, setAccounts] = useState<PersonalKey[]>([])
  const [loading, setLoading] = useState(Boolean(session))
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(Boolean(session))
    setError('')
    if (session) void request<{ keys: PersonalKey[] }>('/api/admin/keys').then(value => {
      if (!cancelled) setAccounts(value.keys)
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t('admin.accountsFailed')) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session, t])
  return <Dialog title={t('admin.title')} onClose={onClose} wide={Boolean(session)} t={t}>
    {session ? <div className="grid gap-6">
      <p className="flex items-center gap-2"><ShieldCheck size={18} /> {t('admin.identity', { username: session.username })}</p>
      <p>{t('admin.centralPolicy')}</p>
      {loading ? <Loading label={t('admin.accountsLoading')} /> : accounts.length ? <Section className="max-h-96 overflow-y-auto">{accounts.map(account => <PanelRow key={account.id}><div className="min-w-0 break-words"><strong>{account.person}</strong><p>{account.id}</p></div></PanelRow>)}</Section> : !error && <EmptyState title={t('admin.accountsEmpty')} />}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="secondary" onClick={onClose}>{t('admin.back')}</Button>
      <Button variant="quiet" onClick={() => { void request('/api/auth/logout', { method: 'POST' }).then(onLogout).catch(err => setError(err.message)) }}>{t('auth.logout')}</Button>
    </div> : <div className="grid gap-6">
      <p>{t('admin.loginPolicy')}</p>
      <a className="fastui-button fastui-button--primary" href={apiUrl('/api/auth/fastcas/login')}>{t('auth.loginCAS')}</a>
    </div>}
  </Dialog>
}
