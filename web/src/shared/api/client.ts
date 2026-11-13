import type { BearerSession } from '../types'
export const apiUrl = (path: string) => `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}${path}`
export class APIError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}
export async function request<T>(path: string, init: RequestInit = {}, session?: BearerSession): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`)
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: 'include' })
  const payload = await response.json().catch(() => ({} as { error?: string }))
  if (!response.ok) throw new APIError(payload.error ?? '请求失败', response.status)
  return payload as T
}
