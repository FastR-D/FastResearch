// Legacy console retained for reference; src/main.tsx uses App2.tsx.
import {
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Home,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  LogOut,
  Moon,
  Newspaper,
  PenLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

type EntryId = 'read' | 'write' | 'fast-task' | 'fast-news'
type Entry = { id: EntryId; name: string; Icon: LucideIcon; url?: string }
type Tool = Entry & { eyebrow: string; description: string; tone: 'primary' | 'accent' }
type AdminToken = { id: string; label: string; tokenPreview: string; createdAt: string; expiresAt: string | null; active: boolean }
type AdminEntry = { id: EntryId; name: string; tokens: AdminToken[] }
type AdminSession = { token: string; username: string; expiresAt: number }

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const apiUrl = (path: string) => `${API_BASE}${path}`
const ENTRY_IDS: EntryId[] = ['read', 'write', 'fast-task', 'fast-news']

const ENTRIES: Record<EntryId, Entry> = {
  read: { id: 'read', name: 'Read', Icon: BookOpenText, url: import.meta.env.VITE_READ_URL },
  write: { id: 'write', name: 'Write', Icon: PenLine, url: import.meta.env.VITE_WRITE_URL },
  'fast-task': { id: 'fast-task', name: 'FastTask', Icon: CheckCircle2, url: import.meta.env.VITE_FASTTASK_URL },
  'fast-news': { id: 'fast-news', name: 'FastNews', Icon: Newspaper, url: import.meta.env.VITE_FASTNEWS_URL },
}

const TOOLS: Tool[] = [
  { ...ENTRIES.read, eyebrow: '独立工具 · 阅读工作区', description: '进入研究阅读工作区，整理资料并沉淀你的阅读线索。', tone: 'primary' },
  { ...ENTRIES.write, eyebrow: '独立工具 · 写作工作区', description: '进入研究写作工作区，继续编辑你的研究内容。', tone: 'accent' },
  { ...ENTRIES['fast-task'], eyebrow: '独立工具 · 任务工作区', description: '进入研究任务工作区，集中处理当前项目中的计划与执行事项。', tone: 'primary' },
  { ...ENTRIES['fast-news'], eyebrow: '独立工具 · 资讯工作区', description: '进入研究资讯工作区，查看与你关注方向相关的最新内容。', tone: 'accent' },
]

const adminStorageKey = 'fastresearch-admin-session'

async function request<T>(path: string, init: RequestInit = {}, session?: AdminSession): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`)
  const response = await fetch(apiUrl(path), { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? '请求失败')
  return payload as T
}

function loadAdminSession(): AdminSession | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(adminStorageKey) ?? 'null') as AdminSession | null
    return session && session.expiresAt > Date.now() ? session : null
  } catch {
    return null
  }
}

function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('fastresearch-theme') === 'dark')
  const [guestEntry, setGuestEntry] = useState<Entry | null>(null)
  const [adminSession, setAdminSession] = useState<AdminSession | null>(loadAdminSession)
  const [adminOpen, setAdminOpen] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fastresearch-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openEntry = (entry: Entry) => setGuestEntry(entry)
  const logout = async () => {
    if (adminSession) await request('/api/admin/logout', { method: 'POST' }, adminSession).catch(() => undefined)
    sessionStorage.removeItem(adminStorageKey)
    setAdminSession(null)
    setToast('管理员已退出')
  }

  return (
    <div className="min-h-screen bg-[#f6f7f5] text-gray-900 transition-colors dark:bg-[#151a19] dark:text-gray-100">
      <header className="sticky top-0 z-30 border-b border-[#dce4df] bg-white/95 dark:border-[#2d3934] dark:bg-[#18201d]/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <button type="button" className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="返回首页">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-700 text-white"><Zap className="h-4 w-4" fill="currentColor" /></span>
            <span className="hidden min-w-0 sm:block"><span className="block text-sm font-semibold leading-5">FastResearch</span><span className="block text-[11px] leading-4 text-gray-500 dark:text-gray-400">Research workspace</span></span>
          </button>
          <nav className="mx-auto hidden items-center gap-1 rounded-lg bg-[#eef2ef] p-1 dark:bg-[#202925] md:flex" aria-label="主导航">
            <button type="button" className="flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg border border-[#d4e7df] bg-white px-4 text-sm font-medium text-primary-700 shadow-sm dark:border-[#315147] dark:bg-[#1b2220] dark:text-primary-300" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><Home className="h-4 w-4" />Home</button>
            {TOOLS.slice(0, 2).map((entry) => <button key={entry.id} type="button" className="flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg border border-transparent px-4 text-sm font-medium text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-[#27332e] dark:hover:text-gray-100" onClick={() => openEntry(entry)}><entry.Icon className="h-4 w-4" />{entry.name}</button>)}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {adminSession ? <button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 text-xs font-medium text-primary-700 hover:bg-primary-100 dark:border-primary-900/70 dark:bg-primary-950/40 dark:text-primary-300" onClick={() => setAdminOpen(true)} title="打开管理员后台"><ShieldCheck className="h-4 w-4" /><span className="hidden sm:inline">管理员后台</span></button> : <button type="button" className="icon-button" onClick={() => setAdminOpen(true)} aria-label="管理员登录" title="管理员登录"><LogIn className="h-4 w-4" /></button>}
            <button type="button" className="icon-button" onClick={() => setDark((value) => !value)} aria-label={dark ? '切换到浅色模式' : '切换到深色模式'} title={dark ? '浅色模式' : '深色模式'}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <section className="mb-6 flex items-start justify-between gap-4 animate-slide-down"><div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300"><LayoutDashboard className="h-5 w-5" /></span><div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500"><span>FastResearch</span><ChevronRight className="h-3 w-3" /><span>Home</span></div><h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">研究控制台</h1><p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">使用管理员分发的 Token 进入对应研究工具。</p></div></div><div className="hidden items-center gap-2 pt-1 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Token 由管理员统一管理</span></div></section>
        <section aria-label="工具入口" className="grid gap-4 md:grid-cols-2">{TOOLS.map((tool, index) => <ToolCard key={tool.id} tool={tool} featured={index === 2} onOpen={() => openEntry(tool)} />)}</section>
        <footer className="mt-7 flex flex-col gap-2 border-t border-[#dce4df] pt-4 text-xs text-gray-400 dark:border-[#2d3934] dark:text-gray-500 sm:flex-row sm:items-center sm:justify-between"><span>FastResearch Workspace</span><span className="flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />游客使用管理员分发的独立 Token</span></footer>
      </main>

      {guestEntry && <GuestTokenDialog entry={guestEntry} onClose={() => setGuestEntry(null)} onToast={setToast} />}
      {adminOpen && <AdminDialog session={adminSession} onLogin={(session) => { setAdminSession(session); sessionStorage.setItem(adminStorageKey, JSON.stringify(session)) }} onLogout={logout} onClose={() => setAdminOpen(false)} onToast={setToast} />}
      {toast && <div className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-[#dce4df] bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg animate-slide-up dark:border-[#3c4b45] dark:bg-[#202925] dark:text-gray-200" role="status"><Check className="h-4 w-4 flex-none text-primary-600 dark:text-primary-300" /><span className="truncate">{toast}</span></div>}
    </div>
  )
}

function ToolCard({ tool, featured, onOpen }: { tool: Tool; featured: boolean; onOpen: () => void }) {
  const primary = tool.tone === 'primary'
  return <article className={`group relative overflow-hidden rounded-lg border bg-white transition-colors animate-slide-up dark:bg-[#1b2220] ${featured ? 'min-h-[260px]' : 'min-h-[220px]'} ${primary ? 'border-[#dce4df] hover:border-primary-300 dark:border-[#2d3934] dark:hover:border-primary-800' : 'border-[#eadfd8] hover:border-accent-300 dark:border-[#2d3934] dark:hover:border-accent-800'}`}><button type="button" className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500" onClick={onOpen} aria-label={`使用 Token 进入 ${tool.name}`} /><div className="relative z-0 flex h-full min-w-0 flex-col justify-between p-5 sm:p-6"><div><div className="mb-5 flex items-center justify-between gap-3"><span className={`grid h-11 w-11 place-items-center rounded-lg ${primary ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/70 dark:text-primary-300' : 'bg-accent-50 text-accent-700 dark:bg-accent-950/50 dark:text-accent-300'}`}><tool.Icon className="h-5 w-5" /></span><span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400"><span className={`h-1.5 w-1.5 rounded-full ${tool.url ? 'bg-emerald-500' : 'bg-amber-500'}`} />{tool.url ? '可访问' : '待配置'}</span></div><p className={`mb-2 text-[11px] font-semibold ${primary ? 'text-primary-700 dark:text-primary-300' : 'text-accent-700 dark:text-accent-300'}`}>{tool.eyebrow}</p><h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{tool.name}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">{tool.description}</p></div><div className="mt-6 flex items-center gap-2 text-sm font-medium text-gray-700 transition-colors group-hover:text-primary-700 dark:text-gray-300 dark:group-hover:text-primary-300"><KeyRound className="h-4 w-4" /><span>输入 Token 后进入</span><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></div></div></article>
}

function Modal({ children, title, onClose, labelledBy }: { children: React.ReactNode; title: string; onClose: () => void; labelledBy: string }) {
  useEffect(() => { const listener = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener) }, [onClose])
  return <div className="fixed inset-0 z-40 grid place-items-center bg-gray-950/35 p-4 backdrop-blur-[2px] animate-fade-in" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="max-h-[calc(100vh-32px)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#dce4df] bg-white shadow-xl animate-scale-in dark:border-[#3c4b45] dark:bg-[#1b2220]" role="dialog" aria-modal="true" aria-labelledby={labelledBy}><div className="flex items-start justify-between gap-4 border-b border-[#dce4df] p-5 dark:border-[#2d3934]"><div><h2 id={labelledBy} className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2></div><button type="button" className="icon-button flex-none" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>{children}</section></div>
}

