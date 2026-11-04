const legacyMemberStorageKey = 'fastresearch-member-session'
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function clearLegacyMemberSession() {
  try { localStorage.removeItem(legacyMemberStorageKey) } catch { /* optional storage */ }
  try { sessionStorage.removeItem(legacyMemberStorageKey) } catch { /* optional storage */ }
}

function readLegacyToken() {
  try {
    const raw = localStorage.getItem(legacyMemberStorageKey) ?? sessionStorage.getItem(legacyMemberStorageKey)
    if (!raw) return ''
    const value = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown }
    if (typeof value?.token !== 'string' || !value.token) return ''
    if (typeof value.expiresAt === 'number' && value.expiresAt <= Date.now()) return ''
    return value.token
  } catch {
    return ''
  }
}

async function runLegacyMigration(): Promise<boolean> {
  const token = readLegacyToken()
  if (!token) {
    clearLegacyMemberSession()
    return false
  }
  try {
    // This call makes the server persist/refresh the session and re-issue the
    // HttpOnly cookie, so both fastrd.io and www.fastrd.io share it.
    const response = await fetch(`${apiBase}/api/content/me`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearLegacyMemberSession()
  }
}

let migration: Promise<boolean> | null = null

/**
 * Older builds kept the member session in localStorage, which made the login
 * state differ between fastrd.io and www.fastrd.io. Move that session into the
 * server-side cookie once, then remove the browser copy.
 */
export function migrateLegacyMemberSession(): Promise<boolean> {
  migration ??= runLegacyMigration()
  return migration
}

/**
 * Ask the server whether the current browser already has a valid member
 * session. The session itself lives in the project database and is referenced
 * by the HttpOnly `fr_session` cookie.
 */
export async function hasServerMemberSession(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/api/content/me`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
