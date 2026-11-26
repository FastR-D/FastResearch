import { Alert, Button } from '@fastrd/ui-react'
import { useEffect,useState } from 'react'
import { request } from '../../shared/api/client'
import type { Copy } from '../../shared/copy'
import type { MemberSession } from '../../shared/types'
import { Dialog } from '../../shared/ui/Dialog'
export function FastCASDialog({ member, onClose, t }: { member: MemberSession; onClose: () => void; t: Copy }) {
  const [role, setRole] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void request<{ role: string }>('/api/auth/fastcas/status').then(value => { if (!cancelled) setRole(value.role) }).catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [])
  return <Dialog title={t('auth.accountTitle')} onClose={onClose} t={t}><div className="rd-account-section"><h2>FastCAS 认证</h2>
    {role && <p className="rd-account-banner" role="status">已通过 FastCAS 认证</p>}
    <p>{member.person} · {role === 'admin' ? t('auth.role.admin') : role ? t('auth.role.member') : t('common.reading')}</p>
    </div><div className="rd-account-section"><h2>账号信息</h2>
    <p>{t('auth.accountPolicy')}</p>
    {error && <Alert tone="danger">{error}</Alert>}
    <Button variant="secondary" onClick={onClose}>{t('admin.back')}</Button>
  </div></Dialog>
}
