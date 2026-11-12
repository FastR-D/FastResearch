import { ArrowUpRight,BookOpenText,ExternalLink,Inbox,KeyRound,LockKeyhole } from 'lucide-react'
import { useMemo } from 'react'
import { type Copy } from '../../shared/copy'
import { formatTime,splitInsight } from '../../shared/lib/format'
import type { InsightItem,MemberSession } from '../../shared/types'
export function InsightMailbox({ member, items, selectedId, readIds, onSelect, onUnlock, onOpenFastRead, t }: {
  member: MemberSession | null
  items: InsightItem[]
  selectedId: string | null
  readIds: Set<string>
  onSelect: (id: string) => void
  onUnlock: () => void
  onOpenFastRead: () => void
  t: Copy
}) {
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])
  const unread = items.filter((item) => !readIds.has(item.id)).length
  const detail = splitInsight(selected?.summary)

  return (
    <section className="insight-mailbox">
      <div className="mailbox-head">
        <div className="mailbox-head-meta">
          <span className="intel-kicker"><Inbox size={14} /> {t('insight.label')}</span>
          {member && <span className="mailbox-count-pill">{t('insight.count', { count: items.length })} {unread > 0 && t('insight.unread', { count: unread })}</span>}
        </div>
        <h2>{t('insight.title')}</h2>
        <p>
          {member
            ? t('insight.personal', { person: member.person })
            : t('insight.lockedDescription')}
        </p>
      </div>

      {!member ? (
        <div className="mailbox-locked">
          <div className="locked-icon-wrap"><LockKeyhole size={24} /></div>
          <strong>{t('insight.lockedTitle')}</strong>
          <p>{t('insight.lockedHint')}</p>
          <button type="button" className="outline-button" onClick={onUnlock}>{t('insight.unlock')} <KeyRound size={14} /></button>
        </div>
      ) : (
        <div className="mailbox-body">
          <div className="mailbox-list" role="list">
            {items.length === 0 ? (
              <div className="mailbox-empty">
                <Inbox size={28} className="mailbox-empty-icon" />
                <p>{t('insight.empty')}</p>
                <small>{t('insight.emptyHint')}</small>
              </div>
            ) : items.map((item) => {
              const active = (selected?.id ?? '') === item.id
              const unreadItem = !readIds.has(item.id)
              return (
                <div
                  role="listitem"
                  key={item.id}
                  className={`mailbox-row ${active ? 'is-active' : ''} ${unreadItem ? 'is-unread' : ''}`}
                >
                  <button type="button" className="mailbox-row-select" onClick={() => onSelect(item.id)}>
                    <span className="mailbox-dot" aria-hidden="true" />
                    <span className="mailbox-row-copy">
                      <em>{item.direction ? t('insight.reading', { direction: item.direction }) : t('insight.card')}</em>
                      <strong>{item.title}</strong>
                      <small>{formatTime(item.receivedAt)}{item.source ? ` · ${item.source}` : ''}</small>
                    </span>
                  </button>
                  {item.url && (
                    <a
                      className="mailbox-row-arrive"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      title={t('insight.arrive')}
                      aria-label={t('insight.arriveAria', { title: item.title })}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>{t('insight.arrive')}</span> <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              )
            })}
          </div>

          <article className="mailbox-card">
            {selected ? (
              <>
                <header className="paper-header">
                  <span className="paper-tag">📄 {selected.direction ? t('insight.direction', { direction: selected.direction }) : t('insight.result')}</span>
                  <time className="paper-time">{formatTime(selected.receivedAt)}</time>
                </header>
                <h3 className="paper-title">{selected.title}</h3>

                <div className="paper-meta-grid">
                  {selected.authors && (
                    <div className="paper-meta-row">
                      <span className="meta-label">{t('insight.authors')}</span>
                      <span className="meta-val">{selected.authors}</span>
                    </div>
                  )}
                  {selected.venue && (
                    <div className="paper-meta-row">
                      <span className="meta-label">{t('insight.venue')}</span>
                      <span className="meta-val">{selected.venue}</span>
                    </div>
                  )}
                  {selected.url && (
                    <div className="paper-meta-row">
                      <span className="meta-label">{t('insight.paperUrl')}</span>
                      <a className="meta-val paper-link-text" href={selected.url} target="_blank" rel="noreferrer" title={selected.url}>{selected.url}</a>
                    </div>
                  )}
                </div>

                {detail.abstract && (
                  <div className="paper-abstract-box">
                    <div className="box-title">{t('insight.abstract')}</div>
                    <p className="mailbox-summary">{detail.abstract}</p>
                  </div>
                )}

                {detail.trend && (
                  <div className="paper-trend-box">
                    <div className="box-title">{t('insight.trend')}</div>
                    <p className="mailbox-summary">{detail.trend}</p>
                  </div>
                )}

                <div className="paper-card-footer">
                  <small className="paper-note">{t('insight.archived')}</small>
                  <div className="paper-actions">
                    <button type="button" className="primary-button paper-open-btn" onClick={onOpenFastRead}>
                      <BookOpenText size={15} /> {t('insight.fastRead')}
                    </button>
                    {selected.url && (
                      <a className="outline-button paper-source-btn" href={selected.url} target="_blank" rel="noreferrer">
                        {t('insight.open')} <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="mailbox-empty">{t('insight.select')}</div>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
