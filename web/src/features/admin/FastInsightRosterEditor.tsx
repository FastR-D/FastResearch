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

  if (!session) {
    return (
      <section className="roster-editor roster-editor--locked" aria-label={t('routing.title')}>
        <div className="mailbox-locked">
          <div className="locked-icon-wrap"><Settings2 size={25} /></div>
          <strong>{t('routing.adminRequired')}</strong>
          <p>{t('routing.adminRequiredHint')}</p>
          <button type="button" className="outline-button" onClick={onAdminOpen}><ShieldCheck size={15} /> {t('routing.openAdmin')}</button>
        </div>
      </section>
    )
  }

  const ownerCount = roster?.directions.reduce((count, direction) => count + direction.owners.length, 0) ?? 0
  const keywordCount = roster?.directions.reduce((count, direction) => count + direction.keywords.filter(Boolean).length, 0) ?? 0

  return (
    <form className="roster-editor" onSubmit={save} aria-label={t('routing.title')}>
      <header className="roster-editor-header">
        <div>
          <span className="workspace-kicker"><Settings2 size={14} /> FASTINSIGHT / ROUTING</span>
          <h2>{t('routing.title')}</h2>
          <p>{t('routing.description')} <code>{fileName}</code></p>
        </div>
        <div className="roster-editor-actions">
          {dirty && <span className="roster-dirty">{t('routing.unsaved')}</span>}
          <button type="button" className="outline-button" onClick={addDirection}><Plus size={15} /> {t('routing.addDirection')}</button>
          <button type="submit" className="primary-button" disabled={loading || saving || !roster}>
            <Save size={15} /> {saving ? t('routing.saving') : t('routing.save')}
          </button>
        </div>
      </header>

      <div className="roster-stats">
        <div><strong>{roster?.directions.length ?? 0}</strong><span>{t('routing.directionCount')}</span></div>
        <div><strong>{ownerCount}</strong><span>{t('routing.ownerCount')}</span></div>
        <div><strong>{keywordCount}</strong><span>{t('routing.keywordCount')}</span></div>
      </div>

      {error && <div className="roster-error" role="alert">{error}</div>}
      {loading ? (
        <div className="roster-loading">{t('routing.loading')}</div>
      ) : roster && (
        <>
          <div className="roster-direction-list">
            {roster.directions.length === 0 && <div className="roster-empty">{t('routing.empty')}</div>}
            {roster.directions.map((direction, directionIndex) => (
              <article className="roster-direction-card" key={`${directionIndex}-${direction.name}`}>
                <header className="roster-direction-heading">
                  <span className="roster-index">{String(directionIndex + 1).padStart(2, '0')}</span>
                  <label>
                    <span>{t('routing.directionName')}</span>
                    <input
                      value={direction.name}
                      onChange={(event) => changeDirection(directionIndex, { name: event.target.value })}
                      placeholder={t('routing.directionPlaceholder')}
                      required
                    />
                  </label>
                  <label className="roster-priority">
                    <span>{t('routing.priority')}</span>
                    <input
                      type="number"
                      value={direction.priority ?? ''}
                      onChange={(event) => changeDirection(directionIndex, { priority: event.target.value === '' ? undefined : Number(event.target.value) })}
                      min="0"
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button roster-remove"
                    aria-label={t('routing.removeDirection')}
                    title={t('routing.removeDirection')}
                    onClick={() => changeRoster((current) => ({ ...current, directions: current.directions.filter((_, index) => index !== directionIndex) }))}
                  >
                    <Trash2 size={15} />
                  </button>
                </header>

                <label className="roster-keywords">
                  <span>{t('routing.keywords')} <small>{t('routing.keywordsHint')}</small></span>
                  <textarea
                    value={direction.keywords.join('\n')}
                    onChange={(event) => changeDirection(directionIndex, {
                      keywords: event.target.value.split(/\r?\n/).map((keyword) => keyword.trim()),
                    })}
                    placeholder={t('routing.keywordsPlaceholder')}
                    rows={4}
                  />
                </label>

                <div className="roster-owners">
                  <div className="roster-subheading">
                    <strong><UsersRound size={15} /> {t('routing.owners')}</strong>
                    <button type="button" className="text-button" onClick={() => addOwner(directionIndex)}><Plus size={14} /> {t('routing.addOwner')}</button>
                  </div>
                  {direction.owners.map((owner, ownerIndex) => (
                    <div className="roster-owner-row" key={`${directionIndex}-${ownerIndex}`}>
                      <label>
                        <span>{t('routing.ownerName')}</span>
                        <input
                          value={owner.name}
                          onChange={(event) => changeOwner(directionIndex, ownerIndex, { name: event.target.value })}
                          placeholder={t('routing.ownerNamePlaceholder')}
                          required
                        />
                      </label>
                      <label>
                        <span>{t('routing.feishuOpenId')}</span>
                        <input
                          value={owner.feishu_open_id ?? ''}
                          onChange={(event) => changeOwner(directionIndex, ownerIndex, { feishu_open_id: event.target.value })}
                          placeholder={t('routing.feishuPlaceholder')}
                        />
                      </label>
                      <button
                        type="button"
                        className="icon-button roster-remove"
                        aria-label={t('routing.removeOwner')}
                        title={t('routing.removeOwner')}
                        onClick={() => changeDirection(directionIndex, { owners: direction.owners.filter((_, index) => index !== ownerIndex) })}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <article className="roster-default-owner">
            <div className="roster-subheading">
              <strong><ShieldCheck size={16} /> {t('routing.defaultOwner')}</strong>
              <small>{t('routing.defaultOwnerHint')}</small>
            </div>
            <div className="roster-owner-row">
              <label>
                <span>{t('routing.ownerName')}</span>
                <input
                  value={roster.default_owner?.name ?? ''}
                  onChange={(event) => changeDefaultOwner({ name: event.target.value })}
                  placeholder={t('routing.ownerNamePlaceholder')}
                />
              </label>
              <label>
                <span>{t('routing.feishuOpenId')}</span>
                <input
                  value={roster.default_owner?.feishu_open_id ?? ''}
                  onChange={(event) => changeDefaultOwner({ feishu_open_id: event.target.value })}
                  placeholder={t('routing.feishuPlaceholder')}
                />
              </label>
            </div>
          </article>
        </>
      )}
    </form>
  )
}
