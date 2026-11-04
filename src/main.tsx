import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App2'
import PromoPage from './PromoPage'
import { hasServerMemberSession, migrateLegacyMemberSession } from './member-session'
import './index.css'
import './promo.css'

// Keep legacy FastCAS callbacks and workspace anchors on the workspace route.
const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
const normalizedPath = window.location.pathname.replace(/\/+$/, '')
const introPath = `${basePath}/intro`
const workspacePath = `${basePath}/workspace`

// Member login state lives in the project database behind an HttpOnly cookie.
// Migrate any legacy browser copy once so fastrd.io and www.fastrd.io agree.
void migrateLegacyMemberSession()

async function redirectRoot() {
  await migrateLegacyMemberSession()
  const params = new URLSearchParams(window.location.search)
  const forcedWorkspace = params.has('fastcas') || params.get('launch') === 'fast-task' || ['#home', '#modules'].includes(window.location.hash)
  const workspaceReturn = forcedWorkspace || await hasServerMemberSession()
  window.location.replace(`${workspaceReturn ? workspacePath : introPath}${window.location.search}${window.location.hash}`)
}

if (normalizedPath === basePath) {
  void redirectRoot()
} else {
  const isIntro = normalizedPath === introPath
  if (isIntro) document.documentElement.classList.add('promo-route')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isIntro ? <PromoPage /> : <App />}
    </StrictMode>,
  )
}
