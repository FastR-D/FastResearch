// Only administrator-configured application origins are accepted. Research
// sessions and legacy login tickets never leave this launch boundary.
const definitions = [
  { id: 'fast-news', name: 'FastNews', bases: ['FASTNEWS_PUBLIC_URL', 'VITE_FASTNEWS_URL', 'FASTNEWS_URL'], fallback: 'http://127.0.0.1:4173', casPath: 'api/auth/fastcas/login', override: 'FASTNEWS_CAS_LOGIN_URL' },
  { id: 'fast-read', name: 'FastRead', bases: ['FASTREAD_PUBLIC_URL', 'VITE_READ_URL', 'FASTREAD_URL'], fallback: 'http://127.0.0.1:3015', casPath: 'api/auth/fastcas/login', override: 'FASTREAD_CAS_LOGIN_URL' },
  { id: 'fast-write', name: 'FastWrite', bases: ['FASTWRITE_PUBLIC_URL', 'VITE_WRITE_URL', 'FASTWRITE_URL'], fallback: 'http://127.0.0.1:3003', casPath: 'api/auth/fastcas/login?returnTo=%2Fpanel', override: 'FASTWRITE_CAS_LOGIN_URL' },
  { id: 'fast-ppt', name: 'FastPPT', bases: ['FASTPPT_PUBLIC_URL', 'VITE_FASTPPT_URL'], override: 'FASTPPT_CAS_LOGIN_URL' },
  { id: 'fast-lab', name: 'FastLab', bases: ['FASTLAB_PUBLIC_URL', 'VITE_FASTLAB_URL'], override: 'FASTLAB_CAS_LOGIN_URL' },
  { id: 'fast-task', name: 'FastTask', bases: ['FASTTASK_PUBLIC_URL', 'VITE_FASTTASK_URL', 'FASTTASK_URL'], casPath: 'api/v1/auth/fastcas/login', override: 'FASTTASK_CAS_LOGIN_URL' },
]

function publicURL(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null
    return url
  } catch { return null }
}

export function workspaceApps(env = process.env) {
  return definitions.map(definition => {
    const rawBase = definition.bases.map(key => env[key]?.trim()).find(Boolean) || definition.fallback
    const base = publicURL(rawBase)
    const override = env[definition.override]?.trim()
    let target = null
    let auth = 'direct'
    if (override) {
      target = publicURL(override)
      auth = 'cas'
    } else if (base && definition.casPath) {
      base.search = ''
      base.pathname = base.pathname.replace(/\/$/, '') + '/'
      target = new URL(definition.casPath, base)
      auth = 'cas'
    } else target = base
    return { id: definition.id, name: definition.name, configured: Boolean(target), auth, target: target?.href ?? null,
      launchPath: target ? `/api/workspace/apps/${definition.id}/launch` : null }
  })
}

export function workspaceAppCatalog(env = process.env) {
  return workspaceApps(env).map(({ target: _target, ...metadata }) => metadata)
}
