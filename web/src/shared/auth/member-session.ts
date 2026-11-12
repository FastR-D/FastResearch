const legacyMemberStorageKey = 'fastresearch-member-session'
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function clearLegacyMemberSession() {
  try { localStorage.removeItem(legacyMemberStorageKey) } catch { /* optional storage */ }
  try { sessionStorage.removeItem(legacyMemberStorageKey) } catch { /* optional storage */ }
}

/** Go sessions require a new central login; discard old browser bearers. */
export function migrateLegacyMemberSession(): Promise<boolean> {
  clearLegacyMemberSession()
  return Promise.resolve(false)
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
