import { PanelBody, PanelHeading } from '../../shared/ui/WorkspaceLayout'
import { Badge, Button, EmptyState, Section, Toolbar } from '@fastrd/ui-react'
import { BookOpenText, ExternalLink, Inbox, KeyRound } from 'lucide-react'
import { useMemo } from 'react'
import type { Copy } from '../../shared/copy'
import { formatTime, splitInsight } from '../../shared/lib/format'
import type { InsightItem, MemberSession } from '../../shared/types'
export function InsightMailbox({ member, items, selectedId, readIds, onSelect, onUnlock, onOpenFastRead, t }: {
  member: MemberSession | null; items: InsightItem[]; selectedId: string | null; readIds: Set<string>; onSelect: (id: string) => void; onUnlock: () => void; onOpenFastRead: () => void; t: Copy
}) {
  const selected = useMemo(() => items.find(item => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])
  const unread = items.filter(item => !readIds.has(item.id)).length
  const detail = splitInsight(selected?.summary)
  return <Section aria-label={t('insight.label')}>
    <PanelHeading><Inbox size={16} /><h2>{t('insight.title')}</h2>{member && <Badge>{t('insight.count', { count: items.length })} {unread > 0 && t('insight.unread', { count: unread })}</Badge>}</PanelHeading>
    <PanelBody>
      <p>{member ? t('insight.personal', { person: member.person }) : t('insight.lockedDescription')}</p>
      {!member ? <EmptyState title={t('insight.lockedTitle')} action={<Button variant="secondary" onClick={onUnlock}>{t('insight.unlock')}<KeyRound size={14} /></Button>}><p>{t('insight.lockedHint')}</p></EmptyState>
        : !items.length ? <EmptyState title={t('insight.empty')}><p>{t('insight.emptyHint')}</p></EmptyState> : <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
          <nav aria-label="信箱条目" className="grid gap-1 min-w-0 max-h-96 overflow-y-auto">
            {items.map(item => <Button variant="navigation" key={item.id} aria-pressed={selected?.id === item.id} aria-controls="insight-detail" onClick={() => onSelect(item.id)} className="justify-start text-left whitespace-normal">
              <span className="grid gap-2 min-w-0 break-words p-3 text-sm leading-6"><strong>{item.title}</strong><small>{item.direction ? t('insight.reading', { direction: item.direction }) : t('insight.card')}</small><small>{formatTime(item.receivedAt)}{item.source ? ` · ${item.source}` : ''}</small>{!readIds.has(item.id) && <span>{t('insight.unread', { count: 1 })}</span>}</span>
            </Button>)}
          </nav>
          <article id="insight-detail" aria-label="信箱详情" className="lg:col-span-2 min-w-0 break-words grid gap-6" aria-live="polite">
            {selected ? <>
              <Badge>{selected.direction ? t('insight.direction', { direction: selected.direction }) : t('insight.result')}</Badge>
              <h3 className="fastui-heading text-lg">{selected.title}</h3><time>{formatTime(selected.receivedAt)}</time>
              <dl className="grid gap-4">
                {selected.authors && <div><dt>{t('insight.authors')}</dt><dd>{selected.authors}</dd></div>}
                {selected.venue && <div><dt>{t('insight.venue')}</dt><dd>{selected.venue}</dd></div>}
                {selected.url && <div><dt>{t('insight.paperUrl')}</dt><dd><a className="fastui-link break-all" href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a></dd></div>}
              </dl>
              {detail.abstract && <Section><PanelHeading><h3>{t('insight.abstract')}</h3></PanelHeading><p className="p-5 md:p-6 whitespace-pre-line text-sm leading-7">{detail.abstract}</p></Section>}
              {detail.trend && <Section><PanelHeading><h3>{t('insight.trend')}</h3></PanelHeading><p className="p-5 md:p-6 whitespace-pre-line text-sm leading-7">{detail.trend}</p></Section>}
              <small>{t('insight.archived')}</small>
              <Toolbar label="论文操作" data-fastui-density="touch"><Button variant="primary" onClick={onOpenFastRead}><BookOpenText size={15} />{t('insight.fastRead')}</Button>{selected.url && <a className="fastui-button fastui-button--secondary" href={selected.url} target="_blank" rel="noreferrer">{t('insight.open')}<ExternalLink size={14} /></a>}</Toolbar>
            </> : <EmptyState title={t('insight.select')} />}
          </article>
        </div>}
    </PanelBody>
  </Section>
}
