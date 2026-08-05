import {
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  Home,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  Newspaper,
  PenLine,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'

type EntryId = 'read' | 'write' | 'fast-task' | 'fast-news'

type Entry = {
  id: EntryId
  name: string
  Icon: LucideIcon
  url?: string
}

type Tool = Entry & {
  eyebrow: string
  description: string
  tone: 'primary' | 'accent'
}

const NAV_ITEMS: Array<{ id: 'home' | 'read' | 'write'; label: string; Icon: LucideIcon }> = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'read', label: 'Read', Icon: BookOpenText },
  { id: 'write', label: 'Write', Icon: PenLine },
]

const ENTRIES: Record<EntryId, Entry> = {
  read: {
    id: 'read',
    name: 'Read',
    Icon: BookOpenText,
    url: import.meta.env.VITE_READ_URL,
  },
  write: {
    id: 'write',
    name: 'Write',
    Icon: PenLine,
    url: import.meta.env.VITE_WRITE_URL,
  },
  'fast-task': {
    id: 'fast-task',
    name: 'FastTask',
    Icon: CheckCircle2,
    url: import.meta.env.VITE_FASTTASK_URL,
  },
  'fast-news': {
    id: 'fast-news',
    name: 'FastNews',
    Icon: Newspaper,
    url: import.meta.env.VITE_FASTNEWS_URL,
  },
}

const ENTRY_IDS = Object.keys(ENTRIES) as EntryId[]

const TOOLS: Tool[] = [
  {
    ...ENTRIES['fast-task'],
    eyebrow: '独立工具 · 任务工作区',
    description: '进入研究任务工作区，集中处理当前项目中的计划与执行事项。',
    tone: 'primary',
  },
  {
    ...ENTRIES['fast-news'],
    eyebrow: '独立工具 · 资讯工作区',
    description: '进入研究资讯工作区，查看与你关注方向相关的最新内容。',
    tone: 'accent',
  },
]

type Tokens = Record<EntryId, string>

const tokenStorageKey = (entryId: EntryId) => `fastresearch-token-${entryId}`

const loadTokens = (): Tokens => {
  const tokens: Tokens = { read: '', write: '', 'fast-task': '', 'fast-news': '' }
  ENTRY_IDS.forEach((entryId) => {
    const key = tokenStorageKey(entryId)
    tokens[entryId] = sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? ''
  })
  sessionStorage.removeItem('fastresearch-token')
  localStorage.removeItem('fastresearch-token')
  return tokens
}

