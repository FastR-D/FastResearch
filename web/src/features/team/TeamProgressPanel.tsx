import { CalendarCheck,ListTodo,X } from 'lucide-react';
import { type Copy } from '../../shared/copy';
import type { TeamWorkflow } from '../../shared/types';
import { fastTaskStatusKey } from '../today/status';
export function TeamProgressPanel({ members, currentKeyId, loading, onClose, t }: { members: TeamWorkflow[]; currentKeyId: string | null; loading: boolean; onClose?: () => void; t: Copy }) {
  const assigned = members.filter((member) => member.workflow)
  const completed = assigned.reduce((total, member) => total + (member.workflow?.doneCount ?? 0), 0)
  const taskTotal = assigned.reduce((total, member) => total + (member.workflow?.total ?? 0), 0)

  return (
    <section className="team-progress-panel" aria-label={t('team.label')}>
      <div className="team-progress-heading">
        <span className="intel-kicker"><ListTodo size={14} /> {t('team.label')}</span>
        <span className="team-progress-heading-actions">
          <span className="meter-badge">{t('team.people', { count: members.length })}</span>
          {onClose && (
            <button type="button" className="icon-button team-progress-close" onClick={onClose} aria-label={t('dialog.close')} title={t('dialog.close')}>
              <X size={14} />
            </button>
          )}
        </span>
      </div>
      <div className="team-progress-summary">
        {loading ? t('team.syncing') : currentKeyId ? t('team.summary', { done: completed, total: taskTotal }) : t('team.authRequired')}
      </div>
      {currentKeyId && !loading && members.length === 0 && <p className="team-progress-empty">{t('team.empty')}</p>}
      {currentKeyId && members.length > 0 && (
        <div className="team-progress-list">
          {members.map((member) => {
            const memberWorkflow = member.workflow
            const percentage = memberWorkflow?.total ? Math.round(100 * memberWorkflow.doneCount / memberWorkflow.total) : 0
            return (
              <article className={`team-progress-member ${member.keyId === currentKeyId ? 'is-current-member' : ''}`} key={member.keyId}>
                <div className="team-progress-member-heading">
                  <strong>{member.person}{member.keyId === currentKeyId && <small>{t('team.me')}</small>}</strong>
                  <span>{memberWorkflow ? `${memberWorkflow.doneCount}/${memberWorkflow.total} · ${percentage}%` : t('team.unassigned')}</span>
                </div>
                <div className="team-progress-track" role="progressbar" aria-label={t('team.progressAria', { person: member.person })} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${percentage}%` }} />
                </div>
                {memberWorkflow ? (
                  <ul className="team-progress-tasks">
                    {memberWorkflow.tasks.map((task) => (
                      <li className={`is-${task.status}`} key={task.id}>
                        <span className="team-task-status" aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'active' ? '●' : '○'}</span>
                        <span>{task.title}</span>
                        <small>{task.status === 'done' ? t('team.done') : task.status === 'active' ? t('team.active') : t('team.pending')}</small>
                      </li>
                    ))}
                  </ul>
                ) : <p className="team-progress-no-tasks">{t('team.noTasks')}</p>}
                <div className="team-fasttask-today">
                  <div className="team-fasttask-heading">
                    <span><CalendarCheck size={13} /> {t('team.fastTaskToday')}</span>
                    <span>{member.today?.received ? `${member.today.progress.completed}/${member.today.progress.total}` : t('team.noFastTaskToday')}</span>
                  </div>
                  {member.today?.received ? (
                    <ul className="team-fasttask-items">
                      {member.today.items.map((item) => (
                        <li className={`is-${item.status}`} key={item.id}>
                          <span className="team-task-status" aria-hidden="true">{item.status === 'satisfied' ? '✓' : item.status === 'in_progress' ? '●' : item.status === 'skipped' || item.status === 'not_completed' ? '×' : '○'}</span>
                          <span>{item.title}</span>
                          <small>{t(fastTaskStatusKey(item.status))}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="team-progress-no-tasks">{t('team.noFastTaskToday')}</p>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
