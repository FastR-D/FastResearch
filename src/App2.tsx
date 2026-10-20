import { ArrowUpRight, BookOpenText, CalendarCheck, CalendarClock, Check, CheckCircle2, Circle, CircleDot, Clock, ExternalLink, FlaskConical, Inbox, KeyRound, Languages, Layers, ListTodo, LockKeyhole, LogIn, Moon, Newspaper, PenLine, Plus, RefreshCw, Save, Settings2, ShieldCheck, Sun, Terminal, Trash2, UsersRound, X } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTranslator, getInitialLocale, saveLocale, type Locale, type Translate } from './i18n'

type EntryId = 'fast-write' | 'fast-read' | 'fast-news' | 'fast-ppt'
type SsoEntryId = 'fast-read' | 'fast-news'
type WorkflowModule = EntryId | 'fast-ppt' | 'fast-lab'
type Entry = { id: EntryId; name: string; label: string; description: string; Icon: typeof BookOpenText; url?: string; tone: string }
type BearerSession = { token: string }
type AdminSession = BearerSession & { username: string; expiresAt: number }
type MemberSession = BearerSession & { person: string; keyId: string; expiresAt: number; source?: string; accountId?: string }
type PersonalKey = { id: string; person: string; keyPreview: string; active: boolean; createdAt?: string; expiresAt?: string | null }
type InsightItem = { id: string; title: string; summary?: string; url?: string; source?: string; direction?: string; authors?: string; venue?: string; receivedAt?: string }
type TaskStatus = 'pending' | 'active' | 'done'
type WorkspaceView = 'today' | 'workflow' | 'insight' | 'team' | 'routing'
type WorkspaceDirection = 'forward' | 'backward'
type WorkflowTask = { id: string; module: WorkflowModule; title: string; description: string; status: TaskStatus; completedAt?: string | null }
type Workflow = { id: string; title: string; source?: string; receivedAt?: string; currentIndex: number; doneCount: number; total: number; completed: boolean; currentTask?: WorkflowTask | null; tasks: WorkflowTask[] }
type FastTaskTodayItem = { id: string; taskId?: string | null; kind?: string; title: string; commitment?: string; minimumAction?: string; status: string; completionType?: string; completionSummary?: string; targetMinutes?: number; position?: number; workspace?: { system: string; label: string; url?: string } | null }
type FastTaskTodayProgress = { total: number; completed: number; inProgress: number; planned: number; skipped: number }
type FastTaskToday = { configured?: boolean; received: boolean; date?: string; timezone?: string; planStatus?: string; planRevision?: number; updatedAt?: string; items: FastTaskTodayItem[]; progress: FastTaskTodayProgress; error?: string }
type TeamWorkflow = { keyId: string; person: string; workflow: Workflow | null; today?: FastTaskToday | null }
type PendingLaunch = { entryId: EntryId; popup: Window | null }
type RosterOwner = { name: string; feishu_open_id?: string; [key: string]: unknown }
type RosterDirection = { name: string; priority?: number; keywords: string[]; owners: RosterOwner[]; [key: string]: unknown }
type FastInsightRoster = { directions: RosterDirection[]; default_owner?: RosterOwner; [key: string]: unknown }

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`
const adminStorageKey = 'fastresearch-admin-session'
const memberStorageKey = 'fastresearch-member-session'
const personalKeyStorage = 'fastresearch-personal-key'
const MODULE_ORDER: EntryId[] = ['fast-news', 'fast-read', 'fast-write']
const WORKSPACE_VIEWS: WorkspaceView[] = ['today', 'workflow', 'insight', 'team', 'routing']
const SSO_AUDIENCE: Record<SsoEntryId, 'fast-news' | 'fast-read'> = { 'fast-read': 'fast-read', 'fast-news': 'fast-news' }
const ENTRY_CONFIG: Record<EntryId, { nameKey: string; labelKey: string; descriptionKey: string; Icon: typeof BookOpenText; url?: string; tone: string }> = {
  'fast-write': { nameKey: 'entry.fast-write.name', labelKey: 'entry.fast-write.label', descriptionKey: 'entry.fast-write.description', Icon: PenLine, url: import.meta.env.VITE_WRITE_URL || 'http://127.0.0.1:3003', tone: 'blue' },
  'fast-read': { nameKey: 'entry.fast-read.name', labelKey: 'entry.fast-read.label', descriptionKey: 'entry.fast-read.description', Icon: BookOpenText, url: import.meta.env.VITE_READ_URL || 'http://127.0.0.1:3015', tone: 'blue' },
  'fast-news': { nameKey: 'entry.fast-news.name', labelKey: 'entry.fast-news.label', descriptionKey: 'entry.fast-news.description', Icon: Newspaper, url: import.meta.env.VITE_FASTNEWS_URL || 'http://127.0.0.1:4173', tone: 'blue' },
  'fast-ppt': { nameKey: 'entry.fast-ppt.name', labelKey: 'entry.fast-ppt.label', descriptionKey: 'entry.fast-ppt.description', Icon: Layers, url: import.meta.env.VITE_FASTPPT_URL || '/fastppt/', tone: 'blue' },
}
const WORKFLOW_MODULE_NAMES: Record<WorkflowModule, string> = {
  'fast-ppt': 'FastPPT',
  'fast-write': 'FastWrite',
  'fast-read': 'FastRead',
  'fast-news': 'FastNews',
  'fast-lab': 'FastLab',
}

function createEntries(t: Translate): Record<EntryId, Entry> {
  return Object.fromEntries(Object.entries(ENTRY_CONFIG).map(([id, config]) => [id, { id: id as EntryId, name: t(config.nameKey), label: t(config.labelKey), description: t(config.descriptionKey), Icon: config.Icon, url: config.url, tone: config.tone }])) as Record<EntryId, Entry>
}

function createPreviewWorkflow(t: Translate): Workflow {
  const modules = MODULE_ORDER
  const tasks = modules.map((module, index) => ({ id: `preview-${module}`, module, title: t(`task.${module}.title`), description: t(`task.${module}.description`), status: index === 0 ? 'active' as const : 'pending' as const, completedAt: null }))
  return { id: 'preview', title: t('workflow.defaultTitle'), source: 'preview', currentIndex: 0, doneCount: 0, total: tasks.length, completed: false, tasks }
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

function getWorkflowEntry(entries: Record<EntryId, Entry>, module: WorkflowModule) {
  return Object.prototype.hasOwnProperty.call(entries, module) ? entries[module as EntryId] : null
}

function getWorkflowModuleName(entries: Record<EntryId, Entry>, module: WorkflowModule) {
  return getWorkflowEntry(entries, module)?.name ?? WORKFLOW_MODULE_NAMES[module] ?? module
}

function App2() {
  // Default to the light BlockSec-inspired blue research theme
  const [dark, setDark] = useState(() => localStorage.getItem('fastresearch-theme') === 'dark')
  const [locale, setLocale] = useState<Locale>(getInitialLocale)
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
  const [teamWorkflows, setTeamWorkflows] = useState<TeamWorkflow[]>([])
  const [fastTaskToday, setFastTaskToday] = useState<FastTaskToday | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('today')
  const [workspaceDirection, setWorkspaceDirection] = useState<WorkspaceDirection>('forward')
  const [busy, setBusy] = useState(false)
  const pendingLaunch = useRef<PendingLaunch | null>(null)
  const pendingFastTaskLaunch = useRef<string | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const lastWorkspaceWheel = useRef(0)
  const t = useMemo(() => createTranslator(locale), [locale])
  const entries = useMemo(() => createEntries(t), [t])
  const previewWorkflow = useMemo(() => createPreviewWorkflow(t), [t])
  const visibleWorkflow = workflow ?? previewWorkflow
  const selectedTask = visibleWorkflow.tasks.find((task) => task.id === selectedTaskId) ?? visibleWorkflow.tasks.find((task) => task.status === 'active') ?? visibleWorkflow.tasks[0]
  const selectedEntry = selectedTask ? getWorkflowEntry(entries, selectedTask.module) : null
  const expireAdminSession = useCallback(() => {
    sessionStorage.removeItem(adminStorageKey)
    setSession(null)
  }, [])

  const changeLocale = () => {
    const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
    setLocale(next)
    saveLocale(next)
  }

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
    const flag = new URLSearchParams(window.location.search).get('fastcas')
    if (!flag) return
    const url = new URL(window.location.href)
    url.searchParams.delete('fastcas')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    if (flag === 'needs_link' || flag === 'disabled') {
      setToast(flag === 'disabled' ? t('cas.disabled') : t('cas.needsLink'))
      return
    }
    void request<{ session: string; person: string; keyId: string; accountId: string; source: string; expiresAt: number }>('/api/content/me').then((result) => {
      const value = { token: '', person: result.person, keyId: result.keyId, accountId: result.accountId, source: result.source, expiresAt: result.expiresAt }
      sessionStorage.setItem(memberStorageKey, JSON.stringify(value))
      setMember(value)
      setToast(flag === 'linked' ? t('cas.linked') : t('toast.unlocked', { person: result.person }))
    }).catch(() => setToast(t('error.memberExpired')))
  }, [t])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    void request('/api/admin/keys', {}, session).catch((err) => {
      if (cancelled) return
      sessionStorage.removeItem(adminStorageKey)
      setSession(null)
      setToast(err instanceof Error ? err.message : t('error.adminExpired'))
    })
    return () => { cancelled = true }
  }, [session, t])

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
      setTeamWorkflows([])
      setFastTaskToday(null)
      setSelectedTaskId(previewWorkflow.tasks[0]?.id ?? null)
      return
    }
    setReadIds(readKey(member.keyId))
    let cancelled = false
    const load = async () => {
      try {
        const [data, team, today] = await Promise.all([
          request<{ insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/me', {}, member),
          request<{ members: TeamWorkflow[] }>('/api/workflow/team', {}, member),
          request<{ today: FastTaskToday }>('/api/fasttask/today', {}, member),
        ])
        if (cancelled) return
        setInsightItems(data.insightItems ?? [])
        setWorkflow(data.workflow ?? null)
        setTeamWorkflows(team.members ?? [])
        setFastTaskToday(today.today ?? null)
      } catch (err) {
        if (cancelled) return
        sessionStorage.removeItem(memberStorageKey)
        setMember(null)
        setToast(err instanceof Error ? err.message : t('error.memberExpired'))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [member, previewWorkflow, t])

  useEffect(() => {
    if (!visibleWorkflow.tasks.length) return
    setSelectedTaskId((current) => visibleWorkflow.tasks.some((task) => task.id === current) ? current : (visibleWorkflow.tasks.find((task) => task.status === 'active') ?? visibleWorkflow.tasks[0]).id)
  }, [visibleWorkflow])

  useEffect(() => {
    const root = workspaceRef.current
    if (!root) return
    const switchOnWheel = (event: globalThis.WheelEvent) => {
      if (!(event.target instanceof Element) || Math.abs(event.deltaY) < 8) return
      if (!root.contains(event.target)) return
      for (let scrollable: Element | null = event.target; scrollable && scrollable !== root; scrollable = scrollable.parentElement) {
        const element = scrollable as HTMLElement
        const overflow = getComputedStyle(element).overflowY
        if (!['auto', 'scroll'].includes(overflow) || element.scrollHeight <= element.clientHeight + 2) continue
        if ((event.deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 2) ||
            (event.deltaY < 0 && element.scrollTop > 2)) return
      }
      if (Date.now() - lastWorkspaceWheel.current < 450) return
      event.preventDefault()
      lastWorkspaceWheel.current = Date.now()
      const delta = event.deltaY > 0 ? 1 : -1
      setWorkspaceView((current) => {
        const currentIndex = WORKSPACE_VIEWS.indexOf(current)
        const nextIndex = (currentIndex + delta + WORKSPACE_VIEWS.length) % WORKSPACE_VIEWS.length
        setWorkspaceDirection(delta > 0 ? 'forward' : 'backward')
        return WORKSPACE_VIEWS[nextIndex]
      })
    }
    root.addEventListener('wheel', switchOnWheel, { passive: false })
    return () => root.removeEventListener('wheel', switchOnWheel)
  }, [])

  const setWorkspacePage = (view: WorkspaceView) => {
    if (view === workspaceView) return
    const currentIndex = WORKSPACE_VIEWS.indexOf(workspaceView)
    const nextIndex = WORKSPACE_VIEWS.indexOf(view)
    const forwardDistance = (nextIndex - currentIndex + WORKSPACE_VIEWS.length) % WORKSPACE_VIEWS.length
    const backwardDistance = (currentIndex - nextIndex + WORKSPACE_VIEWS.length) % WORKSPACE_VIEWS.length
    setWorkspaceDirection(forwardDistance <= backwardDistance ? 'forward' : 'backward')
    setWorkspaceView(view)
  }

  const openInNewTab = (url: string, popup?: Window | null) => {
    if (popup && !popup.closed) {
      popup.opener = null
      popup.location.replace(url)
      return popup
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) setToast(t('error.popupBlocked'))
    return opened
  }

  const launchSsoEntry = async (entryId: SsoEntryId, memberSession: MemberSession, popup?: Window | null) => {
    const entry = entries[entryId]
    if (!entry.url) {
      popup?.close()
      setToast(t('error.notConfigured', { name: entry.name }))
      return
    }
    try {
      await request('/api/content/me', {}, memberSession)
      const target = new URL(entry.url, window.location.origin)
      const launch = new URL(apiUrl('/api/sso/launch'), window.location.origin)
      launch.searchParams.set('audience', SSO_AUDIENCE[entryId])
      launch.searchParams.set('next', target.toString())
      openInNewTab(launch.toString(), popup)
    } catch (err) {
      popup?.close()
      sessionStorage.removeItem(memberStorageKey)
      setMember(null)
      pendingLaunch.current = { entryId, popup: popup ?? null }
      setKeyOpen(true)
      setToast(err instanceof Error ? err.message : t('error.ssoFailed', { name: entry.name }))
    }
  }

  const launchFastWriteEntry = async (memberSession: MemberSession, popup?: Window | null) => {
    try {
      await request('/api/content/me', {}, memberSession)
    } catch (err) {
      popup?.close()
      sessionStorage.removeItem(memberStorageKey)
      setMember(null)
      pendingLaunch.current = { entryId: 'fast-write', popup: popup ?? null }
      setKeyOpen(true)
      setToast(err instanceof Error ? err.message : t('error.fastWriteFailed'))
      return
    }
    try {
      const result = await request<{ url?: string }>('/api/fastwrite/login-url', { method: 'POST', body: JSON.stringify({}) }, memberSession)
      if (!result.url) throw new Error(t('error.fastWriteFailed'))
      openInNewTab(result.url, popup)
    } catch (err) {
      popup?.close()
      setToast(err instanceof Error ? err.message : t('error.fastWriteFailed'))
    }
  }

  const launchFastTaskSso = useCallback(async (memberSession: MemberSession, next: string) => {
    try {
      await request('/api/content/me', {}, memberSession)
      const launch = new URL(apiUrl('/api/sso/launch'), window.location.origin)
      launch.searchParams.set('audience', 'fast-task')
      launch.searchParams.set('next', next)
      window.location.assign(launch.toString())
    } catch (err) {
      sessionStorage.removeItem(memberStorageKey)
      setMember(null)
      pendingFastTaskLaunch.current = next
      setKeyOpen(true)
      setToast(err instanceof Error ? err.message : t('error.ssoFailed', { name: 'FastTask' }))
    }
  }, [t])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('launch') !== 'fast-task') return
    const rawNext = params.get('next') ?? ''
    const page = new URL(window.location.href)
    page.searchParams.delete('launch')
    page.searchParams.delete('next')
    window.history.replaceState({}, '', page.pathname + page.search + page.hash)
    let next = ''
    try {
      const callback = new URL(rawNext)
      const state = callback.searchParams.get('state') ?? ''
      if (!['http:', 'https:'].includes(callback.protocol) ||
          callback.pathname !== '/api/v1/auth/fastresearch/callback' ||
          callback.username || callback.password ||
          !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new Error('invalid callback')
      next = callback.toString()
    } catch {
      setToast(t('error.ssoFailed', { name: 'FastTask' }))
      return
    }
    pendingFastTaskLaunch.current = next
    if (member) void launchFastTaskSso(member, next)
    else setKeyOpen(true)
  }, [launchFastTaskSso, member, t])

  const openEntry = (entry: Entry, popup?: Window | null) => {
    const tab = popup && !popup.closed ? popup : window.open('about:blank', '_blank')
    if (!tab) {
      setToast(t('error.popupBlocked'))
      return
    }
    // FastWrite resolves its public URL and account login token on the server.
    // The browser build must not require a separate VITE_WRITE_URL setting.
    if (entry.id === 'fast-write') {
      if (member) void launchFastWriteEntry(member, tab)
      else {
        pendingLaunch.current = { entryId: entry.id, popup: tab }
        setKeyOpen(true)
      }
      return
    }
    if (!entry.url) {
      tab.close()
      setToast(t('error.notConfigured', { name: entry.name }))
      return
    }
    if (isSsoEntry(entry.id)) {
      const ssoId = entry.id
      if (member) void launchSsoEntry(ssoId, member, tab)
      else {
        pendingLaunch.current = { entryId: ssoId, popup: tab }
        setKeyOpen(true)
      }
      return
    }
    openInNewTab(entry.url, tab)
  }

  const unlock = async (key: string) => {
    const result = await request<{ session: string; person: string; keyId: string; expiresAt: number; insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/unlock', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
    const value: MemberSession = { token: result.session, person: result.person, keyId: result.keyId, expiresAt: result.expiresAt, source: 'key' }
    sessionStorage.setItem(memberStorageKey, JSON.stringify(value))
    sessionStorage.removeItem(personalKeyStorage)
    setMember(value)
    setInsightItems(result.insightItems ?? [])
    setWorkflow(result.workflow ?? null)
    setKeyOpen(false)
    setToast(t('toast.unlocked', { person: result.person }))
    const pending = pendingLaunch.current
    if (pending) {
      pendingLaunch.current = null
      if (pending.entryId === 'fast-write') await launchFastWriteEntry(value, pending.popup)
      else if (isSsoEntry(pending.entryId)) await launchSsoEntry(pending.entryId, value, pending.popup)
      else pending.popup?.close()
    }
    const fastTaskNext = pendingFastTaskLaunch.current
    if (fastTaskNext) {
      pendingFastTaskLaunch.current = null
      await launchFastTaskSso(value, fastTaskNext)
    }
  }

  const refreshFastTaskToday = async () => {
    if (!member) {
      setKeyOpen(true)
      return
    }
    try {
      const [today, team] = await Promise.all([
        request<{ today: FastTaskToday }>('/api/fasttask/today', {}, member),
        request<{ members: TeamWorkflow[] }>('/api/workflow/team', {}, member),
      ])
      setFastTaskToday(today.today ?? null)
      setTeamWorkflows(team.members ?? [])
    } catch (err) {
      setToast(err instanceof Error ? err.message : t('error.request'))
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
    pendingLaunch.current?.popup?.close()
    pendingLaunch.current = null
    pendingFastTaskLaunch.current = null
    setKeyOpen(false)
  }

  const selectTask = (task: WorkflowTask) => {
    if (!workflow && task.status === 'pending') {
      setSelectedTaskId(task.id)
      return
    }
    if (workflow && task.status === 'pending') {
      setToast(t('toast.activeRequired'))
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
      setTeamWorkflows((current) => current.map((item) => item.keyId === member.keyId ? { ...item, workflow: result.workflow } : item))
      setSelectedTaskId(result.workflow.currentTask?.id ?? result.workflow.tasks[0]?.id ?? null)
      setToast(t('toast.defaultLoaded'))
    } catch (err) {
      setToast(err instanceof Error ? err.message : t('toast.loadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const completeTask = async (task: WorkflowTask) => {
    if (!member) {
      setKeyOpen(true)
      setToast(t('toast.unlockRequired'))
      return
    }
    if (!workflow) {
      setToast(t('toast.queueRequired'))
      return
    }
    if (task.status !== 'active') {
      setToast(t('toast.activeRequired'))
      return
    }
    const upcoming = workflow.tasks.find((item) => item.status === 'pending')
    const upcomingEntry = upcoming ? getWorkflowEntry(entries, upcoming.module) : null
    const nextTab = upcomingEntry?.url ? window.open('about:blank', '_blank') : null
    setBusy(true)
    try {
      const result = await request<{ workflow: Workflow; nextTask?: WorkflowTask | null }>('/api/workflow/complete', { method: 'POST', body: JSON.stringify({ taskId: task.id }) }, member)
      setWorkflow(result.workflow)
      setTeamWorkflows((current) => current.map((item) => item.keyId === member.keyId ? { ...item, workflow: result.workflow } : item))
      const next = result.nextTask ?? result.workflow.currentTask ?? null
      if (next) {
        setSelectedTaskId(next.id)
        setToast(t('toast.stageComplete', { name: getWorkflowModuleName(entries, next.module) }))
        const nextEntry = getWorkflowEntry(entries, next.module)
        if (nextEntry) openEntry(nextEntry, nextTab)
        else nextTab?.close()
      } else {
        nextTab?.close()
        setSelectedTaskId(result.workflow.tasks[result.workflow.tasks.length - 1]?.id ?? task.id)
        setToast(t('toast.allComplete'))
      }
    } catch (err) {
      nextTab?.close()
      setToast(err instanceof Error ? err.message : t('toast.completeFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tech-app">
      <header className="tech-header">
        <a className="brand-mark" href="#home" aria-label={t('header.homeAria')}>
          <span className="brand-icon"><FlaskConical size={16} /></span>
          <span className="brand-title"><b>Fast</b>Research</span>
          <small>{t('header.workspace')}</small>
        </a>
        <div className="header-status">
          <span className="status-dot" />
          <span>{t('header.status')}</span>
          <span className="status-separator">/</span>
          <span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.')}</span>
        </div>
        <div className="header-actions">
          {casEnabled && (member ? <button type="button" className="ghost-button" onClick={() => setCasOpen(true)}>FastCAS 认证</button> : <a className="ghost-button" href={apiUrl('/api/auth/fastcas/login')}>使用 FastCAS 登录</a>)}
          {member && <span className="header-identity" title={`当前认证成员：${member.person}`}>👤 {member.person}</span>}
          <button type="button" className="ghost-button" onClick={() => window.location.assign(apiUrl('/api/fasttask/login'))}>
            <ListTodo size={14} />
            <span>{t('header.fastTask')}</span>
          </button>
          <button type="button" className="ghost-button" onClick={() => setKeyOpen(true)}>
            <KeyRound size={14} />
            <span>{member ? t('header.keyActive') : t('header.authenticate')}</span>
          </button>
          <button type="button" className="icon-button" onClick={() => setDark((value) => !value)} aria-label={dark ? t('header.lightTheme') : t('header.darkTheme')} title={dark ? t('header.lightTheme') : t('header.darkTheme')}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="icon-button" onClick={() => setAdminOpen(true)} aria-label={t('header.adminLogin')} title={t('header.adminTitle')}>
            {session ? <ShieldCheck size={16} /> : <LogIn size={15} />}
          </button>
          <button type="button" className="icon-button" onClick={changeLocale} aria-label={t('language.switch')} title={t('language.switch')}>
            <Languages size={15} />
          </button>
        </div>
      </header>

      <main id="home" className="tech-main">
        <section className="workflow-hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <Layers size={13} />
              <span>{t('hero.eyebrow')}</span>
              <span className="eyebrow-ver">v3.0.0</span>
            </div>
            <h1>{t('hero.title1')}<br /><em>{t('hero.title2')}</em></h1>
            <p>{t('hero.description')}</p>
          </div>
        </section>

        <section className="research-workspace" ref={workspaceRef} aria-label={t('workspace.title')}>
          <div className="workspace-toolbar">
            <div className="workspace-heading">
              <span className="workspace-kicker">FASTRESEARCH / WORKSPACE</span>
              <h2>{t('workspace.title')}</h2>
            </div>
            <div className="workspace-tabs" aria-label={t('workspace.views')}>
              <button type="button" className={workspaceView === 'today' ? 'is-active' : ''} aria-pressed={workspaceView === 'today'} onClick={() => setWorkspacePage('today')}>
                <CalendarCheck size={17} /> <span>{t('workspace.today')}</span>
              </button>
              <button type="button" className={workspaceView === 'workflow' ? 'is-active' : ''} aria-pressed={workspaceView === 'workflow'} onClick={() => setWorkspacePage('workflow')}>
                <ListTodo size={17} /> <span>{t('workspace.workflow')}</span>
              </button>
              <button type="button" className={workspaceView === 'insight' ? 'is-active' : ''} aria-pressed={workspaceView === 'insight'} onClick={() => setWorkspacePage('insight')}>
                <Inbox size={17} /> <span>{t('workspace.insight')}</span>
                {member && insightItems.some((item) => !readIds.has(item.id)) && <span className="workspace-unread">{insightItems.filter((item) => !readIds.has(item.id)).length}</span>}
              </button>
              <button type="button" className={workspaceView === 'team' ? 'is-active' : ''} aria-pressed={workspaceView === 'team'} onClick={() => setWorkspacePage('team')}>
                <UsersRound size={17} /> <span>{t('team.label')}</span>
              </button>
              <button type="button" className={workspaceView === 'routing' ? 'is-active' : ''} aria-pressed={workspaceView === 'routing'} onClick={() => setWorkspacePage('routing')}>
                <Settings2 size={17} /> <span>{t('workspace.routing')}</span>
              </button>
            </div>
          </div>

          <div className={`workspace-page workspace-page--${workspaceView} workspace-page--${workspaceDirection}`} key={workspaceView}>
            {workspaceView === 'today' && (
              <div className="workspace-today-page">
                <FastTaskTodayPanel
                  member={member}
                  today={fastTaskToday}
                  onUnlock={() => setKeyOpen(true)}
                  onRefresh={() => { void refreshFastTaskToday() }}
                  onOpenFastTask={() => window.location.assign(apiUrl('/api/fasttask/login'))}
                  t={t}
                />
              </div>
            )}
            {workspaceView === 'workflow' && (
              <WorkflowBoard
                workflow={visibleWorkflow}
                entries={entries}
                t={t}
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
            )}
            {workspaceView === 'insight' && (
              <InsightMailbox
                member={member}
                items={insightItems}
                selectedId={selectedInsight}
                readIds={readIds}
                onSelect={markRead}
                onUnlock={() => setKeyOpen(true)}
                onOpenFastRead={() => openEntry(entries['fast-read'])}
                t={t}
              />
            )}
            {workspaceView === 'team' && (
              <div className="workspace-team-page">
                <TeamProgressPanel members={teamWorkflows} currentKeyId={member?.keyId ?? null} loading={Boolean(member) && teamWorkflows.length === 0} t={t} />
              </div>
            )}
            {workspaceView === 'routing' && (
              <FastInsightRosterEditor
                session={session}
                onAdminOpen={() => setAdminOpen(true)}
                onSessionExpired={expireAdminSession}
                onToast={setToast}
                t={t}
              />
            )}
          </div>
        </section>
      </main>

      <footer className="tech-footer">
        <div className="footer-brand"><Terminal size={13} /> <span>{t('footer.left')}</span></div>
        <div className="footer-tagline"><span>{t('footer.right')}</span><span className="footer-pulse" aria-hidden="true" /></div>
      </footer>

      {casOpen && member && <FastCASDialog member={member} onClose={() => setCasOpen(false)} t={t} />}
      {keyOpen && <KeyDialog onClose={closeKeyDialog} onUnlock={unlock} casAvailable={casEnabled} t={t} />}
      {adminOpen && (
        <AdminDialog
          session={session}
          onLogin={(value) => {
            setSession(value)
            sessionStorage.setItem(adminStorageKey, JSON.stringify(value))
            setToast(t('admin.connected'))
          }}
          onLogout={() => {
            sessionStorage.removeItem(adminStorageKey)
            setSession(null)
          }}
          onClose={() => setAdminOpen(false)}
          t={t}
        />
      )}
      {toast && <div className="tech-toast"><Check size={15} /> {toast}</div>}
    </div>
  )
}

function fastTaskStatusKey(status: string) {
  return ['satisfied', 'in_progress', 'planned', 'skipped', 'not_completed'].includes(status) ? `today.status.${status}` : 'today.status.default'
}

function FastTaskStatusIcon({ status }: { status: string }) {
  if (status === 'satisfied') return <CheckCircle2 size={16} />
  if (status === 'in_progress') return <CircleDot size={16} />
  if (status === 'skipped' || status === 'not_completed') return <X size={16} />
  return <Circle size={16} />
}

function FastTaskTodayPanel({ member, today, onUnlock, onRefresh, onOpenFastTask, t }: {
  member: MemberSession | null
  today: FastTaskToday | null
  onUnlock: () => void
  onRefresh: () => void
  onOpenFastTask: () => void
  t: Translate
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

function TeamProgressPanel({ members, currentKeyId, loading, t }: { members: TeamWorkflow[]; currentKeyId: string | null; loading: boolean; t: Translate }) {
  const assigned = members.filter((member) => member.workflow)
  const completed = assigned.reduce((total, member) => total + (member.workflow?.doneCount ?? 0), 0)
  const taskTotal = assigned.reduce((total, member) => total + (member.workflow?.total ?? 0), 0)

  return (
    <section className="team-progress-panel" aria-label={t('team.label')}>
      <div className="team-progress-heading">
        <span className="intel-kicker"><ListTodo size={14} /> {t('team.label')}</span>
        <span className="meter-badge">{t('team.people', { count: members.length })}</span>
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

function WorkflowBoard({ workflow, live, member, selectedId, selectedEntry, selectedTask, busy, onSelect, onOpen, onComplete, onLoadDefault, onUnlock, entries, t }: {
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
  entries: Record<EntryId, Entry>
  t: Translate
}) {
  const current = workflow.tasks.find((task) => task.status === 'active')
  const Icon = selectedEntry?.Icon ?? ListTodo
  const canComplete = live && selectedTask?.status === 'active'
  const canOpen = Boolean(selectedEntry) && (!live || selectedTask?.status !== 'pending')

  return (
    <section className="workflow-board" id="modules">
      <aside className="workflow-rail">
        <div className="workflow-rail-head">
          <span>{t('board.list')}</span>
          <small className="rail-counter">{live ? t('board.completed', { done: workflow.doneCount, total: workflow.total }) : t('board.reference')}</small>
        </div>
        <ol className="workflow-steps">
          {workflow.tasks.map((task, index) => {
            const entry = getWorkflowEntry(entries, task.module)
            const active = task.id === selectedId
            const StatusIcon = task.status === 'done' ? CheckCircle2 : task.status === 'active' ? CircleDot : Circle
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={`workflow-step is-${task.status} ${active ? 'is-selected' : ''} tone-${entry?.tone ?? 'neutral'}`}
                  onClick={() => onSelect(task)}
                  aria-current={task.status === 'active' ? 'step' : undefined}
                >
                  <span className="step-index">0{index + 1}</span>
                  <span className="step-copy">
                    <em>{getWorkflowModuleName(entries, task.module)} · {entry?.label.split(' · ')[0] ?? t('board.externalModuleLabel')}</em>
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
        {selectedEntry && selectedEntry.id !== 'fast-ppt' && <ModuleShowcase entries={entries} selectedId={selectedEntry.id} t={t} />}
        {!live && (
          <div className="workflow-banner">
            <div className="workflow-banner-icon"><Layers size={18} /></div>
            <div className="workflow-banner-content">
              {member
                ? <p>{t('board.noWorkflow')}</p>
                : <p>{t('board.authSync')}</p>}
              <div className="workflow-banner-actions">
                {member
                  ? <button type="button" className="outline-button" onClick={onLoadDefault} disabled={busy}>{t('board.loadDefault')}</button>
                  : <button type="button" className="outline-button" onClick={onUnlock}>{t('board.authenticate')} <KeyRound size={14} /></button>}
              </div>
            </div>
          </div>
        )}

        {workflow.completed ? (
          <div className="workflow-complete">
            <div className="complete-icon-box"><CheckCircle2 size={36} /></div>
            <strong>{t('board.allDone')}</strong>
            <p>{t('board.allDoneDescription')}</p>
            {member && <button type="button" className="outline-button" onClick={onLoadDefault} disabled={busy}>{t('board.reload')}</button>}
          </div>
        ) : selectedTask ? (
          <>
            <div className="stage-top-bar">
              <span className="stage-badge">{selectedEntry?.label ?? t('board.externalModuleLabel')}</span>
              <span className="card-number">{t('board.stage', { current: String(workflow.tasks.findIndex((task) => task.id === selectedTask.id) + 1).padStart(2, '0'), total: String(workflow.tasks.length).padStart(2, '0') })}</span>
            </div>
            <div className="stage-identity">
              <span className="module-icon"><Icon size={22} /></span>
              <div className="stage-identity-text">
                <span className="module-system-name">{getWorkflowModuleName(entries, selectedTask.module)}</span>
                <h2>{selectedTask.title}</h2>
              </div>
            </div>
            <div className="stage-brief">
              <h4>{t('board.brief')}</h4>
              <p>{selectedTask.description || selectedEntry?.description || t('board.externalModuleDescription')}</p>
            </div>
            {current && selectedTask.id !== current.id && live && (
              <div className="workflow-note">
                <span>{t('board.suggestion', { name: getWorkflowModuleName(entries, current.module), title: current.title })}</span>
              </div>
            )}
            <div className="workflow-actions">
              {selectedEntry && (
                <button type="button" className="primary-button" onClick={onOpen} disabled={!canOpen || busy}>
                  {t('board.open', { name: selectedEntry.name })} <ArrowUpRight size={15} />
                </button>
              )}
              <button type="button" className="outline-button" onClick={onComplete} disabled={!canComplete || busy}>
                {selectedTask.status === 'active' && workflow.currentIndex >= workflow.total - 1 ? t('board.finish') : t('board.finishNext')}
              </button>
            </div>
          </>
        ) : (
          <div className="workflow-complete">
            <div className="complete-icon-box"><LockKeyhole size={28} /></div>
            <strong>{t('board.waiting')}</strong>
            <p>{t('board.waitingDescription')}</p>
          </div>
        )}
      </article>
    </section>
  )
}

function ModuleShowcase({ entries, selectedId, t }: { entries: Record<EntryId, Entry>; selectedId: EntryId; t: Translate }) {
  const [previewId, setPreviewId] = useState<EntryId>(selectedId)
  useEffect(() => setPreviewId(selectedId), [selectedId])
  const entry = entries[previewId]
  const Icon = entry.Icon

  return (
    <section className="module-showcase" aria-label={t('showcase.title')}>
      <div className="module-showcase-header">
        <span className="workspace-kicker">{t('showcase.title')}</span>
        <div className="module-switcher" aria-label={t('showcase.views')}>
          {MODULE_ORDER.map((id) => (
            <button key={id} type="button" className={previewId === id ? 'is-active' : ''} aria-pressed={previewId === id} onClick={() => setPreviewId(id)}>{entries[id].name}</button>
          ))}
        </div>
      </div>
      <div className="module-showcase-content" key={previewId}>
        <div className={`module-visual module-visual--${previewId}`} aria-hidden="true">
          {previewId === 'fast-news' && <><span className="news-orbit orbit-one" /><span className="news-orbit orbit-two" /><span className="news-orbit orbit-three" /><span className="news-sweep" /><span className="news-node node-one" /><span className="news-node node-two" /><span className="news-node node-three" /><span className="visual-center"><Newspaper size={29} /></span></>}
          {previewId === 'fast-write' && <><span className="write-sheet sheet-back" /><span className="write-sheet sheet-front"><i /><i /><i /><i /><b /></span><span className="visual-center"><PenLine size={25} /></span></>}
          {previewId === 'fast-read' && <><span className="read-page page-left"><i /><i /><i /><i /></span><span className="read-page page-right"><i /><i /><i /><i /><span className="read-scan" /></span><span className="visual-center"><BookOpenText size={26} /></span></>}
        </div>
        <div className="module-overview">
          <span className="module-overview-index">0{MODULE_ORDER.indexOf(previewId) + 1} / 03</span>
          <h3><Icon size={23} /> {entry.name}</h3>
          <p>{t(`showcase.${previewId}.detail`)}</p>
          <ul>
            {[1, 2, 3].map((index) => <li key={index}><Check size={13} />{t(`showcase.${previewId}.point${index}`)}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}

function InsightMailbox({ member, items, selectedId, readIds, onSelect, onUnlock, onOpenFastRead, t }: {
  member: MemberSession | null
  items: InsightItem[]
  selectedId: string | null
  readIds: Set<string>
  onSelect: (id: string) => void
  onUnlock: () => void
  onOpenFastRead: () => void
  t: Translate
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
                <button
                  type="button"
                  role="listitem"
                  key={item.id}
                  className={`mailbox-row ${active ? 'is-active' : ''} ${unreadItem ? 'is-unread' : ''}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="mailbox-dot" aria-hidden="true" />
                  <span className="mailbox-row-copy">
                    <em>{item.direction ? t('insight.reading', { direction: item.direction }) : t('insight.card')}</em>
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
                      <span className="meta-label">{t('insight.source')}</span>
                      <span className="meta-val paper-link-text">{selected.url}</span>
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

