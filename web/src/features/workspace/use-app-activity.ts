import { useCallback, useEffect, useState } from 'react'
import { request } from '../../shared/api/client'
import type { AppTaskSummary, MemberSession } from '../../shared/types'
export type AppActivity = {
  tasks?: AppTaskSummary
  schemaVersion: 'fastresearch.workspace.v1'
  appId: string
  accountState: 'active' | 'missing' | 'inactive' | 'requires_cas' | 'not_configured' | 'unavailable'
  updatedAt?: string
  message?: string
  registrationPath?: string
  metrics: { id: string; label: string; value: number }[]
  items: { id: string; kind: string; title: string; description?: string; path: string; occurredAt?: string }[]
}
export function useAppActivity(appId: string, member: MemberSession | null) {
  const identity = member ? `${member.accountId ?? member.keyId}:${member.source}` : ''
  const key = `${identity}:${appId}`
  const [result, setResult] = useState<{ key: string; value: AppActivity | null; error: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!identity || !appId) return
    let cancelled = false
    let controller: AbortController | null = null
    const load = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const value = await request<AppActivity>(`/api/workspace/apps/${appId}/activity`, { signal: controller.signal })
        if (!cancelled) setResult({ key, value, error: '' })
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) setResult({ key, value: null, error: '暂时无法读取应用数据，请重试' })
      }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [appId, identity, key, revision])
  return { activity: result?.key === key ? result.value : null, error: result?.key === key ? result.error : '', refresh }
}
