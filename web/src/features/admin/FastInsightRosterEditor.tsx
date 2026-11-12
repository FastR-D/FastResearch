import { Alert, Badge, Button, EmptyState, Loading, PanelHeader, Section, TextArea, TextField, Toolbar } from '@fastrd/ui-react'
import { Plus,Save,Settings2,ShieldCheck,Trash2,UsersRound,X } from 'lucide-react'
import { FormEvent,useEffect,useRef,useState } from 'react'
import { request } from '../../shared/api/client'
import { type Copy } from '../../shared/copy'
import type { AdminSession,FastInsightRoster,RosterDirection,RosterOwner } from '../../shared/types'
export function FastInsightRosterEditor({ session, onAdminOpen, onSessionExpired, onToast, t }: {
  session: AdminSession | null
  onAdminOpen: () => void
  onSessionExpired: () => void
  onToast: (message: string) => void
  t: Copy
}) {
  const [roster, setRoster] = useState<FastInsightRoster | null>(null)
  const [revision, setRevision] = useState('')
  const [fileName, setFileName] = useState('colleagues.yaml')
  const [loading, setLoading] = useState(Boolean(session))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const sessionExpiredRef = useRef(onSessionExpired)

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired
  }, [onSessionExpired])

  useEffect(() => {
    if (!session) {
      setRoster(null)
      setRevision('')
      setDirty(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void request<{ roster: FastInsightRoster; revision: string; file: string }>('/api/admin/fastinsight/roster', {}, session)
      .then((result) => {
        if (cancelled) return
        setRoster(result.roster)
        setRevision(result.revision)
        setFileName(result.file)
        setDirty(false)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('routing.loadFailed')
        setError(message)
        if (message.includes('管理员登录已过期') || message.includes('管理员登录已失效')) sessionExpiredRef.current()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [session, t])

  const changeRoster = (change: (value: FastInsightRoster) => FastInsightRoster) => {
    setRoster((current) => current ? change(current) : current)
    setDirty(true)
    setError('')
  }

  const changeDirection = (index: number, patch: Partial<RosterDirection>) => {
    changeRoster((current) => ({
      ...current,
      directions: current.directions.map((direction, itemIndex) => itemIndex === index ? { ...direction, ...patch } : direction),
    }))
  }

  const changeOwner = (directionIndex: number, ownerIndex: number, patch: Partial<RosterOwner>) => {
    changeRoster((current) => ({
      ...current,
      directions: current.directions.map((direction, itemIndex) => itemIndex !== directionIndex ? direction : {
        ...direction,
        owners: direction.owners.map((owner, index) => index === ownerIndex ? { ...owner, ...patch } : owner),
      }),
    }))
  }

  const addDirection = () => {
    changeRoster((current) => ({
      ...current,
      directions: [...current.directions, { name: '', keywords: [], owners: [{ name: '', feishu_open_id: '' }] }],
    }))
  }

  const addOwner = (directionIndex: number) => {
    changeRoster((current) => ({
      ...current,
      directions: current.directions.map((direction, index) => index === directionIndex ? {
        ...direction,
        owners: [...direction.owners, { name: '', feishu_open_id: '' }],
      } : direction),
    }))
  }

  const changeDefaultOwner = (patch: Partial<RosterOwner>) => {
    changeRoster((current) => {
      const next = {
        ...(current.default_owner ?? { name: '', feishu_open_id: '' }),
        ...patch,
        name: patch.name ?? current.default_owner?.name ?? '',
        feishu_open_id: patch.feishu_open_id ?? current.default_owner?.feishu_open_id ?? '',
      }
      const value = { ...current }
      if (!next.name.trim() && !next.feishu_open_id.trim()) delete value.default_owner
      else value.default_owner = next
      return value
    })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!session || !roster) return
    setSaving(true)
    setError('')
    try {
      const result = await request<{ roster: FastInsightRoster; revision: string; file: string }>('/api/admin/fastinsight/roster', {
        method: 'PUT',
        body: JSON.stringify({
          roster: {
            ...roster,
            directions: roster.directions.map((direction) => ({
              ...direction,
              keywords: direction.keywords.filter(Boolean),
            })),
          },
          revision,
        }),
      }, session)
      setRoster(result.roster)
      setRevision(result.revision)
      setFileName(result.file)
      setDirty(false)
      onToast(t('routing.saved'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('routing.saveFailed')
      setError(message)
      if (message.includes('管理员登录已过期') || message.includes('管理员登录已失效')) sessionExpiredRef.current()
    } finally {
      setSaving(false)
    }
  }

  if (!session) return <EmptyState title={t('routing.adminRequired')} action={<Button variant="secondary" onClick={onAdminOpen}><ShieldCheck size={15} />{t('routing.openAdmin')}</Button>}><p>{t('routing.adminRequiredHint')}</p></EmptyState>

  const ownerCount = roster?.directions.reduce((count, direction) => count + direction.owners.length, 0) ?? 0
  const keywordCount = roster?.directions.reduce((count, direction) => count + direction.keywords.filter(Boolean).length, 0) ?? 0
  return <form onSubmit={save} aria-label={t('routing.title')} className="grid gap-4">
    <PanelHeader><Settings2 size={14} /><h2>{t('routing.title')}</h2></PanelHeader>
    <p>{t('routing.description')} <code className="break-all">{fileName}</code></p>
    <Toolbar label="分发名册操作">
      {dirty && <Badge tone="warning">{t('routing.unsaved')}</Badge>}
      <Button variant="secondary" onClick={addDirection} disabled={loading || !roster}><Plus size={15} />{t('routing.addDirection')}</Button>
      <Button variant="primary" type="submit" disabled={loading || !roster} loading={saving}><Save size={15} />{saving ? t('routing.saving') : t('routing.save')}</Button>
    </Toolbar>
    <div className="flex flex-wrap gap-2"><Badge>{t('routing.directionCount')} {roster?.directions.length ?? 0}</Badge><Badge>{t('routing.ownerCount')} {ownerCount}</Badge><Badge>{t('routing.keywordCount')} {keywordCount}</Badge></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {loading ? <Loading label={t('routing.loading')} /> : roster && <>
      {!roster.directions.length && <EmptyState title={t('routing.empty')} />}
      {roster.directions.map((direction, directionIndex) => <Section key={directionIndex}>
        <PanelHeader className="justify-between"><h3>研究方向 {directionIndex + 1}</h3><Button variant="icon" aria-label={t('routing.removeDirection')} onClick={() => changeRoster(current => ({ ...current, directions: current.directions.filter((_, index) => index !== directionIndex) }))}><Trash2 size={15} /></Button></PanelHeader>
        <div className="fastui-modal-body">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="fastui-field">{t('routing.directionName')}<TextField value={direction.name} onChange={event => changeDirection(directionIndex, { name: event.target.value })} placeholder={t('routing.directionPlaceholder')} required /></label>
            <label className="fastui-field">{t('routing.priority')}<TextField type="number" value={direction.priority ?? ''} onChange={event => changeDirection(directionIndex, { priority: event.target.value === '' ? undefined : Number(event.target.value) })} min="0" /></label>
          </div>
          <label className="fastui-field">{t('routing.keywords')}<small>{t('routing.keywordsHint')}</small><TextArea value={direction.keywords.join('\n')} onChange={event => changeDirection(directionIndex, { keywords: event.target.value.split(/\r?\n/).map(keyword => keyword.trim()) })} placeholder={t('routing.keywordsPlaceholder')} rows={4} /></label>
          <Toolbar label="研究方向负责人"><UsersRound size={15} />{t('routing.owners')}<Button variant="quiet" onClick={() => addOwner(directionIndex)}><Plus size={14} />{t('routing.addOwner')}</Button></Toolbar>
          {direction.owners.map((owner, ownerIndex) => <div className="grid sm:grid-cols-2 gap-3 items-end" key={ownerIndex}>
            <label className="fastui-field">{t('routing.ownerName')}<TextField value={owner.name} onChange={event => changeOwner(directionIndex, ownerIndex, { name: event.target.value })} placeholder={t('routing.ownerNamePlaceholder')} required /></label>
            <label className="fastui-field">{t('routing.feishuOpenId')}<TextField value={owner.feishu_open_id ?? ''} onChange={event => changeOwner(directionIndex, ownerIndex, { feishu_open_id: event.target.value })} placeholder={t('routing.feishuPlaceholder')} /></label>
            <Button variant="secondary" aria-label={t('routing.removeOwner')} onClick={() => changeDirection(directionIndex, { owners: direction.owners.filter((_, index) => index !== ownerIndex) })}><X size={15} />{t('routing.removeOwner')}</Button>
          </div>)}
        </div>
      </Section>)}
      <Section>
        <PanelHeader><ShieldCheck size={16} /><h3>{t('routing.defaultOwner')}</h3></PanelHeader>
        <div className="fastui-modal-body"><p>{t('routing.defaultOwnerHint')}</p><div className="grid sm:grid-cols-2 gap-4">
          <label className="fastui-field">{t('routing.ownerName')}<TextField value={roster.default_owner?.name ?? ''} onChange={event => changeDefaultOwner({ name: event.target.value })} placeholder={t('routing.ownerNamePlaceholder')} /></label>
          <label className="fastui-field">{t('routing.feishuOpenId')}<TextField value={roster.default_owner?.feishu_open_id ?? ''} onChange={event => changeDefaultOwner({ feishu_open_id: event.target.value })} placeholder={t('routing.feishuPlaceholder')} /></label>
        </div></div>
      </Section>
    </>}
  </form>
}
