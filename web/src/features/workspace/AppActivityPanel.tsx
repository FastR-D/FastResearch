import { text as t } from '../../shared/copy'
import { MetricBlock } from '../../shared/ui/MetricBlock'
import { PanelBody, PanelHeading } from '../../shared/ui/WorkspaceLayout'
import { Alert, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { ArrowUpRight, Bell, BookOpenText, FileText, MessageSquare, RefreshCw } from 'lucide-react'
import { apiUrl } from '../../shared/api/client'
import { formatTime } from '../../shared/lib/format'
import type { MemberSession } from '../../shared/types'
import { useAppActivity } from './use-app-activity'

export function AppActivityPanel({ appId, name, member, onLogin }: { appId: string; name: string; member: MemberSession | null; onLogin: () => void }) {
  const { activity, error, refresh } = useAppActivity(appId, member)
  const descriptions: Record<string, string> = {
    'fast-read': t('activity.description.fast-read'),
    'fast-news': t('activity.description.fast-news'),
    'fast-write': t('activity.description.fast-write'),
  }
  const Icon = appId === 'fast-write' ? MessageSquare : appId === 'fast-read' ? BookOpenText : Bell
  return <Section aria-label={t('activity.regionAria', { name: name })}>
    <PanelHeading><Icon size={16} /><h3>{t('activity.title')}</h3>{member && <Button variant="icon" aria-label={t('activity.refreshAria', { name: name })} onClick={refresh}><RefreshCw size={15} /></Button>}</PanelHeading>
    <PanelBody>
      {!member && <p>{descriptions[appId]}</p>}
      {!member ? <EmptyState title={t('activity.lockedTitle')} action={<Button variant="secondary" onClick={onLogin}>{t('activity.login')}<ArrowUpRight size={14} /></Button>}><p>{t('activity.lockedHint', { name })}</p></EmptyState>
        : error ? <Alert tone="danger">{error}</Alert>
        : !activity ? <Loading label={t('activity.loading')} />
        : activity.accountState === 'active' ? <>
          <dl className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{activity.metrics.map(metric => <MetricBlock key={metric.id} label={metric.label} value={metric.value.toLocaleString('zh-CN')} />)}</dl>
          {activity.items.length ? <ul>{activity.items.map(item => <li key={item.id}><a className="fastui-list-row" href={item.path} target="_blank" rel="noopener noreferrer">{item.kind === 'comment' || item.kind === 'mention' ? <MessageSquare size={16} className="shrink-0" /> : <FileText size={16} className="shrink-0" />}<span className="flex-1 min-w-0 break-words py-2 text-sm leading-6"><strong>{item.title}</strong><small className="block">{item.description}{item.occurredAt && ` · ${formatTime(item.occurredAt)}`}</small></span><ArrowUpRight size={15} className="shrink-0" /></a></li>)}</ul> : <EmptyState title={t('activity.empty')} />}
        </> : <div className="grid gap-5"><Alert>{activity.message}</Alert>
          {activity.accountState === 'missing' && activity.registrationPath && <><a className="fastui-button fastui-button--primary whitespace-normal" href={apiUrl(activity.registrationPath)} target="_blank" rel="noopener noreferrer">{t('activity.register', { name })}<ArrowUpRight size={14} className="shrink-0" /></a><small>{t(appId !== 'fast-write' ? 'activity.invitedBindingHint' : 'activity.bindingHint')}</small></>}
          {activity.accountState === 'requires_cas' && <a className="fastui-button fastui-button--secondary whitespace-normal" href={apiUrl('/api/auth/fastcas/login')}>{t('activity.loginLinkedCAS')}<ArrowUpRight size={14} className="shrink-0" /></a>}
        </div>}
    </PanelBody>
  </Section>
}
