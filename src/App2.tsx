import { ArrowUpRight, BookOpenText, Check, CheckCircle2, Circle, CircleDot, ExternalLink, FlaskConical, Inbox, KeyRound, Layers, ListTodo, LockKeyhole, LogIn, Moon, Newspaper, PenLine, Plus, Presentation, ShieldCheck, Sun, Terminal, Trash2, X } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type EntryId = 'fast-ppt' | 'fast-write' | 'fast-read' | 'fast-news' | 'fast-lab'
type SsoEntryId = 'fast-read' | 'fast-news'
type Entry = { id: EntryId; name: string; label: string; description: string; Icon: typeof BookOpenText; url?: string; tone: string }
type BearerSession = { token: string }
type AdminSession = BearerSession & { username: string; expiresAt: number }
type MemberSession = BearerSession & { person: string; keyId: string; expiresAt: number }
type PersonalKey = { id: string; person: string; keyPreview: string; active: boolean; createdAt?: string; expiresAt?: string | null }
type InsightItem = { id: string; title: string; summary?: string; url?: string; source?: string; direction?: string; authors?: string; venue?: string; receivedAt?: string }
type TaskStatus = 'pending' | 'active' | 'done'
type WorkflowTask = { id: string; module: EntryId; title: string; description: string; status: TaskStatus; completedAt?: string | null }
type Workflow = { id: string; title: string; source?: string; receivedAt?: string; currentIndex: number; doneCount: number; total: number; completed: boolean; currentTask?: WorkflowTask | null; tasks: WorkflowTask[] }

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`
const adminStorageKey = 'fastresearch-admin-session'
const memberStorageKey = 'fastresearch-member-session'
const personalKeyStorage = 'fastresearch-personal-key'
const SSO_ENTRIES: Record<SsoEntryId, { audience: 'fast-news' | 'fast-read'; missing: string; fail: string }> = {
  'fast-read': { audience: 'fast-read', missing: 'FastRead 尚未配置外部地址', fail: '无法登录 FastRead' },
  'fast-news': { audience: 'fast-news', missing: 'FastNews 尚未配置外部地址', fail: '无法登录 FastNews' },
}
const ENTRIES: Record<EntryId, Entry> = {
  'fast-ppt': { id: 'fast-ppt', name: 'FastPPT', label: '成果汇报 · SLIDES', description: '把研究结论与阶段性成果快速整理成可严谨讲解的幻灯片。', Icon: Presentation, url: import.meta.env.VITE_FASTPPT_URL, tone: 'rose' },
  'fast-write': { id: 'fast-write', name: 'FastWrite', label: '学术撰写 · WRITER', description: '在结构化工作区里产出研究论文、论证草稿与实验报告。', Icon: PenLine, url: import.meta.env.VITE_WRITE_URL, tone: 'violet' },
  'fast-read': { id: 'fast-read', name: 'FastRead', label: '文献研读 · READER', description: '把论文与学术资料收录进可检索、可溯源的研读脉络。', Icon: BookOpenText, url: import.meta.env.VITE_READ_URL || 'http://127.0.0.1:3015', tone: 'cyan' },
  'fast-news': { id: 'fast-news', name: 'FastNews', label: '前沿追踪 · SIGNALS', description: '持续接收与关注学术方向相关的最新顶会论文与前沿资讯。', Icon: Newspaper, url: import.meta.env.VITE_FASTNEWS_URL || 'http://127.0.0.1:4173', tone: 'amber' },
  'fast-lab': { id: 'fast-lab', name: 'FastLab', label: '实证复现 · LAB', description: '进入实验工作区，完成实证数据分析、复现验证与过程记录。', Icon: FlaskConical, url: import.meta.env.VITE_FASTLAB_URL, tone: 'lime' },
}
const DEFAULT_TASKS: Array<Pick<WorkflowTask, 'module' | 'title' | 'description'>> = [
  { module: 'fast-ppt', title: '整理学术演示汇报', description: '把已有结论快速结构化整理为规范的学术交流幻灯片。' },
  { module: 'fast-write', title: '撰写研究论证稿件', description: '在结构化写作工作区完成论文草稿、理论推演与章节组织。' },
  { module: 'fast-read', title: '检索并深读核心文献', description: '将相关论文资料收进可回溯的研究文献脉络与笔记库。' },
  { module: 'fast-news', title: '追踪领域前沿动态', description: '扫描与关注研究方向相关的最新预印本、顶会动态与前沿信号。' },
  { module: 'fast-lab', title: '开展实验验证与复现', description: '在实验室工作区完成算法测试、实验数据比对与复现记录。' },
]
const PREVIEW_WORKFLOW: Workflow = {
  id: 'preview',
  title: '标准科研工作流',
  source: 'preview',
  currentIndex: 0,
  doneCount: 0,
  total: DEFAULT_TASKS.length,
  completed: false,
  tasks: DEFAULT_TASKS.map((task, index) => ({
    id: `preview-${task.module}`,
    module: task.module,
    title: task.title,
    description: task.description,
    status: index === 0 ? 'active' : 'pending',
    completedAt: null,
  })),
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

function isSsoEntry(id: EntryId): id is SsoEntryId {
  return id === 'fast-read' || id === 'fast-news'
}

function App2() {
  // Default to light green academic theme
  const [dark, setDark] = useState(() => localStorage.getItem('fastresearch-theme') === 'dark')
  const [keyOpen, setKeyOpen] = useState(false)
  const [casEnabled, setCasEnabled] = useState(false)
  const [casOpen, setCasOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [session, setSession] = useState<AdminSession | null>(() => loadStoredSession<AdminSession>(adminStorageKey))
  const [member, setMember] = useState<MemberSession | null>(() => new URLSearchParams(window.location.search).get('fastcas') === 'complete' ? null : loadStoredSession<MemberSession>(memberStorageKey))
  const [insightItems, setInsightItems] = useState<InsightItem[]>([])
  const [selectedInsight, setSelectedInsight] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState('')
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingSsoLaunch = useRef<SsoEntryId | null>(null)
  const visibleWorkflow = workflow ?? PREVIEW_WORKFLOW
  const selectedTask = visibleWorkflow.tasks.find((task) => task.id === selectedTaskId) ?? visibleWorkflow.tasks.find((task) => task.status === 'active') ?? visibleWorkflow.tasks[0]
  const selectedEntry = selectedTask ? ENTRIES[selectedTask.module] : null

  useEffect(() => {
    void request<{enabled: boolean}>('/api/auth/fastcas/available').then(value => setCasEnabled(value.enabled)).catch(() => {})
    const marker = new URLSearchParams(window.location.search).get('fastcas')
    if (marker === 'complete') {
      sessionStorage.removeItem(memberStorageKey)
      void request<{session: string; person: string; keyId: string; expiresAt: number}>('/api/content/me').then(result => {
        const value = { token: result.session, person: result.person, keyId: result.keyId, expiresAt: result.expiresAt }
        sessionStorage.setItem(memberStorageKey, JSON.stringify(value)); setMember(value); setToast('FastCAS 操作已完成')
      }).catch(() => { setMember(null); setToast('请重新登录以确认认证状态') })
    } else if (marker === 'failed') setToast('FastCAS 操作未完成，请使用原 Key 登录，在账号认证中检查或重试')
    if (marker) { const url = new URL(window.location.href); url.searchParams.delete('fastcas'); window.history.replaceState(null, '', url.pathname + url.search + url.hash) }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fastresearch-theme', dark ? 'dark' : 'light')
  }, [dark])

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
  }, [session])

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
      setWorkflow(null)
      setSelectedTaskId(PREVIEW_WORKFLOW.tasks[0]?.id ?? null)
      return
    }
    setReadIds(readKey(member.keyId))
    let cancelled = false
    const load = async () => {
      try {
        const data = await request<{ insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/me', {}, member)
        if (cancelled) return
        setInsightItems(data.insightItems ?? [])
        setWorkflow(data.workflow ?? null)
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

  useEffect(() => {
    if (!visibleWorkflow.tasks.length) return
    setSelectedTaskId((current) => visibleWorkflow.tasks.some((task) => task.id === current) ? current : (visibleWorkflow.tasks.find((task) => task.status === 'active') ?? visibleWorkflow.tasks[0]).id)
  }, [visibleWorkflow])

  const openInNewTab = (url: string, popup?: Window | null) => {
    if (popup && !popup.closed) {
      popup.opener = null
      popup.location.replace(url)
      return popup
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) setToast('浏览器拦截了新窗口，请允许弹窗后重试')
    return opened
  }

  const launchSsoEntry = async (entryId: SsoEntryId, memberSession: MemberSession, popup?: Window | null) => {
    const entry = ENTRIES[entryId]
    const meta = SSO_ENTRIES[entryId]
    if (!entry.url) {
      popup?.close()
      setToast(meta.missing)
      return
    }
    try {
      await request('/api/content/me', {}, memberSession)
      const target = new URL(entry.url, window.location.origin)
      const launch = new URL(apiUrl('/api/sso/launch'), window.location.origin)
      launch.searchParams.set('audience', meta.audience)
      launch.searchParams.set('next', target.toString())
      openInNewTab(launch.toString(), popup)
    } catch (err) {
      popup?.close()
      sessionStorage.removeItem(memberStorageKey)
      setMember(null)
      pendingSsoLaunch.current = entryId
      setKeyOpen(true)
      setToast(err instanceof Error ? err.message : meta.fail)
    }
  }

  const openEntry = (entry: Entry, popup?: Window | null) => {
    if (!entry.url) {
      popup?.close()
      setToast(`${entry.name} 尚未配置外部地址`)
      return
    }
    const tab = popup && !popup.closed ? popup : window.open('about:blank', '_blank')
    if (!tab) {
      setToast('浏览器拦截了新窗口，请允许弹窗后重试')
      return
    }
    if (isSsoEntry(entry.id)) {
      const ssoId = entry.id
      if (member) void launchSsoEntry(ssoId, member, tab)
      else {
        tab.close()
        pendingSsoLaunch.current = ssoId
        setKeyOpen(true)
      }
      return
    }
    openInNewTab(entry.url, tab)
  }

  const unlock = async (key: string) => {
    const pendingLaunch = pendingSsoLaunch.current
    const pendingTab = pendingLaunch ? window.open('about:blank', '_blank') : null
    const result = await request<{ session: string; person: string; keyId: string; expiresAt: number; insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/unlock', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
    const value: MemberSession = { token: result.session, person: result.person, keyId: result.keyId, expiresAt: result.expiresAt }
    sessionStorage.setItem(memberStorageKey, JSON.stringify(value))
    sessionStorage.removeItem(personalKeyStorage)
    setMember(value)
    setInsightItems(result.insightItems ?? [])
    setWorkflow(result.workflow ?? null)
    setKeyOpen(false)
    setToast(`已解锁 ${result.person} 的科研工作空间`)
    const pending = pendingSsoLaunch.current
    if (pending) {
      pendingSsoLaunch.current = null
      await launchSsoEntry(pending, value, pendingTab)
    } else {
      pendingTab?.close()
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

  const selectTask = (task: WorkflowTask) => {
    if (!workflow && task.status === 'pending') {
      setSelectedTaskId(task.id)
      return
    }
    if (workflow && task.status === 'pending') {
      setToast('请按工序完成当前环节，再推进下一阶段')
      return
    }
    setSelectedTaskId(task.id)
  }

  const loadDefaultWorkflow = async () => {
    if (!member) {
      setKeyOpen(true)
      return
    }
    setBusy(true)
    try {
      const result = await request<{ workflow: Workflow }>('/api/workflow', { method: 'POST', body: JSON.stringify({ default: true }) }, member)
      setWorkflow(result.workflow)
      setSelectedTaskId(result.workflow.currentTask?.id ?? result.workflow.tasks[0]?.id ?? null)
      setToast('已载入标准科研工作流')
    } catch (err) {
      setToast(err instanceof Error ? err.message : '无法载入工作流')
    } finally {
      setBusy(false)
    }
  }

  const completeTask = async (task: WorkflowTask) => {
    if (!member) {
      setKeyOpen(true)
      setToast('请先解锁个人科研 Key')
      return
    }
    if (!workflow) {
      setToast('请先载入研究任务队列')
      return
    }
    if (task.status !== 'active') {
      setToast('请按工序完成当前任务环节')
      return
    }
    const upcoming = workflow.tasks.find((item) => item.status === 'pending')
    const nextTab = upcoming && ENTRIES[upcoming.module]?.url ? window.open('about:blank', '_blank') : null
    setBusy(true)
    try {
      const result = await request<{ workflow: Workflow; nextTask?: WorkflowTask | null }>('/api/workflow/complete', { method: 'POST', body: JSON.stringify({ taskId: task.id }) }, member)
      setWorkflow(result.workflow)
      const next = result.nextTask ?? result.workflow.currentTask ?? null
      if (next) {
        setSelectedTaskId(next.id)
        setToast(`已完成阶段，进入 ${ENTRIES[next.module].name}`)
        openEntry(ENTRIES[next.module], nextTab)
      } else {
        nextTab?.close()
        setSelectedTaskId(result.workflow.tasks[result.workflow.tasks.length - 1]?.id ?? task.id)
        setToast('科研工作流全部任务已结项')
      }
    } catch (err) {
      nextTab?.close()
      setToast(err instanceof Error ? err.message : '无法标记任务完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tech-app">
      <header className="tech-header">
        <a className="brand-mark" href="#home" aria-label="FastResearch 首页">
          <span className="brand-icon"><FlaskConical size={16} /></span>
          <span className="brand-title"><b>Fast</b>Research</span>
          <small>科研工作台</small>
        </a>
        <div className="header-status">
          <span className="status-dot" />
          <span>科研工作流协同中</span>
          <span className="status-separator">/</span>
          <span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.')}</span>
        </div>
        <div className="header-actions">
          {casEnabled && (member ? <button type="button" className="ghost-button" onClick={() => setCasOpen(true)}>FastCAS 认证</button> : <a className="ghost-button" href={apiUrl('/api/auth/fastcas/login')}>使用 FastCAS 登录</a>)}
          {member && <span className="header-identity" title={`当前认证成员：${member.person}`}>👤 {member.person}</span>}
          <button type="button" className="ghost-button" onClick={() => setKeyOpen(true)}>
            <KeyRound size={14} />
            <span>{member ? '凭证已激活' : '科研凭证认证'}</span>
          </button>
          <button type="button" className="icon-button" onClick={() => setDark((value) => !value)} aria-label="切换主题" title={dark ? '切换为浅绿科研主题' : '切换为暗色夜间主题'}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="icon-button" onClick={() => setAdminOpen(true)} aria-label="管理员登录" title="后台凭证管理">
            {session ? <ShieldCheck size={16} /> : <LogIn size={15} />}
          </button>
        </div>
      </header>

      <main id="home" className="tech-main">
        <section className="workflow-hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Layers size={13} />
              <span>ACADEMIC PIPELINE</span>
              <span className="eyebrow-ver">v3.0.0</span>
            </div>
            <h1>规范化推进<br /><em>严谨的科研流程。</em></h1>
            <p>
              FastResearch 将学术产出解构为连续的工序管线：汇报演示 (FastPPT)、论证写作 (FastWrite)、文献研读 (FastRead)、前沿追踪 (FastNews) 与实证复现 (FastLab)。以清晰的阶段性交付，保证研究过程的深度与可溯源性。
            </p>
          </div>
          <div className="workflow-meter">
            <div className="workflow-meter-header">
              <span className="intel-kicker"><ListTodo size={14} /> {visibleWorkflow.title}</span>
              <span className="meter-badge">{workflow ? (workflow.completed ? '已结项' : '推进中') : '预览模式'}</span>
            </div>
            <strong>
              {String(workflow ? workflow.doneCount : 0).padStart(2, '0')}
              <small> / {String(visibleWorkflow.total).padStart(2, '0')} 完成工序</small>
            </strong>
            <em>{workflow ? (workflow.completed ? '本轮研究工序全部达成' : `正在进行第 ${workflow.currentIndex + 1} 项研究步骤`) : '解锁凭证即可同步团队分发任务'}</em>
            <div className="workflow-track" aria-hidden="true">
              <i style={{ width: `${visibleWorkflow.total ? (100 * (workflow?.doneCount ?? 0)) / visibleWorkflow.total : 0}%` }} />
            </div>
          </div>
        </section>

        <div className="section-bar">
          <span className="section-bar-title">01 / 研究任务流水线 (RESEARCH PIPELINE)</span>
          <span className="section-bar-meta">按工序推进 · 形成完整学术闭环 <ArrowUpRight size={13} /></span>
        </div>

        <WorkflowBoard
          workflow={visibleWorkflow}
          live={Boolean(workflow)}
          member={member}
          selectedId={selectedTask?.id ?? null}
          selectedEntry={selectedEntry}
          selectedTask={selectedTask}
          busy={busy}
          onSelect={selectTask}
          onOpen={() => selectedEntry && openEntry(selectedEntry)}
          onComplete={() => selectedTask && completeTask(selectedTask)}
          onLoadDefault={() => { void loadDefaultWorkflow() }}
          onUnlock={() => setKeyOpen(true)}
        />

        <div className="section-bar" id="insight">
          <span className="section-bar-title">02 / FASTINSIGHT 学术情报分拣 (FEISHU INBOX)</span>
          <span className="section-bar-meta">文献自动分拣速递 · 专属个人 Key 解锁 <ArrowUpRight size={13} /></span>
        </div>

        <InsightMailbox
          member={member}
          items={insightItems}
          selectedId={selectedInsight}
          readIds={readIds}
          onSelect={markRead}
          onUnlock={() => setKeyOpen(true)}
        />
      </main>

      <footer className="tech-footer">
        <span><Terminal size={13} /> FASTRESEARCH · 学术协同工作台</span>
        <span>专为深度学术研究设计 · 严谨秩序与知识沉淀 <span className="footer-pulse" /></span>
      </footer>

      {casOpen && member && <FastCASDialog member={member} onClose={() => setCasOpen(false)} />}
      {keyOpen && <KeyDialog onClose={closeKeyDialog} onUnlock={unlock} />}
      {adminOpen && (
        <AdminDialog
          session={session}
          onLogin={(value) => {
            setSession(value)
            sessionStorage.setItem(adminStorageKey, JSON.stringify(value))
            setToast('管理员会话已建立')
          }}
          onLogout={() => {
            sessionStorage.removeItem(adminStorageKey)
            setSession(null)
          }}
          onClose={() => setAdminOpen(false)}
        />
      )}
      {toast && <div className="tech-toast"><Check size={15} /> {toast}</div>}
    </div>
  )
}

function WorkflowBoard({ workflow, live, member, selectedId, selectedEntry, selectedTask, busy, onSelect, onOpen, onComplete, onLoadDefault, onUnlock }: {
  workflow: Workflow
  live: boolean
  member: MemberSession | null
  selectedId: string | null
  selectedEntry: Entry | null
  selectedTask?: WorkflowTask
  busy: boolean
  onSelect: (task: WorkflowTask) => void
  onOpen: () => void
  onComplete: () => void
  onLoadDefault: () => void
  onUnlock: () => void
}) {
  const current = workflow.tasks.find((task) => task.status === 'active')
  const Icon = selectedEntry?.Icon ?? ListTodo
  const canComplete = live && selectedTask?.status === 'active'
  const canOpen = Boolean(selectedEntry) && (!live || selectedTask?.status !== 'pending')

  return (
    <section className="workflow-board" id="modules">
      <aside className="workflow-rail">
        <div className="workflow-rail-head">
          <span>研究工序列表</span>
          <small className="rail-counter">{live ? `${workflow.doneCount}/${workflow.total} 已结项` : '标准参考流'}</small>
        </div>
        <ol className="workflow-steps">
          {workflow.tasks.map((task, index) => {
            const entry = ENTRIES[task.module]
            const active = task.id === selectedId
            const StatusIcon = task.status === 'done' ? CheckCircle2 : task.status === 'active' ? CircleDot : Circle
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={`workflow-step is-${task.status} ${active ? 'is-selected' : ''} tone-${entry.tone}`}
                  onClick={() => onSelect(task)}
                  aria-current={task.status === 'active' ? 'step' : undefined}
                >
                  <span className="step-index">0{index + 1}</span>
                  <span className="step-copy">
                    <em>{entry.name} · {entry.label.split(' · ')[0]}</em>
                    <strong>{task.title}</strong>
                  </span>
                  <span className="step-status-icon">
                    <StatusIcon size={16} />
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>

      <article className={`workflow-stage ${selectedEntry ? `tone-${selectedEntry.tone}` : ''}`}>
        {!live && (
          <div className="workflow-banner">
            <div className="workflow-banner-icon"><Layers size={18} /></div>
            <div className="workflow-banner-content">
              {member
                ? <p>尚未收到专属任务列表。外部系统可调用 <code>POST /api/workflow/publish</code> 下发，或先载入标准科研流。</p>
                : <p>输入个人科研 Key 认证后，将自动同步你当前的任务阶段与文献信箱。</p>}
              <div className="workflow-banner-actions">
                {member
                  ? <button type="button" className="outline-button" onClick={onLoadDefault} disabled={busy}>载入标准科研流</button>
                  : <button type="button" className="outline-button" onClick={onUnlock}>认证个人 Key <KeyRound size={14} /></button>}
              </div>
            </div>
          </div>
        )}

        {workflow.completed ? (
          <div className="workflow-complete">
            <div className="complete-icon-box"><CheckCircle2 size={36} /></div>
            <strong>本轮研究任务全部达成</strong>
            <p>所有设定环节均已顺利完成并归档。可在此重新载入新一轮科研工作流。</p>
            {member && <button type="button" className="outline-button" onClick={onLoadDefault} disabled={busy}>重新载入标准科研流</button>}
          </div>
        ) : selectedEntry && selectedTask ? (
          <>
            <div className="stage-top-bar">
              <span className="stage-badge">{selectedEntry.label}</span>
              <span className="card-number">工序 0{(workflow.tasks.findIndex((task) => task.id === selectedTask.id) + 1).toString()} / 0{workflow.tasks.length}</span>
            </div>
            <div className="stage-identity">
              <span className="module-icon"><Icon size={22} /></span>
              <div className="stage-identity-text">
                <span className="module-system-name">{selectedEntry.name} 工作区</span>
                <h2>{selectedTask.title}</h2>
              </div>
            </div>
            <div className="stage-brief">
              <h4>环节任务说明</h4>
              <p>{selectedTask.description || selectedEntry.description}</p>
            </div>
            {current && selectedTask.id !== current.id && live && (
              <div className="workflow-note">
                <span>💡 建议：当前推荐优先推进激活阶段「{ENTRIES[current.module].name}：{current.title}」</span>
              </div>
            )}
            <div className="workflow-actions">
              <button type="button" className="primary-button" onClick={onOpen} disabled={!canOpen || busy}>
                进入 {selectedEntry.name} 工作区 <ArrowUpRight size={15} />
              </button>
              <button type="button" className="outline-button" onClick={onComplete} disabled={!canComplete || busy}>
                {selectedTask.status === 'active' && workflow.currentIndex >= workflow.total - 1 ? '结项并完成全部任务' : '标记完成并进入下一工序 →'}
              </button>
            </div>
          </>
        ) : (
          <div className="workflow-complete">
            <div className="complete-icon-box"><LockKeyhole size={28} /></div>
            <strong>等待任务分配</strong>
            <p>系统将在接入研究流后，按规范展示各功能模块的执行阶段。</p>
          </div>
        )}
      </article>
    </section>
  )
}

function InsightMailbox({ member, items, selectedId, readIds, onSelect, onUnlock }: {
  member: MemberSession | null
  items: InsightItem[]
  selectedId: string | null
  readIds: Set<string>
  onSelect: (id: string) => void
  onUnlock: () => void
}) {
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])
  const unread = items.filter((item) => !readIds.has(item.id)).length
  const detail = splitInsight(selected?.summary)

  return (
    <section className="insight-mailbox">
      <div className="mailbox-head">
        <div className="mailbox-head-meta">
          <span className="intel-kicker"><Inbox size={14} /> FASTINSIGHT · 学术文献速递</span>
          {member && <span className="mailbox-count-pill">{items.length} 篇收录 {unread > 0 && `(${unread} 篇未读)`}</span>}
        </div>
        <h2>飞书学术机器人自动化分拣，按个人科研 Key 专属投递。</h2>
        <p>
          {member
            ? `${member.person} 的专属文献库 · 沉淀关注领域的精选前沿成果与趋势洞察。`
            : '使用管理员分发的个人科研 Key 认证后，FastInsight 自动归纳的论文摘要与启发将安全呈现在此。'}
        </p>
      </div>

      {!member ? (
        <div className="mailbox-locked">
          <div className="locked-icon-wrap"><LockKeyhole size={24} /></div>
          <strong>学术信箱暂未认证</strong>
          <p>遵循实验室知识保护规范，个人文献订阅与飞书分拣推送需凭个人 Key 访问。</p>
          <button type="button" className="outline-button" onClick={onUnlock}>认证并解锁信箱 <KeyRound size={14} /></button>
        </div>
      ) : (
        <div className="mailbox-body">
          <div className="mailbox-list" role="list">
            {items.length === 0 ? (
              <div className="mailbox-empty">
                <Inbox size={28} className="mailbox-empty-icon" />
                <p>暂无新收录的文献卡片</p>
                <small>FastInsight 在飞书群内完成分拣后将实时推送到此。</small>
              </div>
            ) : items.map((item) => {
              const active = (selected?.id ?? '') === item.id
              const unreadItem = !readIds.has(item.id)
              return (
                <button
                  type="button"
                  role="listitem"
                  key={item.id}
                  className={`mailbox-row ${active ? 'is-active' : ''} ${unreadItem ? 'is-unread' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="mailbox-dot" aria-hidden="true" />
                  <span className="mailbox-row-copy">
                    <em>{item.direction ? `论文研读 · ${item.direction}` : '学术前沿卡片'}</em>
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
                <header className="paper-header">
                  <span className="paper-tag">📄 {selected.direction ? `研究方向 · ${selected.direction}` : '学术成果'}</span>
                  <time className="paper-time">{formatTime(selected.receivedAt)}</time>
                </header>
                <h3 className="paper-title">{selected.title}</h3>

                <div className="paper-meta-grid">
                  {selected.authors && (
                    <div className="paper-meta-row">
                      <span className="meta-label">作者团队</span>
                      <span className="meta-val">{selected.authors}</span>
                    </div>
                  )}
                  {selected.venue && (
                    <div className="paper-meta-row">
                      <span className="meta-label">收录期刊/会议</span>
                      <span className="meta-val">{selected.venue}</span>
                    </div>
                  )}
                  {selected.url && (
                    <div className="paper-meta-row">
                      <span className="meta-label">文献来源</span>
                      <span className="meta-val paper-link-text">{selected.url}</span>
                    </div>
                  )}
                </div>

                {detail.abstract && (
                  <div className="paper-abstract-box">
                    <div className="box-title">【论文核心摘要 ABSTRACT】</div>
                    <p className="mailbox-summary">{detail.abstract}</p>
                  </div>
                )}

                {detail.trend && (
                  <div className="paper-trend-box">
                    <div className="box-title">【前沿趋势与启发 KEY INSIGHTS】</div>
                    <p className="mailbox-summary">{detail.trend}</p>
                  </div>
                )}

                <div className="paper-card-footer">
                  <small className="paper-note">由 FastInsight 算法引擎分拣归档</small>
                  {selected.url && (
                    <a className="primary-button paper-open-btn" href={selected.url} target="_blank" rel="noreferrer">
                      查看原文文献 <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div className="mailbox-empty">请在左侧列表选择卡片查看文献详情。</div>
            )}
          </article>
        </div>
      )}
    </section>
  )
}

