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
  return <Dialog title="FastCAS 账号" onClose={onClose} t={t}><div className="dialog-form">
    <p>{member.person} · {role === 'admin' ? '管理员' : role ? '成员' : '读取中…'}</p>
    <p>登录和账号由 FastCAS 统一管理。需要新账号时，请联系管理员创建或邀请；本站不开放自行注册。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="outline-button" onClick={onClose}>返回工作台</button>
  </div></Dialog>
}