function FastInsightRosterEditor({ session, onAdminOpen, onSessionExpired, onToast, t }: {
  session: AdminSession | null
  onAdminOpen: () => void
  onSessionExpired: () => void
  onToast: (message: string) => void
  t: Translate
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

function Dialog({ title, children, onClose, wide, t }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; t: Translate }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`tech-dialog ${wide ? 'admin-dialog' : ''}`} role="dialog" aria-modal="true">
        <div className="dialog-title">
          <span>{title}</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('dialog.close')}><X size={15} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function KeyDialog({ onClose, onUnlock, casAvailable, t }: { onClose: () => void; onUnlock: (key: string) => Promise<void>; casAvailable: boolean; t: Translate }) {
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
      setError(err instanceof Error ? err.message : t('key.invalid'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog title={t('key.title')} onClose={onClose} t={t}>
      <form className="dialog-form" onSubmit={submit}>
        <p>{t('key.description')}</p>
        <label htmlFor="personal-key">{t('key.label')}</label>
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
          {loading ? t('key.verifying') : t('key.submit')} <ArrowUpRight size={15} />
        </button>
      </form>
      {casAvailable && <a className="outline-button full-button" href={apiUrl(`/api/auth/fastcas/login?return_to=${encodeURIComponent(window.location.pathname)}`)}>{t('cas.login')}</a>}
    </Dialog>
  )
}

function AdminDialog({ session, onLogin, onLogout, onClose, t }: {
  session: AdminSession | null
  onLogin: (value: AdminSession) => void
  onLogout: () => void
  onClose: () => void
  t: Translate
}) {
  const [username, setUsername] = useState('admin')
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
      const message = err instanceof Error ? err.message : t('admin.loading')
      if (message.includes('管理员登录已失效')) dropSession(t('admin.relogin'))
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
      setError(err instanceof Error ? err.message : t('admin.loginFailed'))
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
      const message = err instanceof Error ? err.message : t('admin.createFailed')
      if (message.includes('管理员登录已失效')) dropSession(t('admin.relogin'))
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
      const message = err instanceof Error ? err.message : t('admin.deleteFailed')
      if (message.includes('管理员登录已失效')) dropSession(t('admin.relogin'))
      else setError(message)
    } finally {
      setBusyId('')
    }
  }

  const rotatePersonalKey = async (id: string) => {
    if (!session) return
    setBusyId(id)
    try {
      const result = await request<{ key: string }>(`/api/admin/keys/${id}/rotate`, { method: 'POST' }, session)
      setNewKey(result.key)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cas.failed'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <Dialog title={session ? t('admin.manage') : t('admin.auth')} onClose={onClose} wide={Boolean(session)} t={t}>
      {session ? (
        <div className="admin-active">
          <div className="admin-status-badge">
            <ShieldCheck size={26} />
            <div>
              <strong>{t('admin.connected')}</strong>
              <small>{t('admin.database', { username: session.username })}</small>
            </div>
          </div>
          <form className="key-create-form" onSubmit={createKey}>
            <input
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              placeholder={t('admin.personPlaceholder')}
              required
            />
            <button type="submit" className="outline-button"><Plus size={14} /> {t('admin.create')}</button>
          </form>
          {newKey && (
            <div className="new-key-box">
              <span className="new-key-label">{t('admin.newKey')}</span>
              <code className="new-key-code">{newKey}</code>
            </div>
          )}
          {error && <span className="form-error">{error}</span>}
          <div className="admin-key-list">
            {keys.length === 0 ? (
              <p className="mailbox-empty">{t('admin.none')}</p>
            ) : keys.map((item) => (
              <div className="admin-key-row" key={item.id}>
                <span className="key-row-info">
                  <b>{item.person}</b>
                  <code>{item.keyPreview}</code>
                  {item.active === false && <span className="key-status-disabled">{t('admin.revoked')}</span>}
                </span>
                <button type="button" className="icon-button" onClick={() => { void rotatePersonalKey(item.id) }} aria-label={t('admin.rotate')} title={t('admin.rotate')} disabled={busyId === item.id}>
                  <KeyRound size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button key-del-btn"
                  onClick={() => { void removeKey(item.id) }}
                  aria-label={t('admin.revokeAria', { person: item.person })}
                  title={t('admin.revokeTitle')}
                  disabled={busyId === item.id}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="outline-button full-button" onClick={onClose}>{t('admin.back')}</button>
          <button type="button" className="text-button" onClick={() => dropSession('')}>{t('admin.logout')}</button>
        </div>
      ) : (
        <form className="dialog-form" onSubmit={submit}>
          <p>{t('admin.loginDescription')}</p>
          <label htmlFor="admin-user">{t('admin.username')}</label>
          <input
            id="admin-user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="admin"
          />
          <label htmlFor="admin-pass">{t('admin.password')}</label>
          <input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
          {error && <span className="form-error">{error}</span>}
          <button type="submit" className="primary-button full-button">{t('admin.login')} <ArrowUpRight size={15} /></button>
        </form>
      )}
    </Dialog>
  )
}

export default App2

function FastCASDialog({member, onClose, t}: {member: MemberSession; onClose: () => void; t: Translate}) {
  const [link, setLink] = useState<{state: string} | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => { const value = await request<{link: {state: string} | null}>('/api/auth/fastcas/status', {}, member); setLink(value.link); setLoaded(true) }, [member])
  useEffect(() => { void load().catch(err => setError(err.message)) }, [load])
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
  return <Dialog title="FastCAS 账号认证" onClose={onClose} t={t}><div className="dialog-form">
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
