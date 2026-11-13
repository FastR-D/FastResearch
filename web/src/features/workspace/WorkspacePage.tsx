import { AppActivityPanel } from './AppActivityPanel'
import { Alert, Badge, Button, Divider, Section, Toolbar } from '@fastrd/ui-react'
import { ArrowUpRight,CalendarCheck,Check,Inbox,LogIn,LogOut,Menu,Moon,Settings2,ShieldCheck,Sunrise,UsersRound } from 'lucide-react'
import { Fragment,useCallback,useEffect,useMemo,useState } from 'react'
import { APIError,apiUrl,request } from '../../shared/api/client'
import { renewCASIfNeeded, renewCASLogin } from '../../shared/auth/cas-renewal'
import { useColorMode } from '../../shared/auth/color-mode'
import { text as t } from '../../shared/copy'
import { products } from '../../shared/products'
import type { Entry,EntryId,InsightItem,MemberSession,TeamWorkflow,Workflow,WorkflowModule,WorkspaceApp,WorkspaceView } from '../../shared/types'
import { BrandLink } from '../../shared/ui/BrandLink'
import { Dialog } from '../../shared/ui/Dialog'
import { PanelBody, PanelHeading } from '../../shared/ui/WorkspaceLayout'
import { AdminDialog } from '../admin/AdminDialog'
import { FastInsightRosterEditor } from '../admin/FastInsightRosterEditor'
import { FastCASDialog } from '../auth/FastCASDialog'
import { KeyDialog } from '../auth/KeyDialog'
import { useIdentity } from '../auth/use-identity'
import { InsightMailbox } from '../insight/InsightMailbox'
import { TeamProgressPanel } from '../team/TeamProgressPanel'
import { AppTasksPanel } from '../today/AppTasksPanel'
import { MODULE_HUB_ORDER,createEntries } from './entries'
const personalKeyStorage = 'fastresearch-personal-key'
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

