export const MEMBER_SESSION_TTL_MS = 2 * 24 * 60 * 60 * 1000
export const memberStorageKey = 'fastresearch-member-session'

type ExpiringSession = { expiresAt: number }

export function loadMemberSession<T extends ExpiringSession>(): T | null {
  try {
    const raw = localStorage.getItem(memberStorageKey) ?? sessionStorage.getItem(memberStorageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as T | null
    if (!value || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now()) {
      clearMemberSession()
      return null
    }
    if (!localStorage.getItem(memberStorageKey)) saveMemberSession(value)
    return value
  } catch {
    clearMemberSession()
    return null
  }
}

export function saveMemberSession<T extends ExpiringSession>(value: T) {
  try {
    localStorage.setItem(memberStorageKey, JSON.stringify(value))
    sessionStorage.removeItem(memberStorageKey)
  } catch {
    // Private browsing can reject persistent storage; the HttpOnly session cookie still works.
  }
}

export function clearMemberSession() {
  try { localStorage.removeItem(memberStorageKey) } catch { /* optional storage */ }
  try { sessionStorage.removeItem(memberStorageKey) } catch { /* optional storage */ }
}

export function hasActiveMemberSession() {
  return Boolean(loadMemberSession<ExpiringSession>())
}
