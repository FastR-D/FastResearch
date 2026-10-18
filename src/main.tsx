import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App2'
import PromoPage from './PromoPage'
import './index.css'
import './promo.css'

// Keep legacy FastCAS callbacks and workspace anchors on the workspace route.
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
const normalizedPath = window.location.pathname.replace(/\/+$/, '')
const introPath = `${basePath}/intro`
const workspacePath = `${basePath}/workspace`

if (normalizedPath === basePath) {
  const params = new URLSearchParams(window.location.search)
  const workspaceReturn = params.has('fastcas') || params.get('launch') === 'fast-task' || ['#home', '#modules'].includes(window.location.hash)
  window.location.replace(`${workspaceReturn ? workspacePath : introPath}${window.location.search}${window.location.hash}`)
} else {
  const isIntro = normalizedPath === introPath
  if (isIntro) document.documentElement.classList.add('promo-route')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isIntro ? <PromoPage /> : <App />}
    </StrictMode>,
  )
}
