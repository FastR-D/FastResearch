import { PanelBody, PanelHeading, PanelRow } from '../../shared/ui/WorkspaceLayout'
import { Alert, Badge, Button, EmptyState, Loading, Section, Toolbar } from '@fastrd/ui-react'
import { CalendarCheck, ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import type { Copy } from '../../shared/copy'
import type { FastTaskToday, MemberSession } from '../../shared/types'
import { fastTaskStatusKey } from './status'
export function FastTaskTodayPanel({ member, today, onUnlock, onRefresh, onOpenFastTask, t }: {
  member: MemberSession | null; today: FastTaskToday | null; onUnlock: () => void; onRefresh: () => void; onOpenFastTask: () => void; t: Copy
}) {
  if (!member) return <Section aria-label={t('today.title')}><EmptyState title={t('today.locked')} action={<Button variant="primary" onClick={onUnlock}>{t('board.authenticate')}<KeyRound size={14} /></Button>}><p>{t('today.lockedHint')}</p></EmptyState></Section>
  const items = today?.items ?? []
  const progress = today?.progress ?? { total: 0, completed: 0, inProgress: 0, planned: 0, skipped: 0 }
  const percentage = progress.total ? Math.round(100 * progress.completed / progress.total) : 0
  return <Section aria-label={t('today.title')}>
    <PanelHeading><CalendarCheck size={16} /><h2>{t('today.title')}</h2></PanelHeading>
    <Toolbar label="今日任务操作" data-fastui-density="touch"><Button variant="secondary" onClick={onRefresh}><RefreshCw size={14} />{t('today.refresh')}</Button><Button variant="primary" onClick={onOpenFastTask}><ExternalLink size={14} />{t('header.fastTask')}</Button></Toolbar>
    <PanelBody>
      {!today ? <Loading label={t('today.syncing')} /> : <p>{t('today.date', { date: today.date ?? '—' })}</p>}
      {today?.error && <Alert tone="warning">{t('today.error')}</Alert>}
      {today && items.length === 0 ? <EmptyState title={t('today.empty')}><p>{t('today.emptyHint')}</p></EmptyState> : items.length > 0 && <>
        <label className="fastui-field">{t('today.progress', { done: progress.completed, total: progress.total })} · {percentage}%<progress className="fastui-progress w-full" value={percentage} max={100} /></label>
        <div className="flex flex-wrap gap-2">{progress.inProgress > 0 && <Badge>{t('today.inProgress', { count: progress.inProgress })}</Badge>}<Badge>{t('today.planned', { count: progress.planned })}</Badge>{progress.skipped > 0 && <Badge tone="warning">{t('today.skipped', { count: progress.skipped })}</Badge>}</div>
        <ul>{items.map(item => <li key={item.id}><PanelRow><div className="flex-1 min-w-0 break-words"><strong>{item.title}</strong>{item.minimumAction && <p>{item.minimumAction}</p>}{item.completionSummary && <p>{item.completionSummary}</p>}</div><div className="grid gap-4"><Badge tone={item.status === 'satisfied' ? 'success' : item.status === 'skipped' || item.status === 'not_completed' ? 'warning' : 'info'}>{t(fastTaskStatusKey(item.status))}</Badge>{item.targetMinutes ? <small>{t('today.minutes', { count: item.targetMinutes })}</small> : null}</div></PanelRow></li>)}</ul>
      </>}
    </PanelBody>
  </Section>
}