function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('fastresearch-theme')
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [tokens, setTokens] = useState<Tokens>(loadTokens)
  const [tokenEntry, setTokenEntry] = useState<Entry | null>(null)
  const [launchAfterSave, setLaunchAfterSave] = useState(false)
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const readyCount = ENTRY_IDS.filter((entryId) => Boolean(tokens[entryId])).length

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fastresearch-theme', dark ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151a19' : '#f6f7f5')
  }, [dark])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const launchEntry = (entry: Entry, activeToken: string) => {
    if (!entry.url) {
      setToast(`${entry.name} 的入口地址尚未配置`)
      return
    }

    try {
      const target = new URL(entry.url, window.location.origin)
      target.searchParams.set('token', activeToken)
      window.location.assign(target.toString())
    } catch {
      setToast(`${entry.name} 的入口地址无效`)
    }
  }

  const openEntry = (entry: Entry) => {
    const activeToken = tokens[entry.id]
    if (!activeToken) {
      setTokenEntry(entry)
      setLaunchAfterSave(true)
      return
    }
    launchEntry(entry, activeToken)
  }

  const saveToken = (entry: Entry, nextToken: string, remember: boolean) => {
    const value = nextToken.trim()
    const key = tokenStorageKey(entry.id)
    setTokens((current) => ({ ...current, [entry.id]: value }))
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
    if (remember) localStorage.setItem(key, value)
    else sessionStorage.setItem(key, value)

    setTokenEntry(null)
    setToast(`${entry.name} Token 已连接`)
    if (launchAfterSave) window.setTimeout(() => launchEntry(entry, value), 150)
    setLaunchAfterSave(false)
  }

  const clearToken = (entry: Entry) => {
    const key = tokenStorageKey(entry.id)
    setTokens((current) => ({ ...current, [entry.id]: '' }))
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
    setTokenEntry(null)
    setLaunchAfterSave(false)
    setToast(`${entry.name} Token 已移除`)
  }

  const editToken = (entry: Entry) => {
    setCredentialsOpen(false)
    setLaunchAfterSave(false)
    setTokenEntry(entry)
  }

  return (
    <div className="min-h-screen bg-[#f6f7f5] text-gray-900 transition-colors dark:bg-[#151a19] dark:text-gray-100">
      <header className="sticky top-0 z-30 border-b border-[#dce4df] bg-white/95 dark:border-[#2d3934] dark:bg-[#18201d]/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="返回首页"
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-700 text-white">
              <Zap className="h-4 w-4" fill="currentColor" />
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block text-sm font-semibold leading-5">FastResearch</span>
              <span className="block text-[11px] leading-4 text-gray-500 dark:text-gray-400">Research workspace</span>
            </span>
          </button>

          <nav className="mx-auto hidden items-center gap-1 rounded-lg bg-[#eef2ef] p-1 dark:bg-[#202925] md:flex" aria-label="主导航">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const active = id === 'home'
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => id === 'home' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : openEntry(ENTRIES[id])}
                  className={`flex h-9 min-w-24 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors ${
                    active
                      ? 'border-[#d4e7df] bg-white text-primary-700 shadow-sm dark:border-[#315147] dark:bg-[#1b2220] dark:text-primary-300'
                      : 'border-transparent text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-[#27332e] dark:hover:text-gray-100'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <button
              type="button"
              className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 ${
                readyCount === ENTRY_IDS.length
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-[#cbd7d0] bg-white text-gray-600 hover:border-primary-300 hover:text-primary-700 dark:border-[#3c4b45] dark:bg-[#1b2220] dark:text-gray-300 dark:hover:border-primary-700 dark:hover:text-primary-300'
              }`}
              onClick={() => setCredentialsOpen(true)}
              aria-label="管理访问凭证"
              title="管理访问凭证"
            >
              {readyCount === ENTRY_IDS.length ? <ShieldCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              <span className="hidden sm:inline">{readyCount} / {ENTRY_IDS.length} Token</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setDark((value) => !value)}
              aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
              title={dark ? '浅色模式' : '深色模式'}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-[#dce4df] px-3 py-2 dark:border-[#2d3934] md:hidden" aria-label="移动端导航">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = id === 'home'
            return (
              <button
                key={id}
                type="button"
                onClick={() => id === 'home' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : openEntry(ENTRIES[id])}
                className={`flex min-w-[calc((100vw-32px)/3)] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[#d4e7df] bg-white text-primary-700 dark:border-[#315147] dark:bg-[#1b2220] dark:text-primary-300'
                    : 'border-transparent text-gray-500 dark:text-gray-400'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <section className="mb-6 flex items-start justify-between gap-4 animate-slide-down">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
              <LayoutDashboard className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <span>FastResearch</span>
                <ChevronRight className="h-3 w-3" />
                <span>Home</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">研究控制台</h1>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">从一个入口访问你的研究工具。</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 pt-1 sm:flex">
            <span className={`h-2 w-2 rounded-full ${readyCount === ENTRY_IDS.length ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{readyCount} / {ENTRY_IDS.length} 凭证已连接</span>
          </div>
        </section>

        <section aria-label="工具入口" className="space-y-4">
          {TOOLS.map((tool, index) => (
            <ToolCard key={tool.id} tool={tool} tokenReady={Boolean(tokens[tool.id])} featured={index === 1} onOpen={() => openEntry(tool)} />
          ))}
        </section>

        <footer className="mt-7 flex flex-col gap-2 border-t border-[#dce4df] pt-4 text-xs text-gray-400 dark:border-[#2d3934] dark:text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <span>FastResearch Workspace</span>
          <span className="flex items-center gap-1.5">
            <LockKeyhole className="h-3.5 w-3.5" />
            四个入口使用独立 Token
          </span>
        </footer>
      </main>

      {credentialsOpen && (
        <CredentialsDialog
          tokens={tokens}
          onClose={() => setCredentialsOpen(false)}
          onEdit={editToken}
        />
      )}

      {tokenEntry && (
        <TokenDialog
          entry={tokenEntry}
          currentToken={tokens[tokenEntry.id]}
          continueAfterSave={launchAfterSave}
          onClose={() => {
            setTokenEntry(null)
            setLaunchAfterSave(false)
          }}
          onSave={(value, remember) => saveToken(tokenEntry, value, remember)}
          onClear={() => clearToken(tokenEntry)}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-[#dce4df] bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg animate-slide-up dark:border-[#3c4b45] dark:bg-[#202925] dark:text-gray-200" role="status">
          <Check className="h-4 w-4 flex-none text-primary-600 dark:text-primary-300" />
          <span className="truncate">{toast}</span>
        </div>
      )}
    </div>
  )
}

function ToolCard({
  tool,
  tokenReady,
  featured,
  onOpen,
}: {
  tool: Tool
  tokenReady: boolean
  featured: boolean
  onOpen: () => void
}) {
  const { Icon } = tool
  const primary = tool.tone === 'primary'

  return (
    <article
      className={`group relative grid overflow-hidden rounded-lg border bg-white transition-colors animate-slide-up dark:bg-[#1b2220] md:grid-cols-[minmax(0,1fr)_18rem] ${
        featured ? 'min-h-[270px]' : 'min-h-[196px]'
      } ${
        primary
          ? 'border-[#dce4df] hover:border-primary-300 dark:border-[#2d3934] dark:hover:border-primary-800'
          : 'border-[#dce4df] hover:border-accent-300 dark:border-[#2d3934] dark:hover:border-accent-800'
      }`}
    >
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
        onClick={onOpen}
        aria-label={`进入 ${tool.name}`}
      />

      <div className="relative z-0 flex min-w-0 flex-col justify-between p-5 sm:p-6">
        <div>
          <div className="mb-6 flex items-center justify-between gap-3">
            <span
              className={`grid h-11 w-11 place-items-center rounded-lg ${
                primary
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/70 dark:text-primary-300'
                  : 'bg-accent-50 text-accent-700 dark:bg-accent-950/50 dark:text-accent-300'
              }`}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span className={`h-1.5 w-1.5 rounded-full ${tool.url ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {tool.url ? '可访问' : '待配置'}
            </span>
          </div>
          <p className={`mb-2 text-[11px] font-semibold ${primary ? 'text-primary-700 dark:text-primary-300' : 'text-accent-700 dark:text-accent-300'}`}>
            {tool.eyebrow}
          </p>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{tool.name}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">{tool.description}</p>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm font-medium text-gray-700 transition-colors group-hover:text-primary-700 dark:text-gray-300 dark:group-hover:text-primary-300">
          {tokenReady ? <ExternalLink className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          <span>{tokenReady ? '进入工具' : '连接后进入'}</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>

      <div className={`tool-visual relative hidden border-l dark:border-[#2d3934] md:flex ${primary ? 'border-[#dce4df] bg-[#f1f6f3] dark:bg-[#18201d]' : 'border-[#eadfd8] bg-[#faf5f1] dark:bg-[#211e1b]'}`} aria-hidden="true">
        {tool.id === 'fast-task' ? <TaskPreview /> : <NewsPreview />}
      </div>
    </article>
  )
}

function TaskPreview() {
  return (
    <div className="relative z-[1] m-auto w-[13rem]">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-2 w-20 rounded bg-primary-800/20 dark:bg-primary-200/20" />
        <span className="font-mono text-[10px] text-primary-700/60 dark:text-primary-300/60">03 / 05</span>
      </div>
      <div className="space-y-3">
        {[true, true, false, false].map((done, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-primary-900/10 pb-3 dark:border-primary-100/10">
            {done ? <CheckCircle2 className="h-4 w-4 flex-none text-primary-600 dark:text-primary-400" /> : <Circle className="h-4 w-4 flex-none text-gray-300 dark:text-gray-600" />}
            <div className={`h-2 rounded ${index % 2 === 0 ? 'w-28' : 'w-20'} ${done ? 'bg-primary-800/20 dark:bg-primary-200/20' : 'bg-gray-300/70 dark:bg-gray-600/60'}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function NewsPreview() {
  return (
    <div className="relative z-[1] m-auto w-[13rem]">
      <div className="mb-5 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-600 dark:text-accent-400" />
        <div className="h-2 w-24 rounded bg-accent-800/20 dark:bg-accent-200/20" />
      </div>
      <div className="space-y-4">
        {[['A', 'w-32'], ['B', 'w-24'], ['C', 'w-28']].map(([label, width]) => (
          <div key={label} className="border-b border-accent-900/10 pb-4 dark:border-accent-100/10">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[10px] font-semibold text-accent-700/70 dark:text-accent-300/70">{label}</span>
              <div className={`h-2 ${width} rounded bg-gray-500/25 dark:bg-gray-300/20`} />
            </div>
            <div className="ml-4 h-1.5 w-20 rounded bg-gray-400/20 dark:bg-gray-400/15" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CredentialsDialog({
  tokens,
  onClose,
  onEdit,
}: {
  tokens: Tokens
  onClose: () => void
  onEdit: (entry: Entry) => void
}) {
  const connectedCount = ENTRY_IDS.filter((entryId) => Boolean(tokens[entryId])).length

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-gray-950/35 p-4 backdrop-blur-[2px] animate-fade-in" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-md rounded-lg border border-[#dce4df] bg-white shadow-xl animate-scale-in dark:border-[#3c4b45] dark:bg-[#1b2220]" role="dialog" aria-modal="true" aria-labelledby="credentials-dialog-title">
        <div className="flex items-start justify-between gap-4 border-b border-[#dce4df] p-5 dark:border-[#2d3934]">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/70 dark:text-primary-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h2 id="credentials-dialog-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">访问凭证</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{connectedCount} / {ENTRY_IDS.length} 已连接</p>
            </div>
          </div>
          <button type="button" className="icon-button flex-none" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divide-y divide-[#dce4df] px-5 dark:divide-[#2d3934]">
          {ENTRY_IDS.map((entryId) => {
            const entry = ENTRIES[entryId]
            const { Icon } = entry
            const connected = Boolean(tokens[entryId])
            return (
              <div key={entryId} className="flex items-center gap-3 py-4">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[#eef2ef] text-gray-600 dark:bg-[#202925] dark:text-gray-300">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.name}</p>
                  <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    {connected ? 'Token 已连接' : 'Token 未连接'}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-[#cbd7d0] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 dark:border-[#3c4b45] dark:bg-[#1b2220] dark:text-gray-300 dark:hover:border-primary-700 dark:hover:text-primary-300"
                  onClick={() => onEdit(entry)}
                  aria-label={`${connected ? '更新' : '连接'} ${entry.name} Token`}
                >
                  {connected ? '更新' : '连接'}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function TokenDialog({
  entry,
  currentToken,
  continueAfterSave,
  onClose,
  onSave,
  onClear,
}: {
  entry: Entry
  currentToken: string
  continueAfterSave: boolean
  onClose: () => void
  onSave: (token: string, remember: boolean) => void
  onClear: () => void
}) {
  const [value, setValue] = useState(currentToken)
  const [remember, setRemember] = useState(Boolean(localStorage.getItem(tokenStorageKey(entry.id))))
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) {
      setError('请输入有效的 Token')
      return
    }
    onSave(value, remember)
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-gray-950/35 p-4 backdrop-blur-[2px] animate-fade-in" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="w-full max-w-md rounded-lg border border-[#dce4df] bg-white shadow-xl animate-scale-in dark:border-[#3c4b45] dark:bg-[#1b2220]" role="dialog" aria-modal="true" aria-labelledby="token-dialog-title">
        <div className="flex items-start justify-between gap-4 border-b border-[#dce4df] p-5 dark:border-[#2d3934]">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/70 dark:text-primary-300">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <h2 id="token-dialog-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">{currentToken ? '更新' : '连接'} {entry.name} Token</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {continueAfterSave ? `验证后继续进入 ${entry.name}` : `${entry.name} 使用独立的访问凭证`}
              </p>
            </div>
          </div>
          <button type="button" className="icon-button flex-none" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="p-5" onSubmit={submit}>
          <label htmlFor="access-token" className="mb-2 block text-xs font-medium text-gray-700 dark:text-gray-300">Access Token</label>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              id="access-token"
              type="password"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError('')
              }}
              className="field pl-9 font-mono"
              placeholder="输入 Token"
              autoComplete="off"
              aria-invalid={Boolean(error)}
            />
          </div>
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

          <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#cbd7d0] text-primary-700 accent-primary-700 focus:ring-primary-500"
            />
            <span>
              <span className="block font-medium text-gray-700 dark:text-gray-300">在此浏览器中保持连接</span>
              <span className="mt-0.5 block leading-5">关闭后仍保留此 Token。</span>
            </span>
          </label>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#dce4df] pt-4 dark:border-[#2d3934]">
            {currentToken ? (
              <button type="button" className="rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={onClear}>
                移除 Token
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-lg border border-[#cbd7d0] bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-[#eef2ef] dark:border-[#3c4b45] dark:bg-[#1b2220] dark:text-gray-300 dark:hover:bg-[#27332e]" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30">
                <ShieldCheck className="h-4 w-4" />
                确认连接
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}

export default App
