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
  return <section className="ws-activity" aria-label={`${name} 个人动态`}>
    <div className="ws-activity-heading"><span><Icon size={17} /><strong>个人动态</strong></span>{member && <button type="button" className="icon-button" aria-label={`刷新 ${name} 动态`} onClick={refresh}><RefreshCw size={15} /></button>}</div>
    <p className="ws-activity-description">{descriptions[appId]}</p>
    {!member ? <div className="ws-activity-empty"><p>登录后，查看此账号在 {name} 的最新进展。</p><button type="button" className="outline-button" onClick={onLogin}>使用 Key 或 FastCAS 登录<ArrowUpRight size={14} /></button></div>
      : error ? <p role="status">{error}</p>
      : !activity ? <p role="status">正在读取个人动态…</p>
      : activity.accountState === 'active' ? <>
        <div className="ws-activity-metrics">{activity.metrics.map(metric => <div key={metric.id}><strong>{metric.value.toLocaleString('zh-CN')}</strong><span>{metric.label}</span></div>)}</div>
        {activity.items.length ? <ul className="ws-activity-items">{activity.items.map(item => <li key={item.id}><a href={item.path} target="_blank" rel="noopener noreferrer"><span className="ws-activity-item-icon">{item.kind === 'comment' || item.kind === 'mention' ? <MessageSquare size={16} /> : <FileText size={16} />}</span><span><strong>{item.title}</strong><small>{item.description}{item.occurredAt && ` · ${formatTime(item.occurredAt)}`}</small></span><ArrowUpRight size={15} /></a></li>)}</ul> : <p className="ws-activity-empty">账号已连接，暂时没有新的动态。</p>}
      </> : <div className="ws-activity-empty"><p>{activity.message}</p>
        {activity.accountState === 'missing' && activity.registrationPath && <><a className="primary-button" href={apiUrl(activity.registrationPath)} target="_blank" rel="noopener noreferrer">注册 / 开通 {name} 账号<ArrowUpRight size={14} /></a><small>{appId !== 'fast-write' && '此应用需管理员邀请；'}已有账号请在对应应用中绑定同一 FastCAS 身份。</small></>}
        {activity.accountState === 'requires_cas' && <a className="outline-button" href={apiUrl('/api/auth/fastcas/login')}>使用关联的 FastCAS 账号登录<ArrowUpRight size={14} /></a>}
      </div>}
  </section>
}
