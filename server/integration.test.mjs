import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const testRoot = path.join(process.cwd(), '.staging-integration')
mkdirSync(testRoot, { recursive: true })
const dir = mkdtempSync(path.join(testRoot, 'research-test-'))
process.env.FASTRESEARCH_DATA_DIR = dir
process.env.FASTRESEARCH_FASTCAS_ISSUER = ''
process.env.FASTRESEARCH_FASTCAS_CLIENT_ID = ''
process.env.FASTRESEARCH_FASTCAS_CLIENT_SECRET = ''
process.env.FASTRESEARCH_FASTCAS_REDIRECT_URI = ''
process.env.ADMIN_PASSWORD = 'integration-admin-password'
process.env.FASTINSIGHT_INGEST_KEY = 'integration-ingest-key'
process.env.FASTTASK_INGEST_KEY = 'integration-fasttask-key'
const { startServer } = await import('./index.mjs')

test('Key rotation keeps account and content; invalid Bearer never falls back', async () => {
  const server = await startServer(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (route, method, body, token, more = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...more },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    assert.equal((await call('/api/auth/fastcas/available', 'GET')).body.available, false)
    const admin = await call('/api/admin/login', 'POST', { username: 'admin', password: 'integration-admin-password' })
    assert.equal(admin.status, 200)
    const created = await call('/api/admin/keys', 'POST', { person: '同名成员', fasttask_user_id: 'fasttask-user-1' }, admin.body.session)
    assert.equal(created.status, 201)
    assert.ok(created.body.record.accountId)
    const original = await call('/api/content/unlock', 'POST', { key: created.body.key })
    assert.equal(original.status, 200)
    const accountId = original.body.accountId
    const ticket = await call('/api/sso/ticket', 'POST', { audience: 'fast-read' }, original.body.session)
    assert.equal(ticket.status, 200)
    const consumed = await call('/api/sso/consume', 'POST', { ticket: ticket.body.ticket, audience: 'fast-read' })
    assert.equal(consumed.status, 200)
    assert.equal(consumed.body.accountId, accountId)
    const changed = await call('/api/admin/keys/' + created.body.record.id + '/rotate', 'POST', {}, admin.body.session)
    assert.equal(changed.status, 200)
    assert.equal(changed.body.record.accountId, accountId)
    assert.equal((await call('/api/content/unlock', 'POST', { key: created.body.key })).status, 401)
    assert.equal((await call('/api/content/unlock', 'POST', { key: changed.body.key })).body.accountId, accountId)
    assert.equal(changed.body.record.fasttaskUserId, 'fasttask-user-1')
    assert.equal((await call('/api/insight/publish', 'POST', { person: '同名成员' }, 'bad-token', { 'X-FastInsight-Key': 'integration-ingest-key' })).status, 401)
    assert.equal((await call('/api/insight/publish', 'POST', { person: '同名成员' }, '', { 'X-FastInsight-Key': 'integration-ingest-key' })).status, 201)
    const dispatch = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'fasttask-integration-001',
      dispatch_revision: 1,
      receiver_ref: accountId,
      title: 'FastTask 研究任务',
      stages: [{ stage_id: 'stage-1', module: 'fast-read', title: '阅读任务' }],
    }
    assert.equal((await call('/api/workflow/publish', 'POST', dispatch, '', { 'X-FastTask-Key': 'wrong' })).status, 401)
    const fastTaskPublish = await call('/api/workflow/publish', 'POST', dispatch, '', { 'X-FastTask-Key': 'integration-fasttask-key' })
    assert.equal(fastTaskPublish.status, 201)
    assert.equal(fastTaskPublish.body.receipt.dispatch_id, dispatch.dispatch_id)
    const boundDispatch = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'fasttask-bound-key-001',
      dispatch_revision: 1,
      title: 'Key-bound FastTask 任务',
      stages: [{ stage_id: 'stage-bound', module: 'fast-news', title: 'Key-bound news stage' }],
    }
    const bound = await call('/api/workflow/publish', 'POST', boundDispatch, '', { 'X-FastTask-Key': changed.body.key })
    assert.equal(bound.status, 201)
    assert.equal(bound.body.receipt.workflow_id.length > 0, true)
    const wrongTarget = await call('/api/workflow/publish', 'POST', { ...boundDispatch, dispatch_id: 'fasttask-bound-key-002', receiver_ref: 'another-account' }, '', { 'X-FastTask-Key': changed.body.key })
    assert.equal(wrongTarget.status, 403)
    const stored = JSON.parse(readFileSync(path.join(dir, 'access.json'), 'utf8'))
    assert.equal(stored.keys[0].accountId, accountId)
    assert.equal(stored.keys[0].insightItems.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
