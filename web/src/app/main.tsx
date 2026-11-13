import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import 'virtual:uno.css'
import '../shared/auth/color-mode'
import { migrateLegacyMemberSession } from '../shared/auth/member-session'
import { productHref,products,workspaceHref } from '../shared/products'
import '../styles/index.css'

const App = lazy(() => import('../features/workspace/WorkspacePage'))
const PromoPage = lazy(() => import('../pages/promo/PromoPage'))

const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
const path = window.location.pathname.replace(/\/+$/, '')
const relativePath = path.slice(basePath.length) || '/'
const params = new URLSearchParams(window.location.search)
const callback = relativePath === '/' && (params.has('fastcas') || ['#home', '#modules'].includes(window.location.hash))
const product = products.find(app => relativePath === `/intro/${app.id}`)

// The product homepage stays public even when a member session exists.
// Legacy login callbacks retain their workspace destination and parameters.
if (callback) {
  window.location.replace(`${workspaceHref}${window.location.search}${window.location.hash}`)
} else if (relativePath === '/intro') {
  window.location.replace(`${import.meta.env.BASE_URL}${window.location.search}${window.location.hash}`)
} else if (relativePath === '/fastppt') {
  window.location.replace(productHref('ppt'))
} else {
  const isWorkspace = relativePath === '/workspace'
  const isProductPage = relativePath === '/' || Boolean(product)
  if (isWorkspace) void migrateLegacyMemberSession()
  if (isProductPage) document.documentElement.classList.add('promo-route')
  document.documentElement.lang = 'zh-CN'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={<main role="status">正在加载…</main>}>
      {isWorkspace ? <App /> : isProductPage ? <PromoPage product={product} /> : <main className="route-not-found"><h1>没有找到这个页面</h1><p>可以从产品总览继续探索，或回到科研工作台。</p><a href={import.meta.env.BASE_URL}>产品总览</a><a href={workspaceHref}>进入工作台</a></main>}
      </Suspense>
    </StrictMode>,
  )
}
