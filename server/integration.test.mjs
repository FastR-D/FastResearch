import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, scryptSync } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
process.env.FASTTASK_API_KEY = 'integration-fasttask-api-key'
delete process.env.FASTTASK_PROVISION_KEY
process.env.FASTRESEARCH_FASTTASK_SSO_SECRET = 'integration-fasttask-sso-secret-for-tests'
const seededKeyId = '11111111111111111111'
const seededRawKey = 'fk_seeded-external-account'
const seededAccountId = 'external-account-for-seeded-key'
const seedSalt = 'integration-account-salt'
const seedPasswordHash = `scrypt$${seedSalt}$${scryptSync('integration-admin-password', seedSalt, 64).toString('hex')}`
writeFileSync(path.join(dir, 'access.json'), JSON.stringify({
  admin: { username: 'admin', passwordHash: seedPasswordHash },
  jwtSecret: 'integration-jwt-secret',
  keys: [{
    id: seededKeyId,
    person: '显式账户成员',
    keyHash: createHash('sha256').update(seededRawKey).digest('hex'),
    keyPreview: 'fk_seeded...ount',
    accountId: seededAccountId,
    expiresAt: null,
    revokedAt: null,
  }],
}, null, 2))
const { startServer } = await import('./index.mjs')

test('Key identity persists across FastRead, FastWrite and rotation', async () => {
  let fastWriteIdentity
  const fastWrite = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    fastWriteIdentity = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ token: 'external-account-token' }))
  })
  await new Promise(resolve => fastWrite.listen(0, '127.0.0.1', resolve))
  const fastWriteAddress = fastWrite.address()
  let fastReadRequestUrl = ''
  let fastReadRequestBody
  let panelBase = ''
  let fastTaskProvisionCalls = 0
  let fastTaskTodayRequest = null
  const fastRead = createServer(async (request, response) => {
    fastReadRequestUrl = request.url
    if (request.method === 'POST') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      fastReadRequestBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const callback = await fetch(`${panelBase}/api/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ csrf: 'issued-csrf', callbackStatus: callback?.status ?? 0 }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/javascript' })
    response.end('const api = "/api/auth/me"')
  })
  await new Promise(resolve => fastRead.listen(0, '127.0.0.1', resolve))
  const fastReadAddress = fastRead.address()
  const fastTask = createServer(async (request, response) => {
    if (request.url === '/api/v1/integrations/fastresearch/accounts') {
      fastTaskProvisionCalls += 1
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ detail: 'not found' }))
      return
    }
    if (request.url === '/api/v1/integrations/fastresearch/today') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      fastTaskTodayRequest = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const refs = fastTaskTodayRequest.receiver_refs ?? []
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        members: refs.map((ref) => ({
          receiver_ref: ref,
          found: ref === seededAccountId,
          user_id: ref === seededAccountId ? 'ft-user-seeded' : undefined,
          display_name: ref === seededAccountId ? '显式账户成员' : undefined,
          local_date: '2026-10-18',
          timezone: 'Asia/Shanghai',
          plan_status: ref === seededAccountId ? 'active' : 'none',
          plan_revision: ref === seededAccountId ? 1 : 0,
          items: ref === seededAccountId ? [
            { id: 'item-1', title: '阅读论文', commitment: '精读', minimum_action: '读完摘要', status: 'in_progress', target_minutes: 30, position: 0 },
            { id: 'item-2', title: '整理笔记', commitment: '', minimum_action: '写三条笔记', status: 'satisfied', target_minutes: 20, position: 1 },
          ] : [],
          progress: ref === seededAccountId
            ? { total: 2, completed: 1, in_progress: 1, planned: 0, skipped: 0 }
            : { total: 0, completed: 0, in_progress: 0, planned: 0, skipped: 0 },
        })),
      }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  await new Promise(resolve => fastTask.listen(0, '127.0.0.1', resolve))
  const fastTaskAddress = fastTask.address()
  process.env.FASTTASK_URL = `http://127.0.0.1:${fastTaskAddress.port}`
  process.env.FASTWRITE_URL = `http://127.0.0.1:${fastWriteAddress.port}`
  process.env.FASTWRITE_PUBLIC_URL = 'https://fastrd.io/write'
  process.env.FASTWRITE_API_KEY = 'integration-fastwrite-key'
  process.env.FASTREAD_PROXY_URL = `http://127.0.0.1:${fastReadAddress.port}`
  const server = await startServer(0)
  const base = `http://127.0.0.1:${server.address().port}`
  panelBase = base
  const call = async (route, method, body, token, more = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...more },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const fastTaskPublicURL = `http://127.0.0.1:${fastTaskAddress.port}`
    process.env.FASTTASK_PUBLIC_URL = fastTaskPublicURL
    const fastTaskLogin = await fetch(`${base}/api/fasttask/login`, { redirect: 'manual' })
    assert.equal(fastTaskLogin.status, 302)
    assert.equal(fastTaskLogin.headers.get('location'), `${fastTaskPublicURL}/api/v1/auth/fastresearch/login`)
    delete process.env.FASTTASK_PUBLIC_URL
    delete process.env.VITE_FASTTASK_URL
    delete process.env.FASTTASK_URL
    const unconfiguredFastTaskLogin = await fetch(`${base}/api/fasttask/login`, { redirect: 'manual' })
    assert.equal(unconfiguredFastTaskLogin.status, 503)

    const fastReadProxy = await fetch(`${base}/read/api/auth/me?from=panel`)
    assert.equal(fastReadRequestUrl, '/api/auth/me?from=panel')
    assert.equal(fastReadProxy.headers.get('x-fastread-proxy'), 'fastresearch')
    assert.equal(await fastReadProxy.text(), 'const api = "/read/api/auth/me"')
    const fastReadLogin = await fetch(`${base}/read/api/auth/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'one-time-ticket' }),
    })
    assert.deepEqual(await fastReadLogin.json(), { csrf: 'issued-csrf', callbackStatus: 200 })
    assert.deepEqual(fastReadRequestBody, { ticket: 'one-time-ticket' })

    const seeded = await call('/api/content/unlock', 'POST', { key: seededRawKey })
    assert.equal(seeded.status, 200)
    assert.equal(seeded.body.accountId, seededAccountId)
    const memberSessionTtl = seeded.body.expiresAt - Date.now()
    assert.ok(memberSessionTtl > 47 * 60 * 60 * 1000)
    assert.ok(memberSessionTtl <= 48 * 60 * 60 * 1000)
    process.env.FASTTASK_PUBLIC_URL = base
    const callback = new URL('/api/v1/auth/fastresearch/callback?state=FastTaskState_0123456789abcdefghijk', base)
    const launch = await fetch(base + '/api/sso/launch?audience=fast-task&next=' + encodeURIComponent(callback.toString()), {
      headers: { Authorization: 'Bearer ' + seeded.body.session },
      redirect: 'manual',
    })
    assert.equal(launch.status, 302)
    const callbackUrl = new URL(launch.headers.get('location'))
    assert.equal(callbackUrl.pathname, '/api/v1/auth/fastresearch/callback')
    assert.equal(callbackUrl.searchParams.get('state'), 'FastTaskState_0123456789abcdefghijk')
    const fastTaskTicket = callbackUrl.searchParams.get('sso')
    assert.ok(fastTaskTicket)
    const rejectedFastTaskTicket = await call('/api/sso/consume', 'POST', {
      ticket: fastTaskTicket,
      audience: 'fast-task',
    }, undefined, { 'X-FastTask-SSO-Secret': 'wrong-secret' })
    assert.equal(rejectedFastTaskTicket.status, 401)
    const consumedFastTaskTicket = await call('/api/sso/consume', 'POST', {
      ticket: fastTaskTicket,
      audience: 'fast-task',
    }, undefined, { 'X-FastTask-SSO-Secret': process.env.FASTRESEARCH_FASTTASK_SSO_SECRET })
    assert.equal(consumedFastTaskTicket.status, 200)
    assert.equal(consumedFastTaskTicket.body.accountId, seededAccountId)
    assert.equal(consumedFastTaskTicket.body.keyId, seededKeyId)
    assert.equal(consumedFastTaskTicket.body.person, '\u663e\u5f0f\u8d26\u6237\u6210\u5458')
    const seededTicket = await call('/api/sso/ticket', 'POST', { audience: 'fast-read' }, seeded.body.session)
    const seededConsumed = await call('/api/sso/consume', 'POST', {
      ticket: seededTicket.body.ticket,
      audience: 'fast-read',
    })
    assert.equal(seededConsumed.body.accountId, seededAccountId)
    const seededToday = await call('/api/fasttask/today', 'GET', undefined, seeded.body.session)
    assert.equal(seededToday.status, 200)
    assert.equal(seededToday.body.today.received, true)
    assert.equal(seededToday.body.today.items.length, 2)
    assert.equal(seededToday.body.today.items[0].title, '阅读论文')
    assert.equal(seededToday.body.today.progress.completed, 1)
    assert.equal(seededToday.body.today.progress.inProgress, 1)
    assert.ok(fastTaskTodayRequest.receiver_refs.includes(seededAccountId))
    const seededTeam = await call('/api/workflow/team', 'GET', undefined, seeded.body.session)
    assert.equal(seededTeam.status, 200)
    assert.equal(seededTeam.body.members.find((member) => member.keyId === seededKeyId).today.received, true)
    const seededWrite = await call('/api/fastwrite/login-url', 'POST', {}, seeded.body.session)
    assert.deepEqual(fastWriteIdentity, {
      externalAccountId: seededAccountId,
      displayName: '显式账户成员',
    })
    assert.equal(seededWrite.body.url, 'https://fastrd.io/write/projects?token=external-account-token')

    // The FastCAS availability endpoint reports `enabled`, matching the
    // /api/auth/fastcas/* route contract in server/fastcas-routes.mjs.
    assert.equal((await call('/api/auth/fastcas/available', 'GET')).body.enabled, false)
    const admin = await call('/api/admin/login', 'POST', { username: 'admin', password: 'integration-admin-password' })
    assert.equal(admin.status, 200)
    const fastTaskKey = await call('/api/admin/keys', 'POST', { person: 'FastTask SSO 成员' }, admin.body.session)
    assert.equal(fastTaskKey.status, 201)
    assert.equal(fastTaskProvisionCalls, 0)
    const emptyMember = await call('/api/content/unlock', 'POST', { key: fastTaskKey.body.key })
    assert.equal(emptyMember.status, 200)
    const emptyToday = await call('/api/fasttask/today', 'GET', undefined, emptyMember.body.session)
    assert.equal(emptyToday.status, 200)
    assert.equal(emptyToday.body.today.received, false)
    assert.equal(emptyToday.body.today.items.length, 0)
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
    // FastCAS service ingest rejects a mixed credential pair (bearer plus
    // legacy header) as a client error before it validates the bearer token.
    assert.equal((await call('/api/insight/publish', 'POST', { person: '同名成员' }, 'bad-token', { 'X-FastInsight-Key': 'integration-ingest-key' })).status, 400)
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
    // After the SQLite account migration, data/access.json is only the
    // read-only migration source; the live record lives in accounts.sqlite, so
    // the persisted account binding and content are verified through the API.
    const relogged = await call('/api/content/unlock', 'POST', { key: changed.body.key })
    const after = await call('/api/content/me', 'GET', undefined, relogged.body.session)
    assert.equal(after.status, 200)
    assert.equal(after.body.accountId, accountId)
    assert.equal(after.body.insightItems.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => fastWrite.close(resolve))
    await new Promise((resolve) => fastRead.close(resolve))
    await new Promise((resolve) => fastTask.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
