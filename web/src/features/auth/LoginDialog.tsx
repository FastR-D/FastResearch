import { Button, Dialog } from '@fastrd/ui-react'
import { ShieldCheck } from 'lucide-react'
import { apiUrl } from '../../shared/api/client'
import type { Copy } from '../../shared/copy'

export function LoginDialog({ onClose, casAvailable, t }: { onClose: () => void; casAvailable: boolean; t: Copy }) {
  const label = <><ShieldCheck size={16} />{t('auth.loginCAS')}</>

  return <Dialog open onClose={onClose} label={t('auth.loginTitle')} className="!max-w-80">
    <div className="fastui-modal-body" data-fastui-density="touch">
      {casAvailable ? <a className="fastui-button fastui-button--primary" href={apiUrl('/api/auth/fastcas/login')}>{label}</a> : <Button variant="primary" disabled>{label}</Button>}
    </div>
  </Dialog>
}
