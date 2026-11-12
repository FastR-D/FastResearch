import { Alert, Button, TextField } from '@fastrd/ui-react'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { FormEvent,useState } from 'react'
import { apiUrl } from '../../shared/api/client'
import { type Copy } from '../../shared/copy'
import { Dialog } from '../../shared/ui/Dialog'
export function KeyDialog({ onClose, onUnlock, casAvailable, legacyKeyEnabled, t }: { onClose: () => void; onUnlock: (key: string) => Promise<void>; casAvailable: boolean; legacyKeyEnabled: boolean; t: Copy }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onUnlock(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('key.invalid'))
    } finally {
      setLoading(false)
    }
  }

  return <Dialog title="登录 FastResearch" onClose={onClose} t={t}>
    {casAvailable && <a className="fastui-button fastui-button--primary" href={apiUrl('/api/auth/fastcas/login')}><ShieldCheck size={16} />使用 FastCAS 登录<ArrowUpRight size={15} /></a>}
    <Alert>使用原来的个人 Key 或管理员分配的 FastCAS 账号登录。本站不开放自行注册。</Alert>
    {!casAvailable && <Alert tone="warning">{legacyKeyEnabled ? 'FastCAS 暂不可用，你仍可以使用个人 Key 登录。' : '当前没有可用的登录方式，请联系管理员。'}</Alert>}
    {legacyKeyEnabled && <form onSubmit={submit} className="grid gap-4">
      <p>{t('key.description')}</p>
      <label className="fastui-field" htmlFor="personal-key">{t('key.label')}<TextField id="personal-key" type="password" value={value} onChange={event => setValue(event.target.value)} placeholder="fk_••••••••••••••••" autoFocus required aria-invalid={Boolean(error)} aria-describedby={error ? 'personal-key-error' : undefined} /></label>
      {error && <Alert id="personal-key-error" tone="danger">{error}</Alert>}
      <Button variant="primary" type="submit" loading={loading}>{loading ? t('key.verifying') : t('key.submit')}<ArrowUpRight size={15} /></Button>
    </form>}
  </Dialog>
}
