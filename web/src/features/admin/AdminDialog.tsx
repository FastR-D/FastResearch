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
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '读取账号失败') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session])
  return <Dialog title="FastResearch 管理" onClose={onClose} wide={Boolean(session)} t={t}>
    {session ? <div className="grid gap-6">
      <p className="flex items-center gap-2"><ShieldCheck size={18} /> {session.username} · FastCAS 管理员</p>
      <p>账号创建、邀请、停用和角色调整统一在 FastCAS 完成。这里自动同步管理员权限。</p>
      {loading ? <Loading label="正在读取账号…" /> : accounts.length ? <Section className="max-h-96 overflow-y-auto">{accounts.map(account => <PanelRow key={account.id}><div className="min-w-0 break-words"><strong>{account.person}</strong><p>{account.id}</p></div></PanelRow>)}</Section> : !error && <EmptyState title="暂无同步账号" />}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="secondary" onClick={onClose}>返回工作台</Button>
      <Button variant="quiet" onClick={() => { void request('/api/auth/logout', { method: 'POST' }).then(onLogout).catch(err => setError(err.message)) }}>退出登录</Button>
    </div> : <div className="grid gap-6">
      <p>请使用 FastCAS 管理员账号登录。本站不提供独立管理员密码或自行注册入口。</p>
      <a className="fastui-button fastui-button--primary" href={apiUrl('/api/auth/fastcas/login')}>使用 FastCAS 登录</a>
    </div>}
  </Dialog>
}
