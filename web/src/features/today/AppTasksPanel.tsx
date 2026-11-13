import { useAppActivity } from '../workspace/use-app-activity'
import { MetricBlock } from '../../shared/ui/MetricBlock'
import { PanelBody, PanelHeading, PanelRow } from '../../shared/ui/WorkspaceLayout'
import { Alert, Badge, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { CalendarCheck, KeyRound, RefreshCw } from 'lucide-react'
import type { Copy } from '../../shared/copy'
import type { MemberSession, WorkspaceApp } from '../../shared/types'
import { taskStatusKey } from './status'
export function AppTasksPanel({ app, catalogLoading, member, onUnlock, t }: {
  app?: WorkspaceApp; catalogLoading: boolean; member: MemberSession | null; onUnlock: () => void; t: Copy
}) {
  const { activity, error, refresh } = useAppActivity(app?.id ?? '', member)
  const today = activity?.tasks
  const name = app?.name ?? '任务应用'
  if (!member) return <Section aria-label={t('today.title')}><EmptyState title={t('today.locked')} action={<Button variant="primary" onClick={onUnlock}>{t('board.authenticate')}<KeyRound size={14} /></Button>}><p>{t('today.lockedHint')}</p></EmptyState></Section>
  const items = today?.items ?? []
  const progress = today?.progress ?? { total: 0, completed: 0, inProgress: 0, planned: 0, skipped: 0 }
  const percentage = progress.total ? Math.round(100 * progress.completed / progress.total) : 0
  return <Section aria-label={t('today.title')}>
    <PanelHeading><CalendarCheck size={16} /><h2>{t('today.title')}</h2><Button variant="quiet" onClick={refresh}><RefreshCw size={14} />{t('today.refresh')}</Button></PanelHeading>
    <PanelBody>
      {catalogLoading || (member && app && !activity && !error) ? <Loading label={`正在同步 ${name} 今日任务…`} /> : today && <p>{today.date ?? '今天'} · 来自 {name}</p>}
      {!catalogLoading && !app && <Alert tone="warning">当前部署尚未配置任务应用。</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {activity && activity.accountState !== 'active' && <Alert tone="warning">{activity.message ?? '暂时无法读取任务，请进入应用检查账号关联。'}</Alert>}
      {today && items.length === 0 ? <EmptyState title={t('today.empty')}><p>在 {name} 中安排今天的任务后，会自动同步到这里。</p></EmptyState> : items.length > 0 && <>
        <label className="fastui-field">{t('today.progress', { done: progress.completed, total: progress.total })} · {percentage}%<progress className="fastui-progress w-full" value={percentage} max={100} /></label>
        <dl className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4"><MetricBlock label="进行中" value={progress.inProgress} /><MetricBlock label="待开始" value={progress.planned} /><MetricBlock label="已跳过" value={progress.skipped} /></dl>
        <ul>{items.map(item => <li key={item.id}><PanelRow><div className="flex-1 min-w-0 break-words"><strong>{item.title}</strong>{item.minimumAction && <p>{item.minimumAction}</p>}{item.completionSummary && <p>{item.completionSummary}</p>}</div><div className="grid gap-4"><Badge tone={item.status === 'satisfied' ? 'success' : item.status === 'skipped' || item.status === 'not_completed' ? 'warning' : 'info'}>{t(taskStatusKey(item.status))}</Badge>{item.targetMinutes ? <small>{t('today.minutes', { count: item.targetMinutes })}</small> : null}</div></PanelRow></li>)}</ul>
      </>}
    </PanelBody>
  </Section>
}
