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
  return <Dialog title="FastCAS 账号" onClose={onClose} t={t}><div className="grid gap-4">
    <p>{member.person} · {role === 'admin' ? '管理员' : role ? '成员' : '读取中…'}</p>
    <p>登录和账号由 FastCAS 统一管理。需要新账号时，请联系管理员创建或邀请；本站不开放自行注册。</p>
    {error && <Alert tone="danger">{error}</Alert>}
    <Button variant="secondary" onClick={onClose}>返回工作台</Button>
  </div></Dialog>
}
