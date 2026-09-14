import { ArrowUpRight, BookOpenText, Check, CheckCircle2, Cpu, ExternalLink, Inbox, KeyRound, LockKeyhole, LogIn, Moon, Newspaper, PenLine, Plus, Presentation, Radio, ShieldCheck, Sun, Terminal, Trash2, X, Zap } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type EntryId = 'read' | 'write' | 'fast-task' | 'fast-news' | 'fast-ppt'
type SsoEntryId = 'read' | 'fast-news'
type Entry = { id: EntryId; name: string; label: string; description: string; Icon: typeof BookOpenText; url?: string; tone: string }
type BearerSession = { token: string }
type AdminSession = BearerSession & { username: string; expiresAt: number }
type MemberSession = BearerSession & { person: string; keyId: string; expiresAt: number }
type PersonalKey = { id: string; person: string; keyPreview: string; active: boolean; createdAt?: string; expiresAt?: string | null }
type InsightItem = { id: string; title: string; summary?: string; url?: string; source?: string; direction?: string; authors?: string; venue?: string; receivedAt?: string }

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`
const adminStorageKey = 'fastresearch-admin-session'
const memberStorageKey = 'fastresearch-member-session'
const personalKeyStorage = 'fastresearch-personal-key'
const SSO_ENTRIES: Record<SsoEntryId, { audience: 'fast-news' | 'fast-read'; missing: string; fail: string }> = {
  read: { audience: 'fast-read', missing: 'FastRead 尚未配置外部地址', fail: '无法登录 FastRead' },
  'fast-news': { audience: 'fast-news', missing: 'FastNews 尚未配置外部地址', fail: '无法登录 FastNews' },
}
const ENTRIES: Record<EntryId, Entry> = {
  read: { id: 'read', name: 'FastRead', label: 'KNOWLEDGE / READER', description: '把资料变成可检索、可回溯的研究脉络。', Icon: BookOpenText, url: import.meta.env.VITE_READ_URL || 'http://127.0.0.1:3015', tone: 'cyan' },
  write: { id: 'write', name: 'FastWrite', label: 'KNOWLEDGE / WRITER', description: '在结构化工作区里快速产出研究内容。', Icon: PenLine, url: import.meta.env.VITE_WRITE_URL, tone: 'violet' },
  'fast-task': { id: 'fast-task', name: 'FastTask', label: 'OPERATIONS / TASKS', description: '将研究计划拆解成可执行的下一步。', Icon: CheckCircle2, url: import.meta.env.VITE_FASTTASK_URL, tone: 'lime' },
  'fast-news': { id: 'fast-news', name: 'FastNews', label: 'SIGNALS / NEWS', description: '持续接收与你关注方向有关的新信号。', Icon: Newspaper, url: import.meta.env.VITE_FASTNEWS_URL || 'http://127.0.0.1:4173', tone: 'amber' },
  'fast-ppt': { id: 'fast-ppt', name: 'FastPPT', label: 'OUTPUT / SLIDES', description: '把研究内容快速整理成可演示的幻灯片。', Icon: Presentation, url: import.meta.env.VITE_FASTPPT_URL, tone: 'rose' },
}

async function request<T>(path: string, init: RequestInit = {}, session?: BearerSession): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`)
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: 'include' })
  const payload = await response.json().catch(() => ({} as { error?: string }))
  if (!response.ok) throw new Error(payload.error ?? '请求失败')
  return payload as T
}

function loadStoredSession<T extends { expiresAt: number }>(key: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as T | null
    return value && value.expiresAt > Date.now() ? value : null
  } catch {
    return null
  }
}

