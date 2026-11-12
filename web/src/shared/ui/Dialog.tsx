import { Button, Dialog as UIDialog } from '@fastrd/ui-react'
import { X } from 'lucide-react'
import type { Copy } from '../copy'
export function Dialog({ title, children, onClose, wide, t }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; t: Copy }) {
  return <UIDialog open onClose={onClose} label={title} size={wide ? 'lg' : 'md'}>
    <header><div className="flex items-center justify-between gap-3"><h2 className="fastui-heading">{title}</h2><Button variant="icon" onClick={onClose} aria-label={t('dialog.close')}><X size={15} /></Button></div></header>
    <div className="fastui-modal-body">{children}</div>
  </UIDialog>
}
