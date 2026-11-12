import { PanelBody, PanelHeading, PanelRow } from '../../shared/ui/WorkspaceLayout'
import { Badge, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { CalendarCheck, ListTodo, X } from 'lucide-react'
import type { Copy } from '../../shared/copy'
import type { TeamWorkflow } from '../../shared/types'
import { fastTaskStatusKey } from '../today/status'
export function TeamProgressPanel({ members, currentKeyId, loading, onClose, t }: { members: TeamWorkflow[]; currentKeyId: string | null; loading: boolean; onClose?: () => void; t: Copy }) {
  const assigned = members.filter(member => member.workflow)
  const completed = assigned.reduce((total, member) => total + (member.workflow?.doneCount ?? 0), 0)
  const taskTotal = assigned.reduce((total, member) => total + (member.workflow?.total ?? 0), 0)
  return <Section aria-label={t('team.label')}>
    <PanelHeading><ListTodo size={16} /><h2>{t('team.label')}</h2><Badge>{t('team.people', { count: members.length })}</Badge>{onClose && <Button variant="icon" onClick={onClose} aria-label={t('dialog.close')}><X size={14} /></Button>}</PanelHeading>
    <PanelBody>
      {!currentKeyId ? <EmptyState title={t('team.authRequired')} /> : loading ? <Loading label={t('team.syncing')} /> : <>
        <p>{t('team.summary', { done: completed, total: taskTotal })}</p>
        {members.length === 0 && <EmptyState title={t('team.empty')} />}
        {members.map(member => {
          const workflow = member.workflow
          const percentage = workflow?.total ? Math.round(100 * workflow.doneCount / workflow.total) : 0
          return <Section key={member.keyId}>
            <PanelHeading><h3>{member.person}</h3>{member.keyId === currentKeyId && <Badge>{t('team.me')}</Badge>}<span>{workflow ? `${workflow.doneCount}/${workflow.total} · ${percentage}%` : t('team.unassigned')}</span></PanelHeading>
            <PanelBody>
              <progress className="fastui-progress w-full" aria-label={t('team.progressAria', { person: member.person })} value={percentage} max={100} />
              {workflow ? <ul>{workflow.tasks.map(task => <li key={task.id}><PanelRow><span className="flex-1 min-w-0 break-words">{task.title}</span><Badge tone={task.status === 'done' ? 'success' : task.status === 'active' ? 'info' : 'warning'}>{task.status === 'done' ? t('team.done') : task.status === 'active' ? t('team.active') : t('team.pending')}</Badge></PanelRow></li>)}</ul> : <p>{t('team.noTasks')}</p>}
              <PanelHeading><CalendarCheck size={14} />{t('team.fastTaskToday')}<span>{member.today?.received ? `${member.today.progress.completed}/${member.today.progress.total}` : t('team.noFastTaskToday')}</span></PanelHeading>
              {member.today?.received ? <ul>{member.today.items.map(item => <li key={item.id}><PanelRow><span className="flex-1 min-w-0 break-words">{item.title}</span><Badge tone={item.status === 'satisfied' ? 'success' : 'info'}>{t(fastTaskStatusKey(item.status))}</Badge></PanelRow></li>)}</ul> : <p>{t('team.noFastTaskToday')}</p>}
            </PanelBody>
          </Section>
        })}
      </>}
    </PanelBody>
  </Section>
}
