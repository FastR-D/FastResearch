import { Button, Dialog as UIDialog, PanelHeader } from '@fastrd/ui-react'
import { X } from 'lucide-react'
import type { Copy } from '../copy'
export function Dialog({ title, children, onClose, wide, t }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; t: Copy }) {
  return <UIDialog open onClose={onClose} label={title} size={wide ? 'lg' : 'md'}>
    <PanelHeader className="sticky top-0 z-10"><h2 className="flex-1"><span className="text-sm">{title}</span></h2><Button variant="icon" onClick={onClose} aria-label={t('dialog.close')}><X size={15} /></Button></PanelHeader>
    <div className="fastui-modal-body" data-fastui-density="touch">{children}</div>
  </UIDialog>
}