function readKey(memberKeyId: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(`fastresearch-insight-read:${memberKeyId}`) ?? '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

function saveReadKey(memberKeyId: string, ids: Set<string>) {
  localStorage.setItem(`fastresearch-insight-read:${memberKeyId}`, JSON.stringify([...ids]))
}

function splitInsight(summary?: string) {
  if (!summary) return { abstract: '', trend: '' }
  const marker = '\n\n趋势：'
  const index = summary.indexOf(marker)
  if (index === -1) return { abstract: summary, trend: '' }
  return { abstract: summary.slice(0, index), trend: summary.slice(index + marker.length).trim() }
}
function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function App2() {
  const [dark, setDark] = useState(() => localStorage.getItem('fastresearch-theme') !== 'light')
  const [booting, setBooting] = useState(true)
  const [progress, setProgress] = useState(0)
  const [keyOpen, setKeyOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [session, setSession] = useState<AdminSession | null>(() => loadStoredSession<AdminSession>(adminStorageKey))
  const [member, setMember] = useState<MemberSession | null>(() => loadStoredSession<MemberSession>(memberStorageKey))
  const [insightItems, setInsightItems] = useState<InsightItem[]>([])
  const [selectedInsight, setSelectedInsight] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState('')
  const [active, setActive] = useState<Entry | null>(null)
  const pendingSsoLaunch = useRef<SsoEntryId | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fastresearch-theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => {
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 7, 100)), 70)
    const done = window.setTimeout(() => setBooting(false), 1650)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(done)
    }
  }, [])
  useEffect(() => {
    if (!session) return
    let cancelled = false
    void request('/api/admin/keys', {}, session).catch((err) => {
      if (cancelled) return
      sessionStorage.removeItem(adminStorageKey)
      setSession(null)
      setToast(err instanceof Error ? err.message : '管理员登录已失效')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!toast) return
    const hide = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(hide)
  }, [toast])
  useEffect(() => {
    if (!member) {
      setInsightItems([])
      setSelectedInsight(null)
      setReadIds(new Set())
      return
    }
    setReadIds(readKey(member.keyId))
    let cancelled = false
    const load = async () => {
      try {
        const data = await request<{ insightItems?: InsightItem[] }>('/api/content/me', {}, member)
        if (cancelled) return
        setInsightItems(data.insightItems ?? [])
      } catch (err) {
        if (cancelled) return
        sessionStorage.removeItem(memberStorageKey)
        setMember(null)
        setToast(err instanceof Error ? err.message : '成员登录已失效')
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [member])

  const launchSsoEntry = async (entryId: SsoEntryId, memberSession: MemberSession) => {
    const entry = ENTRIES[entryId]
    const meta = SSO_ENTRIES[entryId]
    if (!entry.url) {
      setToast(meta.missing)
      return
    }
    try {
      await request('/api/content/me', {}, memberSession)
      const target = new URL(entry.url, window.location.origin)
      const launch = new URL(apiUrl('/api/sso/launch'), window.location.origin)
      launch.searchParams.set('audience', meta.audience)
      launch.searchParams.set('next', target.toString())
      window.location.assign(launch.toString())
    } catch (err) {
      sessionStorage.removeItem(memberStorageKey)
      setMember(null)
      pendingSsoLaunch.current = entryId
      setKeyOpen(true)
      setToast(err instanceof Error ? err.message : meta.fail)
    }
  }

  const openEntry = (entry: Entry) => {
    setActive(entry)
    if (!entry.url) {
      setToast(`${entry.name} 尚未配置外部地址`)
      return
    }
    if (entry.id === 'fast-news' || entry.id === 'read') {
      if (member) window.setTimeout(() => { void launchSsoEntry(entry.id, member) }, 450)
      else {
        pendingSsoLaunch.current = entry.id
        setKeyOpen(true)
      }
      return
    }
    window.setTimeout(() => window.location.assign(entry.url!), 450)
  }

  const unlock = async (key: string) => {
    const result = await request<{ session: string; person: string; keyId: string; expiresAt: number; insightItems?: InsightItem[] }>('/api/content/unlock', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
    const value: MemberSession = { token: result.session, person: result.person, keyId: result.keyId, expiresAt: result.expiresAt }
    sessionStorage.setItem(memberStorageKey, JSON.stringify(value))
    sessionStorage.removeItem(personalKeyStorage)
    setMember(value)
    setInsightItems(result.insightItems ?? [])
    setKeyOpen(false)
    setToast(`已解锁 ${result.person} 的研究数据`)
    document.getElementById('insight')?.scrollIntoView({ behavior: 'smooth' })
    const pending = pendingSsoLaunch.current
    if (pending) {
      pendingSsoLaunch.current = null
      await launchSsoEntry(pending, value)
    }
  }

  const markRead = (id: string) => {
    if (!member) return
    setSelectedInsight(id)
    setReadIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      saveReadKey(member.keyId, next)
      return next
    })
  }

  const closeKeyDialog = () => {
    pendingSsoLaunch.current = null
    setKeyOpen(false)
  }

  return <div className="tech-app" onPointerMove={(event) => { document.documentElement.style.setProperty('--pointer-x', `${event.clientX}px`); document.documentElement.style.setProperty('--pointer-y', `${event.clientY}px`) }}>
    <div className="ambient-cursor" aria-hidden="true" />
    {booting && <BootScreen progress={progress} />}
    <header className="tech-header">
      <a className="brand-mark" href="#home" aria-label="FastResearch home"><span className="brand-icon"><Zap size={17} fill="currentColor" /></span><span><b>FAST</b>RESEARCH</span><small>CORE / 01</small></a>
      <div className="header-status"><span className="status-dot" /> SYSTEM ONLINE <span className="status-separator">/</span> {new Date().toLocaleDateString('en-GB').split('/').join('.')}</div>
      <div className="header-actions">
        {member && <span className="header-identity">{member.person}</span>}
        <button type="button" className="ghost-button" onClick={() => setKeyOpen(true)}><KeyRound size={15} /> {member ? 'KEY UNLOCKED' : 'ACCESS KEY'}</button>
        <button type="button" className="icon-button" onClick={() => setDark((value) => !value)} aria-label="切换主题">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        <button type="button" className="icon-button" onClick={() => setAdminOpen(true)} aria-label="管理员登录">{session ? <ShieldCheck size={16} /> : <LogIn size={16} />}</button>
      </div>
    </header>
    <main id="home" className="tech-main">
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><Radio size={13} /> RESEARCH OPERATING SYSTEM <span>v2.5.0</span></div>
          <h1>让每一次<br /><em>研究行动</em>更快发生。</h1>
          <p>FastResearch 把阅读、写作、任务、资讯、演示和飞书回传的研究卡片汇聚到同一套工作台。</p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' })}>进入工作台 <ArrowUpRight size={17} /></button>
            <button type="button" className="text-button" onClick={() => setKeyOpen(true)}>解锁个人数据 <KeyRound size={15} /></button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-core"><Cpu size={32} /><span>SYNC</span></div>
          <span className="orbit-label label-one">DATA / 05</span>
          <span className="orbit-label label-two">SIGNAL ACTIVE</span>
        </div>
      </section>
      <div className="section-bar"><span>01 / MODULES</span><span>SELECT A WORKSPACE TO CONTINUE <ArrowUpRight size={13} /></span></div>
      <section id="modules" className="module-grid">{Object.values(ENTRIES).map((entry, index) => <ModuleCard key={entry.id} entry={entry} index={index} active={active?.id === entry.id} onOpen={() => openEntry(entry)} />)}</section>
      <div className="section-bar" id="insight"><span>02 / FASTINSIGHT INBOX</span><span>FEISHU CARDS ROUTED TO YOUR KEY <ArrowUpRight size={13} /></span></div>
      <InsightMailbox member={member} items={insightItems} selectedId={selectedInsight} readIds={readIds} onSelect={markRead} onUnlock={() => setKeyOpen(true)} />
    </main>
    <footer className="tech-footer"><span><Terminal size={13} /> FASTRESEARCH / CONTROL CENTER</span><span>BUILT FOR DEEP WORK <span className="footer-pulse" /></span></footer>
    {keyOpen && <KeyDialog onClose={closeKeyDialog} onUnlock={unlock} />}
    {adminOpen && <AdminDialog session={session} onLogin={(value) => { setSession(value); sessionStorage.setItem(adminStorageKey, JSON.stringify(value)); setToast('管理员会话已建立') }} onLogout={() => { sessionStorage.removeItem(adminStorageKey); setSession(null) }} onClose={() => setAdminOpen(false)} />}
    {toast && <div className="tech-toast"><Check size={15} /> {toast}</div>}
  </div>
}

function BootScreen({ progress }: { progress: number }) {
  return <div className="boot-screen"><div className="boot-logo"><span className="boot-mark"><Zap size={28} fill="currentColor" /></span><strong>FAST<span>RESEARCH</span></strong></div><div className="boot-loader"><div className="boot-loader-top"><span>INITIALIZING RESEARCH OS</span><span>{String(progress).padStart(3, '0')}%</span></div><div className="boot-track"><i style={{ width: `${progress}%` }} /></div><div className="boot-log"><span>› mounting workspace modules</span><span>› calibrating insight inbox</span><span>› ready to focus</span></div></div><small className="boot-copyright">FR / SYSTEM 2026</small></div>
}

function ModuleCard({ entry, index, active, onOpen }: { entry: Entry; index: number; active: boolean; onOpen: () => void }) {
  const Icon = entry.Icon
  return <button type="button" className={`module-card tone-${entry.tone} ${active ? 'is-active' : ''}`} onClick={onOpen} style={{ animationDelay: `${index * 90 + 120}ms` }}><span className="card-number">0{index + 1}</span><span className="module-icon"><Icon size={22} /></span><span className="module-meta">{entry.label}</span><strong>{entry.name}</strong><p>{entry.description}</p><span className="module-cta">OPEN MODULE <ArrowUpRight size={15} /></span><span className="card-grid" /></button>
}

function InsightMailbox({ member, items, selectedId, readIds, onSelect, onUnlock }: { member: MemberSession | null; items: InsightItem[]; selectedId: string | null; readIds: Set<string>; onSelect: (id: string) => void; onUnlock: () => void }) {
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])
  const unread = items.filter((item) => !readIds.has(item.id)).length
  const detail = splitInsight(selected?.summary)
  return (
    <section className="insight-mailbox">
      <div className="mailbox-head">
        <span className="intel-kicker"><Inbox size={14} /> FASTINSIGHT / FEISHU INBOX</span>
        <h2>飞书回传的研究卡片，按个人 Key 投递到信箱。</h2>
        <p>{member ? `${member.person} 的信箱 · ${items.length} 封${unread ? ` · ${unread} 封未读` : ''}` : '解锁个人 Key 后，FastInsight skill 分拣的论文卡片会出现在这里。'}</p>
      </div>
      {!member ? (
        <div className="mailbox-locked">
          <LockKeyhole size={22} />
          <strong>信箱已锁定</strong>
          <p>使用管理员分发的个人 Key 解锁后，即可接收飞书经 FastInsight 回传的卡片。</p>
          <button type="button" className="outline-button" onClick={onUnlock}>解锁信箱 <KeyRound size={15} /></button>
        </div>
      ) : (
        <div className="mailbox-body">
          <div className="mailbox-list" role="list">
            {items.length === 0 ? <p className="mailbox-empty">暂无飞书回传的研究卡片。FastInsight 分拣后会显示在这里。</p> : items.map((item) => {
              const active = (selected?.id ?? '') === item.id
              const unreadItem = !readIds.has(item.id)
              return (
                <button type="button" role="listitem" key={item.id} className={`mailbox-row ${active ? 'is-active' : ''} ${unreadItem ? 'is-unread' : ''}`} onClick={() => onSelect(item.id)}>
                  <span className="mailbox-dot" aria-hidden="true" />
                  <span className="mailbox-row-copy">
                    <em>{item.direction ? `论文推荐 · ${item.direction}` : 'FastInsight 卡片'}</em>
                    <strong>{item.title}</strong>
                    <small>{formatTime(item.receivedAt)}{item.source ? ` · ${item.source}` : ''}</small>
                  </span>
                </button>
              )
            })}
          </div>
          <article className="mailbox-card">
            {selected ? (
              <>
                <header>
                  <span>📄 {selected.direction ? `论文推荐 · ${selected.direction}` : 'FastInsight'}</span>
                  <time>{formatTime(selected.receivedAt)}</time>
                </header>
                <h3>{selected.title}</h3>
                {selected.authors && <p className="mailbox-meta"><b>作者</b> {selected.authors}</p>}
                {selected.venue && <p className="mailbox-meta"><b>出处</b> {selected.venue}</p>}
                {selected.url && <p className="mailbox-meta"><b>链接</b> {selected.url}</p>}
                {detail.abstract && <><p className="mailbox-meta"><b>摘要</b></p><p className="mailbox-summary">{detail.abstract}</p></>}
                {detail.trend && <><p className="mailbox-meta"><b>趋势分析</b></p><p className="mailbox-summary">{detail.trend}</p></>}
                <p className="mailbox-note">由 FastInsight 自动分拣，已转发给你</p>
                {selected.url && <a className="primary-button" href={selected.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={15} /></a>}
              </>
            ) : <p className="mailbox-empty">选择左侧卡片查看详情。</p>}
          </article>
        </div>
      )}
    </section>
  )
}

function Dialog({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`tech-dialog ${wide ? 'admin-dialog' : ''}`} role="dialog" aria-modal="true"><div className="dialog-title"><span>{title}</span><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></div>{children}</section></div>
}

function KeyDialog({ onClose, onUnlock }: { onClose: () => void; onUnlock: (key: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try { await onUnlock(value) } catch (err) { setError(err instanceof Error ? err.message : 'Key 无效') } finally { setLoading(false) }
  }
  return <Dialog title="ACCESS / PERSONAL DATA" onClose={onClose}><form className="dialog-form" onSubmit={submit}><p>输入管理员分发的个人 Key，解锁 FastInsight 信箱，并登录对应的 FastNews 关注作者。</p><label htmlFor="personal-key">PERSONAL KEY</label><div className="input-wrap"><KeyRound size={15} /><input id="personal-key" type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="fk_••••••••••" autoFocus /></div>{error && <span className="form-error">{error}</span>}<button type="submit" className="primary-button full-button" disabled={loading}>{loading ? 'VERIFYING…' : 'VERIFY & UNLOCK'} <ArrowUpRight size={16} /></button></form></Dialog>
}

function AdminDialog({ session, onLogin, onLogout, onClose }: { session: AdminSession | null; onLogin: (value: AdminSession) => void; onLogout: () => void; onClose: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [person, setPerson] = useState('')
  const [keys, setKeys] = useState<PersonalKey[]>([])
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const dropSession = (message: string) => {
    setError(message)
    setKeys([])
    setNewKey('')
    onLogout()
  }
  const refresh = async (admin = session) => {
    if (!admin) return
    try {
      setKeys((await request<{ keys: PersonalKey[] }>('/api/admin/keys', {}, admin)).keys)
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败'
      if (message.includes('管理员登录已失效')) dropSession('管理员登录已失效，请重新登录')
      else setError(message)
    }
  }
  useEffect(() => { void refresh() }, [session])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const value = await request<{ session: string; username: string; expiresAt: number }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      const next = { token: value.session, username: value.username, expiresAt: value.expiresAt }
      onLogin(next)
      setError('')
      await refresh(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    }
  }
  const createKey = async (event: FormEvent) => {
    event.preventDefault()
    if (!session) return
    setError('')
    try {
      const result = await request<{ key: string }>('/api/admin/keys', { method: 'POST', body: JSON.stringify({ person }) }, session)
      setNewKey(result.key)
      setPerson('')
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败'
      if (message.includes('管理员登录已失效')) dropSession('管理员登录已失效，请重新登录')
      else setError(message)
    }
  }
  const removeKey = async (id: string) => {
    if (!session) return
    setError('')
    setBusyId(id)
    try {
      await request(`/api/admin/keys/${id}`, { method: 'DELETE' }, session)
      setKeys((current) => current.filter((item) => item.id !== id))
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败'
      if (message.includes('管理员登录已失效')) dropSession('管理员登录已失效，请重新登录')
      else setError(message)
    } finally {
      setBusyId('')
    }
  }
  return (
    <Dialog title={session ? 'ADMIN / KEY CONTROL' : 'ADMIN / AUTHENTICATION'} onClose={onClose} wide={Boolean(session)}>
      {session ? (
        <div className="admin-active">
          <ShieldCheck size={30} />
          <strong>管理员会话已连接</strong>
          <p>当前身份：{session.username}。删除后该成员无法再解锁信箱。</p>
          <form className="key-create-form" onSubmit={createKey}>
            <input value={person} onChange={(event) => setPerson(event.target.value)} placeholder="成员名称，需与 FastInsight 名册一致" required />
            <button type="submit" className="outline-button"><Plus size={14} />生成 Key</button>
          </form>
          {newKey && <code className="new-key-code">{newKey}</code>}
          {error && <span className="form-error">{error}</span>}
          <div className="admin-key-list">
            {keys.length === 0 ? <p className="mailbox-empty">还没有分发个人 Key</p> : keys.map((item) => (
              <div className="admin-key-row" key={item.id}>
                <span>{item.person} · {item.keyPreview}{item.active === false ? ' · 已失效' : ''}</span>
                <button type="button" className="icon-button" onClick={() => { void removeKey(item.id) }} aria-label={`删除 ${item.person} 的 Key`} title="删除 Key" disabled={busyId === item.id}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <button type="button" className="outline-button full-button" onClick={onClose}>返回工作台</button>
          <button type="button" className="text-button" onClick={() => dropSession('')}>退出并重新登录</button>
        </div>
      ) : (
        <form className="dialog-form" onSubmit={submit}>
          <p>登录后可管理研究工具的访问 Key。</p>
          <label htmlFor="admin-user">USERNAME</label>
          <input id="admin-user" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          <label htmlFor="admin-pass">PASSWORD</label>
          <input id="admin-pass" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          {error && <span className="form-error">{error}</span>}
          <button type="submit" className="primary-button full-button">LOGIN <ArrowUpRight size={16} /></button>
        </form>
      )}
    </Dialog>
  )
}

export default App2