function WorkspacePage() {
  const { dark, toggle: toggleColorMode } = useColorMode()
  const [keyOpen, setKeyOpen] = useState(false)
  const [casOpen, setCasOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [insightItems, setInsightItems] = useState<InsightItem[]>([])
  const [selectedInsight, setSelectedInsight] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState('')
  const { member, setMember, session, setSession, casEnabled, casLoginEnabled, legacyKeyEnabled } = useIdentity(setToast)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamWorkflows, setTeamWorkflows] = useState<TeamWorkflow[]>([])
  const [selectedModule, setSelectedModule] = useState<WorkflowModule>(() => {
    const tool = new URLSearchParams(window.location.search).get('tool') as EntryId | null
    return tool && MODULE_HUB_ORDER.includes(tool) ? tool : 'fast-news'
  })
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => {
    const view = new URLSearchParams(window.location.search).get('view')
    return view === 'today' || view === 'insight' || view === 'team' ? view : 'workflow'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [appCatalog, setAppCatalog] = useState<WorkspaceApp[] | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [routingOpen, setRoutingOpen] = useState(false)
  useEffect(() => {
    document.documentElement.lang = 'zh-CN'
    document.title = `FastResearch · ${t('header.workspace')}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('desk.body'))
  }, [])
  const entries = useMemo(() => createEntries(t), [])
  const expireAdminSession = useCallback(() => {
    setSession(null)
  }, [setSession])


  useEffect(() => {
    let cancelled = false
    void request<{ apps: WorkspaceApp[] }>('/api/workspace/apps')
      .then(value => { if (!cancelled) setAppCatalog(value.apps) })
      .catch(() => { if (!cancelled) setCatalogError(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search)
      const tool = params.get('tool') as EntryId
      setSelectedModule(MODULE_HUB_ORDER.includes(tool) ? tool : 'fast-news')
      const view = params.get('view')
      setWorkspaceView(view === 'today' || view === 'insight' || view === 'team' ? view : 'workflow')
      setSidebarOpen(false)
      requestAnimationFrame(() => document.getElementById('workspace-content')?.scrollTo(0, 0))
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setSidebarOpen(false)
        document.getElementById('workspace-menu')?.focus()
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [sidebarOpen])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    void request('/api/admin/keys', {}, session).catch((err) => {
      if (cancelled) return
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) setSession(null)
      setToast(err instanceof Error ? err.message : t('error.adminExpired'))
    })
    return () => { cancelled = true }
  }, [session, setSession])

  useEffect(() => {
    if (!session) setRoutingOpen(false)
  }, [session, setSession])

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
      setTeamWorkflows([])
      setTeamLoading(false)
      return
    }
    setTeamLoading(true)
    setReadIds(readKey(member.keyId))
    let cancelled = false
    const load = async () => {
      if (document.visibilityState !== 'visible' || (casEnabled && renewCASIfNeeded(member))) return
      try {
        const [data, team] = await Promise.all([
          request<{ insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/me', {}, member),
          request<{ members: TeamWorkflow[] }>('/api/workflow/team', {}, member),
        ])
        if (cancelled) return
        setInsightItems(data.insightItems ?? [])
        setTeamWorkflows(team.members ?? [])
        setTeamLoading(false)
      } catch (err) {
        if (cancelled) return
        if (err instanceof APIError && err.status === 401) {
          if (member.source === 'fastcas' && casEnabled && renewCASLogin()) return
          setMember(null)
        }
        setToast(err instanceof Error ? err.message : t('error.memberExpired'))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [member, setMember, casEnabled])

  const navigateWorkspace = (view: WorkspaceView, tool = selectedModule) => {
    setWorkspaceView(view)
    setSelectedModule(tool)
    setSidebarOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    url.searchParams.delete('tool')
    if (view === 'workflow') url.searchParams.set('tool', tool)
    else url.searchParams.set('view', view)
    window.history.pushState({}, '', url.pathname + url.search)
    requestAnimationFrame(() => {
      const content = document.getElementById('workspace-content')
      if (sidebarOpen) content?.focus({ preventScroll: true })
      content?.scrollTo(0, 0)
    })
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      await request('/api/content/logout', { method: 'POST' }, member ?? undefined)
      setMember(null)
      setSession(null)
      setCasOpen(false)
      sessionStorage.removeItem(personalKeyStorage)
      setToast('已退出 FastResearch')
    } catch (err) { setToast(err instanceof Error ? err.message : '退出失败，请重试') }
    finally { setLoggingOut(false) }
  }

  const openInNewTab = (url: string, popup?: Window | null) => {
    if (popup && !popup.closed) {
      popup.opener = null
      popup.location.replace(url)
      return popup
    }
    const opened = window.open('about:blank', '_blank')
    if (opened) { opened.opener = null; opened.location.replace(url) }
    else setToast(t('error.popupBlocked'))
    return opened
  }

  const openApp = (id: string) => {
    const app = appCatalog?.find(item => item.id === id)
    if (!app?.configured || !app.launchPath) { setToast('该应用入口尚未配置'); return }
    openInNewTab(apiUrl(app.launchPath))
  }
  const openEntry = (entry: Entry) => openApp(entry.id)

  const unlock = async (key: string) => {
    const result = await request<{ session: string; person: string; keyId: string; expiresAt: number; insightItems?: InsightItem[]; workflow?: Workflow | null }>('/api/content/unlock', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
    const value: MemberSession = { token: result.session, person: result.person, keyId: result.keyId, expiresAt: result.expiresAt, source: 'key' }
    sessionStorage.removeItem(personalKeyStorage)
    setMember(value)
    setInsightItems(result.insightItems ?? [])
    setKeyOpen(false)
    setToast(t('toast.unlocked', { person: result.person }))
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
    setKeyOpen(false)
  }

  const selectedEntry = entries[selectedModule]
  const product = products.find(item => item.tool === selectedModule)!
  const app = appCatalog?.find(item => item.id === selectedModule)
  const showOverview = !member || !app?.configured
  const requestedApp = new URLSearchParams(window.location.search).get('app')
  const taskApp = appCatalog?.find(item => item.id === requestedApp && item.capabilities?.includes('tasks')) ?? appCatalog?.find(item => item.capabilities?.includes('tasks'))
  const launchApp = workspaceView === 'today' ? taskApp : app
  const ToolIcon = selectedEntry.Icon
  const ToolContainer = showOverview ? Section : 'div'
  const ToolBody = showOverview ? PanelBody : Fragment
  const auxiliaryViews = [
    { view: 'today', label: '今日任务', Icon: CalendarCheck },
    { view: 'insight', label: 'FastInsight 信箱', Icon: Inbox },
    { view: 'team', label: '团队进度', Icon: UsersRound },
  ] as const

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--fastui-page)] text-[var(--fastui-text)] font-[var(--fastui-font)] text-sm leading-6">
      <a className="fastui-link sr-only focus:not-sr-only" href="#workspace-content">跳到主要内容</a>
      <header className="shrink-0 z-20 bg-[var(--fastui-surface)]">
        <Toolbar label="工作台顶栏" className="min-h-14 px-4">
          <Button id="workspace-menu" variant="icon" className="md:hidden" aria-label="工具导航" aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={18} /></Button>
          <BrandLink href="/workspace" />
          {member && <span className="md:hidden ml-auto max-w-24 truncate" title={member.person}>{member.person}</span>}
          <nav className="flex basis-full md:basis-auto md:flex-1 flex-wrap items-center justify-between md:justify-end gap-2 min-w-0" aria-label="账号与设置">
            <a className="fastui-button fastui-button--quiet" href="/" aria-label="了解 FastResearch"><span className="hidden sm:inline">了解 FastResearch</span><span className="sm:hidden">产品总览</span><ArrowUpRight size={14} /></a>
            {member ? <><span className="hidden md:inline max-w-32 truncate" title={member.person}>{member.person}</span><Button variant="quiet" onClick={() => void logout()} loading={loggingOut} aria-label="退出登录"><LogOut size={15} /><span className="sr-only md:not-sr-only">退出</span></Button></> : <Button variant="quiet" onClick={() => setKeyOpen(true)}><LogIn size={15} />登录</Button>}
            <Button variant="quiet" aria-label="CAS认证" onClick={() => { if (!casEnabled) setToast('当前部署尚未启用 CAS 认证'); else if (member) setCasOpen(true); else setKeyOpen(true) }} title={casEnabled ? '查看 FastCAS 账号' : '当前部署尚未启用 CAS 认证'}><ShieldCheck size={15} /><span className="hidden sm:inline">CAS认证</span><span className="sm:hidden">CAS</span></Button>
            <Button variant="icon" onClick={toggleColorMode} aria-label={dark ? '切换浅色模式' : '切换深色模式'}>{dark ? <Sunrise size={18} /> : <Moon size={18} />}</Button>
          </nav>
        </Toolbar>
      </header>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <aside className={`${sidebarOpen ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-64 shrink-0 min-h-0 max-h-[65dvh] md:max-h-none md:h-full overflow-y-auto border-r border-[var(--fastui-border)] bg-[var(--fastui-surface)]`} id="workspace-sidebar" aria-label="工作台导航" data-fastui-density="touch">
          <div className="flex flex-col flex-1 gap-7 px-4 pt-7 pb-4">
            <div>
              <div className="flex items-center justify-between px-3 mb-3"><h2 className="fastui-heading">科研工具</h2><Badge>{MODULE_HUB_ORDER.length}</Badge></div>
              <nav className="grid gap-2" aria-label="科研工具">
                {MODULE_HUB_ORDER.map(id => {
                  const entry = entries[id]
                  const Icon = entry.Icon
                  const active = workspaceView === 'workflow' && selectedModule === id
                  return <Button variant="navigation" size="md" key={id} aria-pressed={active} aria-current={active ? 'page' : undefined} onClick={() => navigateWorkspace('workflow', id)}><span className="flex w-full items-center gap-3 px-2 text-sm"><Icon size={18} />{entry.name}</span></Button>
                })}
              </nav>
            </div>
            <div>
              <h2 className="fastui-heading px-3 mb-3">个人与团队</h2>
              <nav className="grid gap-2" aria-label="个人与团队">
                {auxiliaryViews.map(({ view, label, Icon }) => <Button variant="navigation" size="md" key={view} aria-pressed={workspaceView === view} aria-current={workspaceView === view ? 'page' : undefined} onClick={() => navigateWorkspace(view)}><span className="flex w-full items-center gap-3 px-2 text-sm"><Icon size={18} className="shrink-0" /><span>{label}</span>{view === 'insight' && member && insightItems.some(item => !readIds.has(item.id)) && <Badge className="ml-auto">{insightItems.filter(item => !readIds.has(item.id)).length}</Badge>}</span></Button>)}
              </nav>
            </div>
            <div className="mt-auto pt-4 grid gap-2">
              <Divider />
              {session && <Button variant="navigation" size="md" onClick={() => setRoutingOpen(true)}><span className="flex w-full items-center gap-3 px-2 text-sm"><Settings2 size={18} />论文分发设置</span></Button>}
              <Button variant="navigation" size="md" onClick={() => {
                setAdminOpen(true)
                if (member) void request<{ username: string; expiresAt: number }>('/api/admin/me').then(value => setSession({ token: '', username: value.username, expiresAt: value.expiresAt })).catch(() => setSession(null))
              }} aria-label="管理员登录"><span className="flex w-full items-center gap-3 px-2 text-sm"><ShieldCheck size={18} />{session ? '管理账号' : '管理'}</span></Button>
            </div>
          </div>
        </aside>
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 md:p-8 lg:p-10" id="workspace-content" tabIndex={-1}>
          <div className="mx-auto max-w-6xl grid gap-6 md:gap-8">
            <div className="flex items-center justify-between gap-3">
              <h1 className="fastui-heading min-w-0 text-2xl">{workspaceView === 'workflow' ? selectedEntry.name : auxiliaryViews.find(item => item.view === workspaceView)?.label}</h1>
              {(workspaceView === 'workflow' || workspaceView === 'today') && <div className="shrink-0" data-fastui-density="touch"><Button variant="primary" onClick={() => { if (launchApp) openApp(launchApp.id) }} disabled={!launchApp?.configured}>{appCatalog === null && !catalogError ? '正在读取…' : workspaceView === 'today' ? `打开 ${taskApp?.name ?? '任务应用'}` : app?.auth === 'cas' ? '使用 CAS 进入' : `打开 ${product.name}`}<ArrowUpRight size={16} /></Button></div>}
            </div>
            {workspaceView === 'workflow' ? <ToolContainer key={selectedModule} className={showOverview ? undefined : 'grid gap-6 md:gap-8'}>
              {showOverview && <PanelHeading><ToolIcon size={20} />{product.category}</PanelHeading>}
              <ToolBody>
                {showOverview && <>
                <h2 className="fastui-heading text-xl">{product.promise}</h2>
                <p>{product.description}</p>
                <ul className="grid gap-3">{product.points.map(point => <li className="flex items-start gap-2" key={point}><Check size={16} className="shrink-0" aria-hidden="true" />{point}</li>)}</ul>
                </>}
                {showOverview && <div><a className="fastui-button fastui-button--quiet" href={`/intro/${product.id}`}>了解 {product.name}<ArrowUpRight size={15} /></a></div>}
                {showOverview && <Alert tone={catalogError ? 'danger' : 'info'}>{catalogError ? '暂时无法读取应用入口，请刷新重试。' : appCatalog === null ? '正在读取应用入口。' : !app?.configured ? '当前部署尚未配置该工具入口。' : app.auth === 'cas' ? '通过 CAS 登录子应用，已有 CAS 会话将自动完成认证。' : selectedModule === 'fast-lab' ? '打开实验工作台；CAS 身份关联请在应用设置中完成。' : '打开本地演示工作台，使用应用自身的登录方式。'}</Alert>}
                {app?.capabilities?.includes('activity') && <AppActivityPanel appId={selectedModule} name={product.name} member={member} onLogin={() => setKeyOpen(true)} />}
                {showOverview && <>
                <Divider />
                <h3 className="fastui-heading">从这里开始</h3>
                <ol className="list-decimal pl-5 grid gap-3">{product.steps.map(step => <li key={step}>{step}</li>)}</ol>
                </>}
              </ToolBody>
            </ToolContainer> : <>
              {workspaceView === 'today' && <AppTasksPanel app={taskApp} catalogLoading={appCatalog === null && !catalogError} member={member} onUnlock={() => setKeyOpen(true)} t={t} />}
              {workspaceView === 'insight' && <InsightMailbox member={member} items={insightItems} selectedId={selectedInsight} readIds={readIds} onSelect={markRead} onUnlock={() => setKeyOpen(true)} onOpenFastRead={() => openEntry(entries['fast-read'])} t={t} />}
              {workspaceView === 'team' && <TeamProgressPanel members={teamWorkflows} currentKeyId={member?.keyId ?? null} loading={teamLoading} onClose={() => navigateWorkspace('workflow')} app={taskApp} t={t} />}
            </>}
          </div>
        </main>
      </div>

      {casOpen && member && <FastCASDialog member={member} onClose={() => setCasOpen(false)} t={t} />}
      {keyOpen && <KeyDialog onClose={closeKeyDialog} onUnlock={unlock} casAvailable={casLoginEnabled} legacyKeyEnabled={legacyKeyEnabled} t={t} />}
      {adminOpen && (
        <AdminDialog
          session={session}
          onLogout={() => {
            setSession(null)
            setMember(null)
          }}
          onClose={() => setAdminOpen(false)}
          t={t}
        />
      )}
      {routingOpen && session && (
        <Dialog title={t('workspace.routing')} onClose={() => setRoutingOpen(false)} t={t}>
          <FastInsightRosterEditor
            session={session}
            onAdminOpen={() => setAdminOpen(true)}
            onSessionExpired={expireAdminSession}
            onToast={setToast}
            t={t}
          />
        </Dialog>
      )}
      {toast && <div className="fixed bottom-4 right-4 left-4 md:left-auto z-30"><Alert>{toast}</Alert></div>}
    </div>
  )
}


export default WorkspacePage
