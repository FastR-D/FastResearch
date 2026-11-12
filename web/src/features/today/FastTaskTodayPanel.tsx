import { CalendarCheck,CalendarClock,CheckCircle2,Circle,CircleDot,Clock,ExternalLink,KeyRound,LockKeyhole,RefreshCw,X } from 'lucide-react'
import { type Copy } from '../../shared/copy'
import type { FastTaskToday,MemberSession } from '../../shared/types'
import { fastTaskStatusKey } from './status'
function FastTaskStatusIcon({ status }: { status: string }) {
  if (status === 'satisfied') return <CheckCircle2 size={16} />
  if (status === 'in_progress') return <CircleDot size={16} />
  if (status === 'skipped' || status === 'not_completed') return <X size={16} />
  return <Circle size={16} />
}

export function FastTaskTodayPanel({ member, today, onUnlock, onRefresh, onOpenFastTask, t }: {
  member: MemberSession | null
  today: FastTaskToday | null
  onUnlock: () => void
  onRefresh: () => void
  onOpenFastTask: () => void
  t: Copy
}) {
  if (!member) {
    return (
      <section className="fasttask-today-panel is-locked" aria-label={t('today.title')}>
        <div className="fasttask-today-empty">
          <span className="fasttask-today-empty-icon"><LockKeyhole size={30} /></span>
          <strong>{t('today.locked')}</strong>
          <p>{t('today.lockedHint')}</p>
          <button type="button" className="primary-button" onClick={onUnlock}>{t('board.authenticate')} <KeyRound size={14} /></button>
        </div>
      </section>
    )
  }
  const items = today?.items ?? []
  const progress = today?.progress ?? { total: 0, completed: 0, inProgress: 0, planned: 0, skipped: 0 }
  const percentage = progress.total ? Math.round(100 * progress.completed / progress.total) : 0

  return (
    <section className="fasttask-today-panel" aria-label={t('today.title')}>
      <header className="fasttask-today-head">
        <div>
          <span className="intel-kicker"><CalendarCheck size={14} /> {t('today.kicker')}</span>
          <h2>{t('today.title')}</h2>
          <p>{today?.date ? t('today.date', { date: today.date }) : t('today.syncing')}</p>
        </div>
        <div className="fasttask-today-actions">
          <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={14} /> {t('today.refresh')}</button>
          <button type="button" className="primary-button" onClick={onOpenFastTask}><ExternalLink size={14} /> {t('header.fastTask')}</button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="fasttask-today-empty">
          <span className="fasttask-today-empty-icon"><CalendarClock size={30} /></span>
          <strong>{t('today.empty')}</strong>
          <p>{t('today.emptyHint')}</p>
          {today?.error && <small role="status">{t('today.error')}</small>}
        </div>
      ) : (
        <>
          <div className="fasttask-today-progress">
            <div className="fasttask-today-progress-copy">
              <strong>{t('today.progress', { done: progress.completed, total: progress.total })}</strong>
              <span>{percentage}%</span>
            </div>
            <div className="fasttask-today-track" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${percentage}%` }} />
            </div>
            <div className="fasttask-today-stats">
              {progress.inProgress > 0 && <span>{t('today.inProgress', { count: progress.inProgress })}</span>}
              <span>{t('today.planned', { count: progress.planned })}</span>
              {progress.skipped > 0 && <span>{t('today.skipped', { count: progress.skipped })}</span>}
            </div>
          </div>
          <ul className="fasttask-today-items">
            {items.map((item) => (
              <li className={`is-${item.status}`} key={item.id}>
                <span className="fasttask-today-status" aria-hidden="true"><FastTaskStatusIcon status={item.status} /></span>
                <div className="fasttask-today-item-copy">
                  <strong>{item.title}</strong>
                  {item.minimumAction && <p>{item.minimumAction}</p>}
                  {item.completionSummary && <p className="fasttask-today-summary">{item.completionSummary}</p>}
                </div>
                <span className="fasttask-today-item-meta">
                  <em>{t(fastTaskStatusKey(item.status))}</em>
                  {item.targetMinutes ? <small><Clock size={12} /> {t('today.minutes', { count: item.targetMinutes })}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
