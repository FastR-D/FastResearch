import { Alert, Badge, Button, EmptyState, Loading, Section, Toolbar } from '@fastrd/ui-react'
import { RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { APIError, request } from '../../shared/api/client'
import type { Copy } from '../../shared/copy'
import type { AdminSession, FastInsightRoster } from '../../shared/types'
import { PanelBody } from '../../shared/ui/WorkspaceLayout'
import { DEFAULT, RosterGraph, type RosterEdge, type RosterNode } from './RosterGraph'
import { RosterNodeDialog } from './RosterNodeDialog'

type Snapshot = { roster: FastInsightRoster; revision: string; storage: 'database' }
export function FastInsightRosterEditor({ session, onAdminOpen, onSessionExpired, onToast, t }: {
  session: AdminSession | null; onAdminOpen: () => void; onSessionExpired: () => void; onToast: (message: string) => void; t: Copy
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [roster, setRoster] = useState<FastInsightRoster | null>(null)
  const [loading, setLoading] = useState(Boolean(session))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<RosterNode | null>(null)
  const sessionExpiredRef = useRef(onSessionExpired)
  const generation = useRef(0)
  useEffect(() => { sessionExpiredRef.current = onSessionExpired }, [onSessionExpired])
  useEffect(() => {
    const current = ++generation.current
    setEditing(null); setSaving(false); setError(''); setConflict(false)
    if (!session) { setRoster(null); setSnapshot(null); setDirty(false); setLoading(false); return }
    let cancelled = false
    setRoster(null); setSnapshot(null); setDirty(false); setLoading(true)
    void request<Snapshot>('/api/admin/fastinsight/roster', {}, session)
      .then(result => { if (!cancelled) { setSnapshot(result); setRoster(result.roster); setDirty(false) } })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('routing.loadFailed'))
        if (err instanceof APIError && (err.status === 401 || err.status === 403)) sessionExpiredRef.current()
      }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; generation.current = current + 1 }
  }, [session, t, reload])
  const change = (value: FastInsightRoster) => { setRoster(value); setDirty(true); if (!conflict) setError('') }
  const connect = (a: RosterNode, b: RosterNode) => {
    if (!roster || saving) return
    const rank = { keyword: 0, direction: 1, member: 2 }
    const [from, to] = rank[a.kind] < rank[b.kind] ? [a, b] : [b, a]
    const next = structuredClone(roster)
    if (from.kind === 'keyword' && to.kind === 'direction' && from.id !== DEFAULT && to.id !== DEFAULT) {
      const d = next.directions.find(d => d.id === to.id)
      if (!d || d.keywords.includes(from.id)) return
      d.keywords.push(from.id)
    } else if (from.kind === 'direction' && to.kind === 'member') {
      const member = next.members.find(m => m.id === to.id)
      if (!member) return
      if (from.id === DEFAULT) next.default_owner = member
      else {
        const d = next.directions.find(d => d.id === from.id)
        if (!d || d.owners.some(m => m.id === member.id)) return
        d.owners.push(member)
      }
    } else { onToast(t('routing.invalidConnection')); return }
    change(next)
  }
  const remove = (edge: RosterEdge) => {
    if (!roster || saving || edge.fixed) return
    const next = structuredClone(roster)
    if (edge.from.kind === 'keyword') next.directions.forEach(d => { if (d.id === edge.to.id) d.keywords = d.keywords.filter(k => k !== edge.from.id) })
    else if (edge.from.id === DEFAULT) delete next.default_owner
    else next.directions.forEach(d => { if (d.id === edge.from.id) d.owners = d.owners.filter(m => m.id !== edge.to.id) })
    change(next)
  }
  const save = async () => {
    if (!session || !roster || !snapshot || saving) return
    const current = generation.current
    setSaving(true); setError('')
    try {
      const result = await request<Snapshot>('/api/admin/fastinsight/roster', { method: 'PUT', body: JSON.stringify({ roster, revision: snapshot.revision }) }, session)
      if (generation.current !== current) return
      setSnapshot(result); setRoster(result.roster); setDirty(false); setConflict(false); onToast(t('routing.saved'))
    } catch (err) {
      if (generation.current !== current) return
      setError(err instanceof Error ? err.message : t('routing.saveFailed'))
      if (err instanceof APIError && err.status === 409) setConflict(true)
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) sessionExpiredRef.current()
    } finally { if (generation.current === current) setSaving(false) }
  }
  return <section aria-label={t('workspace.routing')} className="grid gap-6 md:gap-8 min-w-0">
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="fastui-heading min-w-0 text-2xl">{t('workspace.routing')}</h1>
      {session && <Toolbar label={t('routing.actionsAria')}>
        <Button variant="quiet" onClick={() => { if (snapshot) { setRoster(snapshot.roster); setDirty(false); setError('') } }} disabled={!dirty || saving || loading || conflict}><RotateCcw size={14} />{t('routing.reset')}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={loading || !roster || !dirty || conflict} loading={saving}><Save size={15} />{saving ? t('routing.saving') : t('routing.save')}</Button>
      </Toolbar>}
      {dirty && <Badge tone="warning">{t('routing.unsaved')}</Badge>}
    </div>
    <Section><PanelBody>
      {!session ? <EmptyState title={t('routing.adminRequired')} action={<Button variant="secondary" onClick={onAdminOpen}><ShieldCheck size={15} />{t('routing.openAdmin')}</Button>}><p>{t('routing.adminRequiredHint')}</p></EmptyState> : <div className="grid gap-3 min-w-0">
        {error && <Alert tone="danger">{error}</Alert>}
        {(conflict || error && !roster) && <Button variant="secondary" onClick={() => setReload(v => v + 1)}>{t(conflict ? 'routing.reloadConflict' : 'routing.retry')}</Button>}
        {loading ? <Loading label={t('routing.loading')} /> : roster && <>
          <RosterGraph roster={roster} disabled={saving} onEdit={setEditing} onAdd={kind => setEditing({ kind, id: '' })} onConnect={connect} onRemove={remove} t={t} />
          {!roster.default_owner && <p className="text-xs">{t('routing.noDefault')}</p>}
          {editing && <RosterNodeDialog node={editing} roster={roster} onApply={value => { change(value); setEditing(null) }} onClose={() => setEditing(null)} t={t} />}
        </>}
      </div>}
    </PanelBody></Section>
  </section>
}
