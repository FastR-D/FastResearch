import { AccountMenu } from '../../shared/ui/AccountMenu'
import { AppActivityPanel } from './AppActivityPanel'
import { Alert, Badge, Button, Dialog, Divider, PanelHeader, Section, Toolbar } from '@fastrd/ui-react'
import { ArrowUpRight,CalendarCheck,Inbox,LogIn,LogOut,Menu,Moon,Settings2,ShieldCheck,Sunrise,UsersRound,X } from 'lucide-react'
import { Fragment,useCallback,useEffect,useMemo,useState } from 'react'
import { APIError,apiUrl,request } from '../../shared/api/client'
import { renewCASIfNeeded, renewCASLogin } from '../../shared/auth/cas-renewal'
import { useColorMode } from '../../shared/auth/color-mode'
import { text as t } from '../../shared/copy'
import { productHref, products } from '../../shared/products'
import type { AdminSession,Entry,EntryId,InsightItem,TeamWorkflow,Workflow,WorkflowModule,WorkspaceApp,WorkspaceView } from '../../shared/types'
import { BrandLink } from '../../shared/ui/BrandLink'
import { PanelBody } from '../../shared/ui/WorkspaceLayout'
import { AdminPanel } from '../admin/AdminPanel'
import { FastInsightRosterEditor } from '../admin/FastInsightRosterEditor'
import { FastCASDialog } from '../auth/FastCASDialog'
import { LoginDialog } from '../auth/LoginDialog'
import { useIdentity } from '../auth/use-identity'
import { InsightMailbox } from '../insight/InsightMailbox'
import { TeamProgressPanel } from '../team/TeamProgressPanel'
import { AppTasksPanel } from '../today/AppTasksPanel'
import { MODULE_HUB_ORDER,createEntries } from './entries'
const personalKeyStorage = 'fastresearch-personal-key'
const desktopViewport = '(min-width: 768px)'

