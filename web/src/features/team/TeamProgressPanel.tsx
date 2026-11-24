import { PanelBody, PanelHeading, PanelRow } from '../../shared/ui/WorkspaceLayout'
import { Alert, Badge, Button, EmptyState, Loading, Section } from '@fastrd/ui-react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Copy } from '../../shared/copy'
import type { TeamWorkflow, WorkspaceApp } from '../../shared/types'
import { taskStatusKey } from '../today/status'

const paneHeader = 'flex h-24 shrink-0 items-center gap-x-2 border-b border-[var(--fastui-border)] sm:h-16'

function canSwitchAtEdge(pane: HTMLElement, direction: number) {
  return direction < 0 ? pane.scrollTop <= 1 : pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 1
}

export function TeamProgressPanel({ members, currentKeyId, loading, desktop, app, t }: { members: TeamWorkflow[]; currentKeyId: string | null; loading: boolean; desktop: boolean; app?: WorkspaceApp; t: Copy }) {
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const selected = members.find(member => member.keyId === selectedKeyId)
    ?? members.find(member => member.keyId === currentKeyId)
    ?? members[0]
  const memberIndex = selected ? members.indexOf(selected) : -1
  const sidebar = useRef<HTMLElement>(null)
  const memberList = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLElement>(null)
  const lastWheel = useRef<{ pane: HTMLElement; direction: number; time: number } | null>(null)
  const showMembers = !!currentKeyId && !loading && !!selected

  useLayoutEffect(() => {
    if (!desktop || !showMembers) return
    const pane = detail.current
    const list = memberList.current
    if (pane) pane.scrollTop = 0
    const active = list?.querySelector('button[aria-current="true"]')
    if (!list || !active) return
    const row = active.getBoundingClientRect()
    const viewport = list.getBoundingClientRect()
    if (row.top < viewport.top) list.scrollTop += row.top - viewport.top
    else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom
  }, [desktop, selected?.keyId, showMembers])

  useEffect(() => {
    const listPane = sidebar.current
    const detailPane = detail.current
    if (!desktop || !showMembers || !listPane || !detailPane || members.length < 2) return

    const subscribe = (pane: HTMLElement, isSidebar: boolean) => {
      let touch: { x: number; y: number; atTop: boolean; atBottom: boolean } | null = null
      const onWheel = (event: WheelEvent) => {
        if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
        const direction = Math.sign(event.deltaY)
        const previous = lastWheel.current
        // A trackpad gesture can emit wheel events after the member has changed.
        if (previous?.pane === pane && previous.direction === direction && event.timeStamp - previous.time < 180) {
          previous.time = event.timeStamp
          event.preventDefault()
          return
        }
        const next = members[memberIndex + direction]
        if (!next || (!isSidebar && !canSwitchAtEdge(pane, direction))) return
        event.preventDefault()
        lastWheel.current = { pane, direction, time: event.timeStamp }
        setSelectedKeyId(next.keyId)
      }
      const onTouchStart = (event: TouchEvent) => {
        const start = event.touches[0]
        touch = event.touches.length === 1 ? {
          x: start.clientX,
          y: start.clientY,
          atTop: canSwitchAtEdge(pane, -1),
          atBottom: canSwitchAtEdge(pane, 1),
        } : null
      }
      const onTouchEnd = (event: TouchEvent) => {
        const start = touch
        touch = null
        if (!start || event.touches.length || !event.changedTouches.length) return
        const end = event.changedTouches[0]
        const delta = start.y - end.clientY
        if (Math.abs(delta) < 40 || Math.abs(delta) <= Math.abs(start.x - end.clientX)) return
        const direction = Math.sign(delta)
        const next = members[memberIndex + direction]
        const startedAtEdge = direction < 0 ? start.atTop : start.atBottom
        if (next && (isSidebar || (startedAtEdge && canSwitchAtEdge(pane, direction)))) setSelectedKeyId(next.keyId)
      }
      pane.addEventListener('wheel', onWheel, { passive: false })
      pane.addEventListener('touchstart', onTouchStart, { passive: true })
      pane.addEventListener('touchend', onTouchEnd, { passive: true })
      return () => {
        pane.removeEventListener('wheel', onWheel)
        pane.removeEventListener('touchstart', onTouchStart)
        pane.removeEventListener('touchend', onTouchEnd)
      }
    }
    const unsubscribeSidebar = subscribe(listPane, true)
    const unsubscribeDetail = subscribe(detailPane, false)
    return () => {
      unsubscribeSidebar()
      unsubscribeDetail()
    }
  }, [desktop, memberIndex, members, showMembers])

  if (!showMembers || !selected) return <Section aria-label={t('team.label')}>
    <PanelBody>
      {!currentKeyId ? <EmptyState title={t('team.authRequired')} /> : loading ? <Loading label={t('team.syncing')} /> : <EmptyState title={t('team.empty')} />}
    </PanelBody>
  </Section>

  if (!desktop) return <section className="grid min-w-0 gap-4" aria-label={t('team.label')}>
    {members.map(member => <Section key={member.keyId} aria-label={member.person}>
      <PanelHeading>
        <h2 className="fastui-heading min-w-0 break-words text-lg">{member.person}</h2>
        {member.keyId === currentKeyId && <Badge>{t('team.me')}</Badge>}
      </PanelHeading>
      <MemberTasks member={member} app={app} t={t} />
    </Section>)}
  </section>

  const previousMember = members[memberIndex - 1]
  const nextMember = members[memberIndex + 1]

  return <Section aria-label={t('team.label')} className="grid min-h-0 flex-1 grid-cols-[minmax(0,34%)_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)] overflow-hidden">
    <nav ref={sidebar} aria-labelledby="team-members-heading" className="flex min-h-0 min-w-0 flex-col border-r border-[var(--fastui-border)]">
      <div className={`${paneHeader} flex-wrap content-center px-2 sm:px-4`}>
        <h2 id="team-members-heading" className="fastui-heading">{t('team.members')}</h2>
        <span className="text-xs text-[var(--fastui-secondary)]">{t('team.people', { count: members.length })}</span>
      </div>
      <div ref={memberList} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 sm:p-2">
        <ul className="grid gap-1">
          {members.map(member => {
            const active = member.keyId === selected.keyId
            return <li key={member.keyId} className="min-w-0">
              <Button variant={active ? 'primary' : 'navigation'} className="w-full" aria-current={active || undefined} aria-controls="team-member-detail" title={member.person} onClick={() => setSelectedKeyId(member.keyId)}>
                <span className={`w-full min-w-0 truncate text-left ${active ? 'font-semibold' : 'font-medium'}`}>{member.person}</span>
              </Button>
            </li>
          })}
        </ul>
      </div>
    </nav>
    <article ref={detail} id="team-member-detail" aria-labelledby="team-member-name" tabIndex={0} className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
      <div className={`${paneHeader} sticky top-0 z-10 flex-wrap content-center justify-between bg-[var(--fastui-surface)] px-3 sm:flex-nowrap sm:px-5`}>
        <div className="flex min-w-0 items-center gap-x-2" aria-live="polite">
          <h2 id="team-member-name" className="fastui-heading min-w-0 truncate text-lg" title={selected.person}>{selected.person}</h2>
          {selected.keyId === currentKeyId && <Badge>{t('team.me')}</Badge>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="icon" size="sm" aria-label={t('team.previousMember')} title={t('team.previousMember')} disabled={!previousMember} onClick={() => setSelectedKeyId(previousMember.keyId)}><ChevronUp size={16} /></Button>
          <Button variant="icon" size="sm" aria-label={t('team.nextMember')} title={t('team.nextMember')} disabled={!nextMember} onClick={() => setSelectedKeyId(nextMember.keyId)}><ChevronDown size={16} /></Button>
        </div>
      </div>
      <MemberTasks member={selected} app={app} t={t} />
    </article>
  </Section>
}

function MemberTasks({ member, app, t }: { member: TeamWorkflow; app?: WorkspaceApp; t: Copy }) {
  const appSummary = app ? member.apps?.[app.id] : undefined
  const today = appSummary?.tasks
  const syncError = appSummary && appSummary.accountState !== 'active' ? appSummary.message ?? t('team.tasksUnsynced') : ''
  const workflow = member.workflow
  const percentage = workflow?.total ? Math.round(100 * workflow.doneCount / workflow.total) : 0
  const todayHeading = app ? t('team.appToday', { name: app.name ?? t('tasks.appName') }) : t('team.appTasks')

  return <div className="grid gap-5 p-3 sm:p-5">
    <section className="grid gap-3" aria-label={t('team.workflow')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3 className="fastui-heading">{t('team.workflow')}</h3>
        <span>{workflow ? t('team.workflowProgress', { done: workflow.doneCount, total: workflow.total, percent: percentage }) : t('team.unassigned')}</span>
      </div>
      {workflow && <progress className="fastui-progress w-full" aria-label={t('team.progressAria', { person: member.person })} value={percentage} max={100} />}
      {workflow?.tasks.length ? <ul>{workflow.tasks.map(task => <li key={task.id}><PanelRow>
        <div className="min-w-0 flex-[1_1_9rem] break-words"><strong>{task.title}</strong>{task.description && <p>{task.description}</p>}</div>
        <Badge tone={task.status === 'done' ? 'success' : task.status === 'active' ? 'info' : 'warning'}>{task.status === 'done' ? t('team.done') : task.status === 'active' ? t('team.active') : t('team.pending')}</Badge>
      </PanelRow></li>)}</ul> : <p>{t('team.noTasks')}</p>}
    </section>
    <section className="grid gap-3 border-t border-[var(--fastui-border)] pt-5" aria-label={todayHeading}>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3 className="fastui-heading">{todayHeading}</h3>
        {syncError ? <span>{t('team.syncIncomplete')}</span> : today?.received && <span>{t('team.taskProgress', { done: today.progress.completed, total: today.progress.total })}</span>}
      </div>
      {syncError ? <Alert tone="warning">{syncError}</Alert> : today?.received && today.items.length ? <ul>{today.items.map(item => <li key={item.id}><PanelRow>
        <div className="min-w-0 flex-[1_1_9rem] break-words">
          <strong>{item.title}</strong>
          {item.minimumAction && <p>{item.minimumAction}</p>}
          {item.completionSummary && <p>{item.completionSummary}</p>}
          {item.targetMinutes ? <small>{t('today.minutes', { count: item.targetMinutes })}</small> : null}
        </div>
        <Badge tone={item.status === 'satisfied' ? 'success' : 'info'}>{t(taskStatusKey(item.status))}</Badge>
      </PanelRow></li>)}</ul> : <p>{t('team.noTodayTasks')}</p>}
    </section>
  </div>
}
