import { Dialog as UIDialog } from '@fastrd/ui-react';
import { X } from 'lucide-react';
import type { Copy } from '../copy';
export function Dialog({ title, children, onClose, wide, className, t }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; className?: string; t: Copy }) {
  return (
    <UIDialog open onClose={onClose} label={title} size={wide ? 'lg' : 'md'} className={['tech-dialog', wide ? 'admin-dialog' : '', className ?? ''].filter(Boolean).join(' ')}>
      <div className="dialog-title">
        <span>{title}</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('dialog.close')}><X size={15} /></button>
      </div>
      {children}
    </UIDialog>
  )
}