function GuestTokenDialog({ entry, onClose, onToast }: { entry: Entry; onClose: () => void; onToast: (message: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await request('/api/guest/verify', { method: 'POST', body: JSON.stringify({ entryId: entry.id, token: token.trim() }) })
      if (!entry.url) { onToast(`${entry.name} 的入口地址尚未配置`); onClose(); return }
      const target = new URL(entry.url, window.location.origin)
      target.searchParams.set('token', token.trim())
      window.location.assign(target.toString())
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Token 校验失败') }
  }
  return <Modal title={`${entry.name} Token 登录`} labelledBy="guest-token-title" onClose={onClose}><form className="p-5" onSubmit={submit}><p className="mb-4 text-sm leading-6 text-gray-500 dark:text-gray-400">请输入管理员分发给你的 {entry.name} Token。Token 只用于本次进入，不会保存到浏览器。</p><label htmlFor="guest-token" className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">访问 Token</label><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input ref={inputRef} id="guest-token" type="password" value={token} onChange={(event) => { setToken(event.target.value); setError('') }} className="field pl-9 font-mono" placeholder="输入管理员分发的 Token" autoComplete="off" aria-invalid={Boolean(error)} /></div>{error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}<div className="mt-6 flex justify-end gap-2 border-t border-[#dce4df] pt-4 dark:border-[#2d3934]"><button type="button" className="rounded-lg border border-[#cbd7d0] bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-[#3c4b45] dark:bg-[#1b2220] dark:text-gray-300" onClick={onClose}>取消</button><button type="submit" className="flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"><ExternalLink className="h-4 w-4" />验证并进入</button></div></form></Modal>
}

function AdminDialog({ session, onLogin, onLogout, onClose, onToast }: { session: AdminSession | null; onLogin: (session: AdminSession) => void; onLogout: () => void; onClose: () => void; onToast: (message: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [entries, setEntries] = useState<AdminEntry[]>([])
  const [loading, setLoading] = useState(Boolean(session))
  const [newToken, setNewToken] = useState<{ entryId: EntryId; value: string } | null>(null)
  const [createEntry, setCreateEntry] = useState<EntryId>('read')
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const refresh = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try { setEntries((await request<{ entries: AdminEntry[] }>('/api/admin/entries', {}, session)).entries) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '加载失败') } finally { setLoading(false) }
  }, [session])
  useEffect(() => { refresh() }, [refresh])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try { const result = await request<{ session: string; username: string; expiresAt: number }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onLogin({ token: result.session, username: result.username, expiresAt: result.expiresAt }) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '登录失败') }
  }
  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!session) return
    try { const result = await request<{ token: string }>('/api/admin/entries/' + createEntry + '/tokens', { method: 'POST', body: JSON.stringify({ label, expiresAt: expiresAt || null }) }, session); setNewToken({ entryId: createEntry, value: result.token }); setLabel(''); setExpiresAt(''); await refresh(); onToast('Token 已生成，请立即复制') } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '生成失败') }
  }
  const revoke = async (entryId: EntryId, tokenId: string) => { if (!session) return; try { await request(`/api/admin/entries/${entryId}/tokens/${tokenId}`, { method: 'DELETE' }, session); await refresh(); onToast('Token 已撤销') } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '撤销失败') } }
  const copyToken = async () => { if (!newToken) return; await navigator.clipboard?.writeText(newToken.value); onToast('Token 已复制') }

  if (!session) return <Modal title="管理员登录" labelledBy="admin-login-title" onClose={onClose}><form className="space-y-4 p-5" onSubmit={login}><p className="text-sm leading-6 text-gray-500 dark:text-gray-400">管理员登录后可以为四个功能入口生成和撤销游客 Token。</p><div><label htmlFor="admin-username" className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">管理员账号</label><input id="admin-username" className="field" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></div><div><label htmlFor="admin-password" className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">管理员密码</label><input id="admin-password" type="password" className="field" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}<div className="flex justify-end border-t border-[#dce4df] pt-4 dark:border-[#2d3934]"><button type="submit" className="flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"><LogIn className="h-4 w-4" />登录后台</button></div></form></Modal>

  return <Modal title="Token 管理后台" labelledBy="admin-panel-title" onClose={onClose}><div className="p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-500 dark:text-gray-400">管理员：<span className="font-medium text-gray-800 dark:text-gray-200">{session.username}</span></p><div className="flex gap-2"><button type="button" className="icon-button" onClick={refresh} aria-label="刷新 Token 列表" title="刷新"><RefreshCw className="h-4 w-4" /></button><button type="button" className="flex items-center gap-2 rounded-lg border border-[#cbd7d0] px-3 py-2 text-xs font-medium text-gray-700 dark:border-[#3c4b45] dark:text-gray-300" onClick={onLogout}><LogOut className="h-4 w-4" />退出</button></div></div><form className="mb-6 rounded-lg border border-[#dce4df] p-4 dark:border-[#2d3934]" onSubmit={create}><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4 text-primary-600" />分发新 Token</div><div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_1fr_auto]"><select className="field" value={createEntry} onChange={(event) => setCreateEntry(event.target.value as EntryId)}>{ENTRY_IDS.map((entryId) => <option key={entryId} value={entryId}>{ENTRIES[entryId].name}</option>)}</select><input className="field" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="备注，例如：访客 A" /><input className="field" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} aria-label="过期时间，可选" /><button type="submit" className="flex items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"><Plus className="h-4 w-4" />生成</button></div></form>{newToken && <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/30"><p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{ENTRIES[newToken.entryId].name} Token 只显示完整值一次</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-emerald-900/70 dark:bg-[#18201d] dark:text-gray-200">{newToken.value}</code><button type="button" className="icon-button" onClick={copyToken} aria-label="复制 Token" title="复制 Token"><Copy className="h-4 w-4" /></button><button type="button" className="icon-button" onClick={() => setNewToken(null)} aria-label="关闭 Token 提示"><X className="h-4 w-4" /></button></div></div>}{error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}<div className="space-y-4">{loading ? <p className="py-6 text-center text-sm text-gray-500">正在加载...</p> : entries.map((entry) => { const EntryIcon = ENTRIES[entry.id].Icon; return <div key={entry.id} className="rounded-lg border border-[#dce4df] dark:border-[#2d3934]"><div className="flex items-center justify-between border-b border-[#dce4df] px-4 py-3 dark:border-[#2d3934]"><div className="flex items-center gap-2"><EntryIcon className="h-4 w-4 text-primary-600" /><span className="text-sm font-semibold">{entry.name}</span></div><span className="text-xs text-gray-400">{entry.tokens.filter((token) => token.active).length} 个有效 Token</span></div><div className="divide-y divide-[#dce4df] dark:divide-[#2d3934]">{entry.tokens.length === 0 ? <p className="px-4 py-4 text-xs text-gray-500">尚未分发 Token</p> : entry.tokens.map((token) => <div key={token.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{token.label}</p><p className="font-mono text-xs text-gray-500">{token.tokenPreview} · {token.active ? '有效' : '已失效'}</p></div><button type="button" className="icon-button text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => revoke(entry.id, token.id)} aria-label={`撤销 ${entry.name} Token`} title="撤销 Token"><Trash2 className="h-4 w-4" /></button></div>)}</div></div> })}</div></div></Modal>
}

export default App
