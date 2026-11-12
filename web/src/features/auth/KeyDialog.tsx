import { Alert, TextField } from '@fastrd/ui-react'
import { ArrowUpRight, Info, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
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

  return (
    <Dialog title="登录 FastResearch" onClose={onClose} t={t}>
      <div className="dialog-form login-dialog-content">
        {casAvailable && <a className="primary-button full-button ws-cas-login" href={apiUrl('/api/auth/fastcas/login')}><ShieldCheck size={16} />使用 FastCAS 登录<ArrowUpRight size={15} /></a>}
        <Alert tone="info" className="login-dialog-alert">
          <Info size={17} aria-hidden="true" />
          <span>使用原来的个人 Key 或管理员分配的 FastCAS 账号登录。本站不开放自行注册。</span>
        </Alert>
        {!casAvailable && <Alert tone="warning" className="login-dialog-alert">
          <TriangleAlert size={17} aria-hidden="true" />
          <span>FastCAS 暂不可用，你仍可以使用个人 Key 登录。</span>
        </Alert>}
        {legacyKeyEnabled && <form onSubmit={submit}>
          <Alert tone="info" className="login-dialog-alert">{t('key.description')}</Alert>
          <label htmlFor="personal-key">{t('key.label')}</label>
          <div className="input-wrap">
            <KeyRound size={15} />
            <TextField
              id="personal-key"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="fk_••••••••••••••••"
              autoFocus
            />
          </div>
          {error && <Alert tone="danger" className="login-dialog-alert login-dialog-error">{error}</Alert>}
          <button type="submit" className="primary-button full-button" disabled={loading}>
            {loading ? t('key.verifying') : t('key.submit')} <ArrowUpRight size={15} />
          </button>
        </form>}
      </div>
    </Dialog>
  )
}
