/** FastTask client used by FastResearch to send stage evidence and create tasks. */
export class FastTaskClient {
  constructor(baseURL, apiKey) {
    this.baseURL = String(baseURL).replace(/\/$/, '')
    this.apiKey = apiKey
  }

  async publishProgress(payload, idempotencyKey, receiverRef = '') {
    const response = await fetch(`${this.baseURL}/api/v1/integrations/fastresearch/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(receiverRef ? {} : { 'X-API-Key': this.apiKey }),
        ...(receiverRef ? { 'X-FastResearch-Provision-Key': this.apiKey, 'X-FastResearch-Receiver-Ref': receiverRef } : {}),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || data.error || `FastTask API error: ${response.status}`)
    return data
  }

  async createTasks(payload, idempotencyKey, receiverRef = '') {
    const response = await fetch(`${this.baseURL}/api/v1/integrations/fastresearch/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(receiverRef ? {} : { 'X-API-Key': this.apiKey }),
        ...(receiverRef ? { 'X-FastResearch-Provision-Key': this.apiKey, 'X-FastResearch-Receiver-Ref': receiverRef } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.detail || data.error || `FastTask API error: ${response.status}`)
      error.status = response.status
      throw error
    }
    return data
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseURL}/health/ready`)
      return response.ok
    } catch {
      return false
    }
  }

  async provisionAccount({ receiverRef, key, displayName }) {
    return this.#lifecycle('/api/v1/integrations/fastresearch/accounts', 'POST', {
      receiver_ref: receiverRef,
      key,
      display_name: displayName,
    })
  }

  async rotateAccountKey(receiverRef, key) {
    return this.#lifecycle(`/api/v1/integrations/fastresearch/accounts/${encodeURIComponent(receiverRef)}/rotate`, 'POST', null, {
      'X-FastResearch-Key': key,
    })
  }

  async deleteAccount(receiverRef) {
    return this.#lifecycle(`/api/v1/integrations/fastresearch/accounts/${encodeURIComponent(receiverRef)}`, 'DELETE')
  }

  async #lifecycle(path, method, body = null, extraHeaders = {}) {
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-FastResearch-Provision-Key': this.apiKey,
        ...extraHeaders,
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.detail || data.error || `FastTask API error: ${response.status}`)
      error.status = response.status
      throw error
    }
    return data
  }
}

export function createFastTaskClient(baseURL, apiKey) {
  if (!String(baseURL ?? '').trim() || !String(apiKey ?? '').trim()) return null
  return new FastTaskClient(baseURL, apiKey)
}