function readWorkspaceView(): WorkspaceView {
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'today' || view === 'insight' || view === 'team' || view === 'routing' || view === 'admin' ? view : 'workflow'
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

function WorkspacePage() {
  const { dark, toggle: toggleColorMode } = useColorMode()
  const [loginOpen, setLoginOpen] = useState(false)
  const [casOpen, setCasOpen] = useState(false)
  const [insightItems, setInsightItems] = useState<InsightItem[]>([])
  const [selectedInsight, setSelectedInsight] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState('')
  const { member, setMember, session, setSession, casEnabled } = useIdentity(setToast)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamWorkflows, setTeamWorkflows] = useState<TeamWorkflow[]>([])
  const [selectedModule, setSelectedModule] = useState<WorkflowModule>(() => {
    const tool = new URLSearchParams(window.location.search).get('tool') as EntryId | null
    return tool && MODULE_HUB_ORDER.includes(tool) ? tool : 'fast-news'
  })
  const [workspaceView, setWorkspaceView] = useState(readWorkspaceView)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktop, setDesktop] = useState(() => window.matchMedia(desktopViewport).matches)
  const [appCatalog, setAppCatalog] = useState<WorkspaceApp[] | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  useEffect(() => {
    document.documentElement.lang = 'zh-CN'
    document.title = t('workspace.documentTitle', { title: t('header.workspace') })
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
      setWorkspaceView(readWorkspaceView())
      setSidebarOpen(false)
      requestAnimationFrame(() => document.getElementById('workspace-content')?.scrollTo(0, 0))
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    const viewport = window.matchMedia(desktopViewport)
    const update = () => {
      setDesktop(viewport.matches)
      if (viewport.matches) setSidebarOpen(false)
    }
    update()
    viewport.addEventListener('change', update)
    return () => viewport.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (workspaceView !== 'admin' || !member || member.role === 'admin') return
    let cancelled = false
    void request<Omit<AdminSession, 'token'>>('/api/admin/me', {}, member)
      .then(value => { if (!cancelled) setSession({ token: '', username: value.username, expiresAt: value.expiresAt }) })
      .catch(err => {
        if (cancelled) return
        if (err instanceof APIError && (err.status === 401 || err.status === 403)) setSession(null)
        else setToast(err instanceof Error ? err.message : t('error.adminExpired'))
      })
    return () => { cancelled = true }
  }, [workspaceView, member, setSession])

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

  const closeSidebar = () => {
    setSidebarOpen(false)
    requestAnimationFrame(() => document.getElementById('workspace-menu')?.focus({ preventScroll: true }))
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      await request('/api/content/logout', { method: 'POST' }, member ?? undefined)
      setMember(null)
      setSession(null)
      setCasOpen(false)
      sessionStorage.removeItem(personalKeyStorage)
      setToast(t('auth.logoutSuccess'))
    } catch (err) { setToast(err instanceof Error ? err.message : t('auth.logoutFailed')) }
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
    if (!app?.configured || !app.launchPath) { setToast(t('workspace.appNotConfigured')); return }
    openInNewTab(apiUrl(app.launchPath))
  }
  const openEntry = (entry: Entry) => openApp(entry.id)

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

  const selectedEntry = entries[selectedModule]
  const product = products.find(item => item.tool === selectedModule)!
  const app = appCatalog?.find(item => item.id === selectedModule)
  const showOverview = !member || !app?.configured
  const requestedApp = new URLSearchParams(window.location.search).get('app')
  const taskApp = appCatalog?.find(item => item.id === requestedApp && item.capabilities?.includes('tasks')) ?? appCatalog?.find(item => item.capabilities?.includes('tasks'))
  const launchApp = workspaceView === 'today' ? taskApp : app
  const auxiliaryViews = [
    { view: 'today', label: t('today.title'), Icon: CalendarCheck },
    { view: 'insight', label: t('workspace.insightLabel'), Icon: Inbox },
    { view: 'team', label: t('team.label'), Icon: UsersRound },
  ] as const
  const administrationViews = [
    { view: 'routing', label: t('workspace.routing'), Icon: Settings2 },
    { view: 'admin', label: t('admin.manageAccount'), Icon: ShieldCheck },
  ] as const
  const activeProduct = workspaceView === 'workflow' ? product : undefined
  const navigation = (
    <div className="flex flex-col flex-1 gap-7 px-4 pt-7 pb-4">
      <div>
        <div className="flex items-center justify-between px-3 mb-3"><h2 className="fastui-heading">{t('workspace.workflow')}</h2><Badge>{MODULE_HUB_ORDER.length}</Badge></div>
        <nav className="grid gap-2" aria-label={t('workspace.workflow')}>
          {MODULE_HUB_ORDER.map(id => {
            const entry = entries[id]
            const Icon = entry.Icon
            const active = workspaceView === 'workflow' && selectedModule === id
            return <Button variant="navigation" size="md" key={id} aria-pressed={active} aria-current={active ? 'page' : undefined} onClick={() => navigateWorkspace('workflow', id)}><span className="flex w-full items-center gap-3 px-2 text-sm"><Icon size={18} />{entry.name}</span></Button>
          })}
        </nav>
      </div>
      <div>
        <h2 className="fastui-heading px-3 mb-3">{t('workspace.personalAndTeam')}</h2>
        <nav className="grid gap-2" aria-label={t('workspace.personalAndTeam')}>
          {auxiliaryViews.map(({ view, label, Icon }) => <Button variant="navigation" size="md" key={view} aria-pressed={workspaceView === view} aria-current={workspaceView === view ? 'page' : undefined} onClick={() => navigateWorkspace(view)}><span className="flex w-full items-center gap-3 px-2 text-sm"><Icon size={18} className="shrink-0" /><span>{label}</span>{view === 'insight' && member && insightItems.some(item => !readIds.has(item.id)) && <Badge className="ml-auto">{insightItems.filter(item => !readIds.has(item.id)).length}</Badge>}</span></Button>)}
        </nav>
      </div>
      <div className="mt-auto pt-4 grid gap-2">
        <Divider />
        {administrationViews.filter(item => item.view === 'admin' || session).map(({ view, label, Icon }) => (
          <Button key={view} variant="navigation" size="md" aria-pressed={workspaceView === view} aria-current={workspaceView === view ? 'page' : undefined} onClick={() => navigateWorkspace(view)}>
            <span className="flex w-full items-center gap-3 px-2 text-sm"><Icon size={18} className="shrink-0" />{label}</span>
          </Button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--fastui-page)] text-[var(--fastui-text)] font-[var(--fastui-font)] text-sm leading-6">
      <a className="fastui-link sr-only focus:not-sr-only" href="#workspace-content">{t('workspace.skip')}</a>
      <header className="shrink-0 z-20 bg-[var(--fastui-surface)]">
        <Toolbar label={t('workspace.toolbarAria')} className="min-h-14 !flex-nowrap !gap-1 !px-2 !py-1 sm:!gap-2 sm:!px-4" data-fastui-density="touch">
          {!desktop && <Button id="workspace-menu" variant="icon" className="shrink-0" aria-label={t('workspace.toolsAria')} aria-haspopup="dialog" aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={() => setSidebarOpen(true)}><Menu size={18} /></Button>}
          <BrandLink href={activeProduct ? productHref(activeProduct.id) : `${import.meta.env.BASE_URL}intro/`} name={activeProduct?.name} Icon={activeProduct?.Icon} className="min-w-0 !shrink max-[359px]:text-xs" />
          <nav className="ml-auto flex shrink-0 items-center sm:gap-2" aria-label={t('workspace.accountAria')}>
            {member ? <>
              <AccountMenu name={member.person} label={t('workspace.accountAria')} actions={[
                { label: t('auth.certification'), icon: <ShieldCheck size={18} />, onSelect: () => { if (casEnabled) setCasOpen(true); else setToast(t('auth.casNotEnabled')) } },
                { label: t('auth.logout'), icon: <LogOut size={18} />, danger: true, disabled: loggingOut, onSelect: () => void logout() },
              ]} />
            </> : <Button variant="quiet" onClick={() => setLoginOpen(true)}><LogIn size={18} />{t('auth.login')}</Button>}
            <Button variant="icon" onClick={toggleColorMode} aria-label={dark ? t('theme.light') : t('theme.dark')}>{dark ? <Sunrise size={18} /> : <Moon size={18} />}</Button>
          </nav>
        </Toolbar>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {desktop ? (
          <aside id="workspace-sidebar" aria-label={t('workspace.navigationAria')} data-fastui-density="touch" className="flex h-full w-64 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-[var(--fastui-border)] bg-[var(--fastui-surface)]">
            {navigation}
          </aside>
        ) : (
          <Dialog
            id="workspace-sidebar"
            open={sidebarOpen}
            onClose={closeSidebar}
            label={t('workspace.toolsAria')}
            className="!fixed !inset-y-0 !left-0 !right-auto !m-0 !h-dvh !max-h-none !w-72 !max-w-[85vw] !overflow-hidden !rounded-none !border-y-0 !border-l-0 motion-safe:animate-slide-in-left animate-duration-200"
          >
            <div className="flex h-full min-h-0 flex-col" data-fastui-density="touch">
              <PanelHeader className="shrink-0">
                <h2 className="fastui-heading flex-1">{t('workspace.toolsAria')}</h2>
                <Button variant="icon" autoFocus onClick={closeSidebar} aria-label={t('dialog.close')}><X size={18} /></Button>
              </PanelHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                {navigation}
              </div>
            </div>
          </Dialog>
        )}
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 md:p-8 lg:p-10" id="workspace-content" tabIndex={-1}>
          <div className={`mx-auto max-w-6xl gap-6 md:gap-8 ${workspaceView === 'team' && desktop ? 'flex h-full flex-col' : 'grid'}`}>
            {workspaceView !== 'routing' && <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="fastui-heading min-w-0 text-2xl">{workspaceView === 'workflow' ? selectedEntry.name : [...auxiliaryViews, ...administrationViews].find(item => item.view === workspaceView)?.label}</h1>
              {(workspaceView === 'workflow' || workspaceView === 'today') && (
                <div className="ml-auto flex items-center gap-2" data-fastui-density="touch">
                  <Button variant="primary" onClick={() => { if (launchApp) openApp(launchApp.id) }} disabled={!launchApp?.configured}>
                    {appCatalog === null && !catalogError ? t('workspace.reading') : workspaceView === 'today' ? t('workspace.openApp', { name: taskApp?.name ?? t('tasks.appName') }) : app?.auth === 'cas' ? t('workspace.launchCAS') : t('workspace.openApp', { name: product.name })}
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              )}
            </div>}
            {workspaceView === 'workflow' ? <Fragment key={selectedModule}>
              {showOverview && (
                <Section>
                  <PanelBody>
                    <h2 className="fastui-heading text-xl">{product.promise}</h2>
                    <p>{product.description}</p>
                    {catalogError ? <Alert tone="danger">{t('workspace.catalogFailed')}</Alert> : appCatalog !== null && !app?.configured && <Alert tone="info">{t('workspace.toolNotConfigured')}</Alert>}
                  </PanelBody>
                </Section>
              )}
              {app?.capabilities?.includes('activity') && <AppActivityPanel appId={selectedModule} name={product.name} member={member} onLogin={() => setLoginOpen(true)} />}
            </Fragment> : <>
              {workspaceView === 'today' && <AppTasksPanel app={taskApp} catalogLoading={appCatalog === null && !catalogError} member={member} onUnlock={() => setLoginOpen(true)} t={t} />}
              {workspaceView === 'insight' && <InsightMailbox member={member} items={insightItems} selectedId={selectedInsight} readIds={readIds} onSelect={markRead} onUnlock={() => setLoginOpen(true)} onOpenFastRead={() => openEntry(entries['fast-read'])} t={t} />}
              {workspaceView === 'team' && <TeamProgressPanel members={teamWorkflows} currentKeyId={member?.keyId ?? null} loading={teamLoading} desktop={desktop} app={taskApp} t={t} />}
              {workspaceView === 'routing' &&
                <FastInsightRosterEditor session={session} onAdminOpen={() => navigateWorkspace('admin')} onSessionExpired={expireAdminSession} onToast={setToast} t={t} />
              }
              {workspaceView === 'admin' && <AdminPanel session={session} onSessionExpired={expireAdminSession} onLogout={() => {
                setSession(null)
                setMember(null)
              }} t={t} />}
            </>}
          </div>
        </main>
      </div>

      {casOpen && member && <FastCASDialog member={member} onClose={() => setCasOpen(false)} t={t} />}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} casAvailable={casEnabled} t={t} />}
      {toast && <div className="fixed bottom-4 right-4 left-4 md:left-auto z-30"><Alert>{toast}</Alert></div>}
    </div>
  )
}


export default WorkspacePage