function Dialog({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`tech-dialog ${wide ? 'admin-dialog' : ''}`} role="dialog" aria-modal="true">
        <div className="dialog-title">
          <span>{title}</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function KeyDialog({ onClose, onUnlock }: { onClose: () => void; onUnlock: (key: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onUnlock(value)
    } catch (err) {
      setError(err instanceof Error ? err.message : '科研凭证无效，请核对后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog title="科研凭证认证 · ACCESS KEY" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <p>输入由课题组或管理员分发的个人科研 Key，解锁专属研究任务流水线与 FastInsight 文献信箱。</p>
        <label htmlFor="personal-key">个人科研凭证 (PERSONAL KEY)</label>
        <div className="input-wrap">
          <KeyRound size={15} />
          <input
            id="personal-key"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="fk_••••••••••••••••"
            autoFocus
          />
        </div>
        {error && <span className="form-error">{error}</span>}
        <button type="submit" className="primary-button full-button" disabled={loading}>
          {loading ? '正在验证凭证…' : '验证凭证并进入工作空间'} <ArrowUpRight size={15} />
        </button>
      </form>
    </Dialog>
  )
}

function AdminDialog({ session, onLogin, onLogout, onClose }: {
  session: AdminSession | null
  onLogin: (value: AdminSession) => void
  onLogout: () => void
  onClose: () => void
}) {
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

  useEffect(() => { void refresh() }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const value = await request<{ session: string; username: string; expiresAt: number }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      const next = { token: value.session, username: value.username, expiresAt: value.expiresAt }
      onLogin(next)
      setError('')
      await refresh(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查账号密码')
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
    <Dialog title={session ? '科研凭证管理 · KEY CONTROL' : '管理员身份鉴权 · AUTHENTICATION'} onClose={onClose} wide={Boolean(session)}>
      {session ? (
        <div className="admin-active">
          <div className="admin-status-badge">
            <ShieldCheck size={26} />
            <div>
              <strong>管理员会话已建立</strong>
              <small>已连接凭证数据库 · 登录身份：{session.username}</small>
            </div>
          </div>
          <form className="key-create-form" onSubmit={createKey}>
            <input
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              placeholder="科研成员姓名（须与 FastInsight 名册一致）"
              required
            />
            <button type="submit" className="outline-button"><Plus size={14} /> 生成个人 Key</button>
          </form>
          {newKey && (
            <div className="new-key-box">
              <span className="new-key-label">新生成凭证（请立即复制备份）：</span>
              <code className="new-key-code">{newKey}</code>
            </div>
          )}
          {error && <span className="form-error">{error}</span>}
          <div className="admin-key-list">
            {keys.length === 0 ? (
              <p className="mailbox-empty">暂无已分发的科研 Key</p>
            ) : keys.map((item) => (
              <div className="admin-key-row" key={item.id}>
                <span className="key-row-info">
                  <b>{item.person}</b>
                  <code>{item.keyPreview}</code>
                  {item.active === false && <span className="key-status-disabled">已注销</span>}
                </span>
                <button
                  type="button"
                  className="icon-button key-del-btn"
                  onClick={() => { void removeKey(item.id) }}
                  aria-label={`注销 ${item.person} 的 Key`}
                  title="注销此 Key"
                  disabled={busyId === item.id}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="outline-button full-button" onClick={onClose}>返回工作台</button>
          <button type="button" className="text-button" onClick={() => dropSession('')}>退出管理员会话</button>
        </div>
      ) : (
        <form className="dialog-form" onSubmit={submit}>
          <p>管理员登录后可为实验室成员颁发、查看及吊销科研访问凭证。</p>
          <label htmlFor="admin-user">管理员账号 (USERNAME)</label>
          <input
            id="admin-user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="admin"
          />
          <label htmlFor="admin-pass">管理员密码 (PASSWORD)</label>
          <input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
          {error && <span className="form-error">{error}</span>}
          <button type="submit" className="primary-button full-button">登录管理后台 <ArrowUpRight size={15} /></button>
        </form>
      )}
    </Dialog>
  )
}

export default App2

function FastCASDialog({member, onClose}: {member: MemberSession; onClose: () => void}) {
  const [link, setLink] = useState<{state: string} | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => { const value = await request<{link: {state: string} | null}>('/api/auth/fastcas/status', {}, member); setLink(value.link); setLoaded(true) }
  useEffect(() => { void load().catch(err => setError(err.message)) }, [])
  async function act(action: 'link' | 'revoke' | 'reconcile') {
    setBusy(true); setError('')
    try {
      const result = await request<{url?: string}>('/api/auth/fastcas/' + action, {method: 'POST', body: JSON.stringify({key})}, member)
      setKey('')
      if (result.url) window.location.assign(result.url)
      else await load()
    } catch (err) { setError(err instanceof Error ? err.message : '操作未完成') }
    finally { setBusy(false) }
  }
  return <Dialog title="FastCAS 账号认证" onClose={onClose}><div className="dialog-form">
    <p>{!loaded ? '正在读取状态…' : !link ? '尚未认证' : link.state === 'active' ? '已认证' : '认证待完成'}</p>
    <p>关联当前项目账号，个人内容保持不变。原 Key 登录继续可用。</p>
    <label>当前账号的原 Key<input type="password" maxLength={256} autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loaded && (!link ? <button disabled={busy || !key} onClick={() => void act('link')}>认证当前账号</button> : <>
      {link.state === 'prepared' && <button disabled={busy} onClick={() => void act('reconcile')}>重试完成认证</button>}
      <button disabled={busy || !key} onClick={() => void act('revoke')}>解除认证</button>
    </>)}
  </div></Dialog>
}
