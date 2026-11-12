import test from 'node:test'
import assert from 'node:assert/strict'
import { FastWriteClient } from './fastwrite-client.mjs'

test('FastWrite login URL forwards the FastResearch account identity', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init }
    return new Response(JSON.stringify({ token: 'session-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const client = new FastWriteClient('http://127.0.0.1:3003', 'service-key')
    const url = await client.generateLoginUrl(null, {
      externalAccountId: 'account-123',
      displayName: '研究账户 A',
    })

    assert.equal(request.url, 'http://127.0.0.1:3003/api/integration/auth/token')
    assert.equal(request.init.headers['X-API-Key'], 'service-key')
    assert.deepEqual(JSON.parse(request.init.body), {
      externalAccountId: 'account-123',
      displayName: '研究账户 A',
    })
    assert.equal(url, 'http://127.0.0.1:3003/projects?token=session-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('FastWrite login URL does not hide an external-account authentication failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'auth_disabled' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  })

  try {
    const client = new FastWriteClient('http://127.0.0.1:3003', 'service-key')
    await assert.rejects(
      client.generateLoginUrl(null, { externalAccountId: 'account-123', displayName: '研究账户 A' }),
      /auth_disabled/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('FastWrite login URL opens a specific project workspace', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ token: 'session-token' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

  try {
    const client = new FastWriteClient('http://127.0.0.1:3003', 'service-key')
    const url = await client.generateLoginUrl('project/123', {
      externalAccountId: 'account-123',
      displayName: '研究账户 A',
    })
    assert.equal(url, 'http://127.0.0.1:3003/projects/project%2F123?token=session-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('FastWrite login URL uses the public browser URL for the handoff', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ token: 'session-token' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

  try {
    const client = new FastWriteClient(
      'http://127.0.0.1:3003',
      'service-key',
      'https://fastrd.io/write',
    )
    const url = await client.generateLoginUrl(null, {
      externalAccountId: 'account-123',
      displayName: '研究账户 A',
    })
    assert.equal(url, 'https://fastrd.io/write/projects?token=session-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})
