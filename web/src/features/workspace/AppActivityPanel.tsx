import { Alert, Badge, Button, EmptyState, Loading, PanelHeader, Section } from '@fastrd/ui-react'
import { ArrowUpRight, Bell, BookOpenText, FileText, MessageSquare, RefreshCw } from 'lucide-react'
import { apiUrl } from '../../shared/api/client'
import { formatTime } from '../../shared/lib/format'
import type { MemberSession } from '../../shared/types'
import { useAppActivity } from './use-app-activity'

export function AppActivityPanel({ appId, name, member, onLogin }: { appId: string; name: string; member: MemberSession | null; onLogin: () => void }) {
  const { activity, error, refresh } = useAppActivity(appId, member)
  if (!['fast-read', 'fast-news', 'fast-write'].includes(appId)) return null
  const descriptions: Record<string, string> = {
    'fast-read': '资料库论文、阅读报告、笔记更新与处理进度',
    'fast-news': '未读订阅、新收录论文与研究简报',
    'fast-write': '未读评论、@提及与最近项目更新',
  }
  const Icon = appId === 'fast-write' ? MessageSquare : appId === 'fast-read' ? BookOpenText : Bell
  return <Section aria-label={`${name} 个人动态`}>
    <PanelHeader><Icon size={16} /><h3>个人动态</h3>{member && <Button variant="icon" aria-label={`刷新 ${name} 动态`} onClick={refresh}><RefreshCw size={15} /></Button>}</PanelHeader>
    <div className="fastui-modal-body">
      <p>{descriptions[appId]}</p>
      {!member ? <EmptyState title="登录后查看个人动态" action={<Button variant="secondary" onClick={onLogin}>使用 Key 或 FastCAS 登录<ArrowUpRight size={14} /></Button>}><p>登录后，查看此账号在 {name} 的最新进展。</p></EmptyState>
        : error ? <Alert tone="danger">{error}</Alert>
        : !activity ? <Loading label="正在读取个人动态…" />
        : activity.accountState === 'active' ? <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">{activity.metrics.map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd><Badge>{metric.value.toLocaleString('zh-CN')}</Badge></dd></div>)}</dl>
          {activity.items.length ? <ul>{activity.items.map(item => <li key={item.id}><a className="fastui-list-row" href={item.path} target="_blank" rel="noopener noreferrer">{item.kind === 'comment' || item.kind === 'mention' ? <MessageSquare size={16} className="shrink-0" /> : <FileText size={16} className="shrink-0" />}<span className="min-w-0 break-words"><strong>{item.title}</strong><small className="block">{item.description}{item.occurredAt && ` · ${formatTime(item.occurredAt)}`}</small></span><ArrowUpRight size={15} className="shrink-0" /></a></li>)}</ul> : <EmptyState title="账号已连接，暂时没有新的动态。" />}
        </> : <div className="grid gap-3"><Alert>{activity.message}</Alert>
          {activity.accountState === 'missing' && activity.registrationPath && <><a className="fastui-button fastui-button--primary whitespace-normal" href={apiUrl(activity.registrationPath)} target="_blank" rel="noopener noreferrer">注册 / 开通 {name} 账号<ArrowUpRight size={14} className="shrink-0" /></a><small>{appId !== 'fast-write' && '此应用需管理员邀请；'}已有账号请在对应应用中绑定同一 FastCAS 身份。</small></>}
          {activity.accountState === 'requires_cas' && <a className="fastui-button fastui-button--secondary whitespace-normal" href={apiUrl('/api/auth/fastcas/login')}>使用关联的 FastCAS 账号登录<ArrowUpRight size={14} className="shrink-0" /></a>}
        </div>}
    </div>
  </Section>
}
