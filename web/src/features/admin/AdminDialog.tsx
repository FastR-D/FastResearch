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
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (session) void request<{ keys: PersonalKey[] }>('/api/admin/keys').then(value => {
      if (!cancelled) setAccounts(value.keys)
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '读取账号失败') })
    return () => { cancelled = true }
  }, [session])
  return <Dialog title="FastResearch 管理" onClose={onClose} wide={Boolean(session)} t={t}>
    {session ? <div className="dialog-form">
      <p><ShieldCheck size={18} /> {session.username} · FastCAS 管理员</p>
      <p>账号创建、邀请、停用和角色调整统一在 FastCAS 完成。这里自动同步管理员权限。</p>
      <div className="admin-key-list">{accounts.map(account => <div className="admin-key-row" key={account.id}>
        <span className="key-row-info"><b>{account.person}</b><small>{account.id}</small></span>
      </div>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="outline-button" onClick={onClose}>返回工作台</button>
      <button type="button" className="text-button" onClick={() => { void request('/api/auth/logout', { method: 'POST' }).then(onLogout).catch(err => setError(err.message)) }}>退出登录</button>
    </div> : <div className="dialog-form">
      <p>请使用 FastCAS 管理员账号登录。本站不提供独立管理员密码或自行注册入口。</p>
      <a className="primary-button full-button" href={apiUrl('/api/auth/fastcas/login')}>使用 FastCAS 登录</a>
    </div>}
  </Dialog>
}
