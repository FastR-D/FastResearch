import { FastCAS } from '@fastrd/fastcas/server'

// This identity is deliberately independent of the browser login client and of
// the legacy write/provision clients, whose receiver APIs are still reserved.
export function createFastTaskTodayClient(env = process.env) {
  const baseURL = String(env.FASTTASK_URL || env.VITE_FASTTASK_URL || '').trim().replace(/\/$/, '')
  const issuer = String(env.FASTTASK_SERVICE_ISSUER || '').trim()
  const clientId = String(env.FASTTASK_SERVICE_CLIENT_ID || '').trim()
  const clientSecret = String(env.FASTTASK_SERVICE_CLIENT_SECRET || '').trim()
  const settings = [issuer, clientId, clientSecret]
  if (settings.some(Boolean) && (!baseURL || !settings.every(Boolean))) {
    throw new Error('FastTask today requires FASTTASK_URL and all three FASTTASK_SERVICE connection settings')
  }
  if (!baseURL) return null
  let authorization
  if (settings.every(Boolean)) {
    const sdk = new FastCAS({ issuer, clientId, clientSecret,
      redirectUri: `${issuer}/console/`, timeoutSeconds: 4,
      allowLoopbackHTTP: env.FASTTASK_SERVICE_ALLOW_LOOPBACK_HTTP === 'true' })
    let cached, pending
    authorization = async () => {
      if (!cached || cached.until <= Date.now()) {
        pending ??= (async () => {
          const started = Date.now()
          const token = await sdk.clientCredentials(['integrations:fastresearch'])
          if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
            throw new Error('FastCAS service token has no usable lifetime')
          }
          cached = { value: token.access_token, until: started + token.expires_in * 1000 - 5000 }
        })()
        try { await pending } finally { pending = null }
      }
      return { Authorization: `Bearer ${cached.value}` }
    }
  } else {
    // Existing installations use this key. Task must explicitly enable its
    // legacy ingest switch; a failed service grant never selects this branch.
    const key = String(env.FASTTASK_API_KEY || env.FASTTASK_PROVISION_KEY || '').trim()
    if (!key) return null
    authorization = async () => ({ 'X-API-Key': key })
  }
  return {
    async fetchToday(receiverRefs) {
      const response = await fetch(`${baseURL}/api/v1/integrations/fastresearch/today`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...await authorization() },
        body: JSON.stringify({ receiver_refs: receiverRefs }), signal: AbortSignal.timeout(4000),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(data.detail || data.error || `FastTask API error: ${response.status}`)
        error.status = response.status
        throw error
      }
      return data
    },
  }
}
