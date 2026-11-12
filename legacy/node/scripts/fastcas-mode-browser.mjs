// Built Research + registry SDK + protocol fixture at the external issuer boundary.
// node scripts/fastcas-mode-browser.mjs <chromium executable> <evidence directory>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.resolve(process.argv[3] || 'test-results/fastcas-modes')
assert.ok(process.argv[2], 'Supply a Chromium executable')
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }
const codes = new Map(), intents = new Map(), links = new Map(), requests = [], results = []
let issuer, origin, running, browser, rejectActivation = false
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, issuer)
  requests.push({ method: req.method, path: url.pathname })
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
  try {
    if (url.pathname === '/.well-known/openid-configuration') return json({
      issuer, authorization_endpoint: issuer + '/oauth/authorize', token_endpoint: issuer + '/oauth/token',
      jwks_uri: issuer + '/.well-known/jwks.json', userinfo_endpoint: issuer + '/oauth/userinfo',
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'], code_challenge_methods_supported: ['S256'],
    })
    if (url.pathname === '/.well-known/jwks.json') return json({ keys: [jwk] })
    if (url.pathname === '/oauth/authorize') {
      assert.equal(url.searchParams.get('client_id'), 'research')
      assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/fastcas/callback')
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      const code = randomUUID()
      codes.set(code, Object.fromEntries(url.searchParams))
      const callback = new URL(url.searchParams.get('redirect_uri'))
      callback.searchParams.set('state', url.searchParams.get('state'))
      callback.searchParams.set('code', code)
      res.writeHead(302, { Location: callback.href }); return res.end()
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    if (url.pathname === '/oauth/token' || url.pathname.startsWith('/api/v1/')) {
      assert.ok(req.headers.authorization?.startsWith('Basic '))
      const credentials = Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').map(value => decodeURIComponent(value.replaceAll('+', ' ')))
      assert.deepEqual(credentials, ['research', 'disposable-secret'])
    }
    if (url.pathname === '/oauth/token') {
      const form = new URLSearchParams(raw), code = form.get('code'), authorization = codes.get(code)
      assert.ok(authorization, 'one-use authorization code')
      codes.delete(code)
      assert.equal(form.get('grant_type'), 'authorization_code')
      assert.equal(form.get('redirect_uri'), authorization.redirect_uri)
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authorization.code_challenge)
      const now = Math.floor(Date.now() / 1000)
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
      const signingInput = encode({ alg: 'RS256', kid: 'fixture' }) + '.' + encode({
        nonce: authorization.nonce, sid: 'fixture-sid', iss: issuer, aud: 'research',
        sub: 'fixture-subject', iat: now, exp: now + 300,
      })
      const idToken = signingInput + '.' + sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
      return json({ access_token: 'fixture-user-token', token_type: 'Bearer', expires_in: 300, id_token: idToken })
    }
    if (url.pathname === '/oauth/userinfo') {
      assert.equal(req.headers.authorization, 'Bearer fixture-user-token')
      return json({ sub: 'fixture-subject', name: 'CAS fixture', email: 'fixture@example.test', email_verified: true })
    }
    if (url.pathname === '/api/v1/link-intents' && req.method === 'POST') {
      assert.ok(req.headers['idempotency-key'])
      const body = JSON.parse(raw)
      assert.deepEqual(Object.keys(body), ['local_account_ref'])
      const intent = { id: randomUUID(), nonce: randomUUID(), local_account_ref: body.local_account_ref }
      intents.set(intent.id, intent)
      return json(intent, 201)
    }
    const prepare = url.pathname.match(/^\/api\/v1\/link-intents\/([^/]+)\/prepare$/)
    if (prepare && req.method === 'POST') {
      const intent = intents.get(prepare[1]), body = JSON.parse(raw)
      assert.equal(body.nonce, intent.nonce)
      assert.equal(body.subject, 'fixture-subject')
      const link = { id: intent.id, client_id: 'research', local_account_ref: intent.local_account_ref, subject: body.subject, state: 'prepared', version: 1 }
      links.set(link.id, link)
      return json(link)
    }
    const activate = url.pathname.match(/^\/api\/v1\/link-intents\/([^/]+)\/activate$/)
    if (activate && req.method === 'POST') {
      if (rejectActivation) return json({ code: 'unavailable', message: 'fixture interruption after prepare' }, 503)
      const link = links.get(activate[1])
      link.state = 'active'; link.version++
      return json(link)
    }
    if (url.pathname === '/api/v1/account-links/resolve') return json([...links.values()].find(link => link.subject === url.searchParams.get('subject') && link.state === 'active'))
    const current = url.pathname.match(/^\/api\/v1\/account-links\/([^/]+)(\/revoke)?$/)
    if (current) {
      const link = links.get(current[1])
      assert.ok(link)
      if (current[2]) {
        assert.equal(req.method, 'POST')
        assert.equal(req.headers['if-match'], `"${link.version}"`)
        link.state = 'revoked'; link.version++
      }
      return json(link)
    }
    json({ error: 'unexpected endpoint' }, 404)
  } catch (error) { requests.push({ error: error.message }); json({ error: error.message }, 500) }
})
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
issuer = `http://127.0.0.1:${provider.address().port}`

async function start(mode) {
  // Reserve one stable callback port across mode restarts.
  if (!origin) {
    const reservation = createServer()
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${reservation.address().port}`
    await new Promise(resolve => reservation.close(resolve))
  }
  const data = path.join(output, 'data')
  await mkdir(data, { recursive: true })
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: {
    ...process.env, HOST: '127.0.0.1', PORT: new URL(origin).port,
    FASTRESEARCH_DATA_DIR: data, FASTRESEARCH_ACCOUNT_DATABASE: path.join(data, 'accounts.sqlite'),
    FASTRESEARCH_STATIC_DIR: path.join(root, 'dist'), ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'disposable-admin-password',
    FASTRESEARCH_COOKIE_DOMAIN: '', FASTRESEARCH_COOKIE_NAME: 'fr_session', FASTRESEARCH_PUBLIC_URL: origin,
    FASTRESEARCH_FASTCAS_ISSUER: issuer, FASTRESEARCH_FASTCAS_CLIENT_ID: 'research',
    FASTRESEARCH_FASTCAS_CLIENT_SECRET: 'disposable-secret', FASTRESEARCH_FASTCAS_REDIRECT_URI: origin + '/api/auth/fastcas/callback',
    FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP: 'true', FASTRESEARCH_FASTCAS_ENABLED: mode === 'off' ? 'false' : 'true',
    FASTRESEARCH_FASTCAS_LOGIN_ENABLED: mode === 'login-off' ? 'false' : 'true',
    FASTRESEARCH_FASTCAS_LINK_ENABLED: mode === 'link-off' ? 'false' : 'true',
    FASTTASK_URL: '', FASTTASK_API_KEY: '', FASTTASK_SERVICE_ISSUER: '', FASTTASK_SERVICE_CLIENT_ID: '', FASTTASK_SERVICE_CLIENT_SECRET: '',
    FASTWRITE_URL: '', FASTWRITE_API_KEY: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  running = child
  let log = ''
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Startup timeout: ' + log)), 15000)
    const record = chunk => { log += chunk; if (log.includes('FastResearch listening on')) { clearTimeout(deadline); resolve() } }
    child.stdout.on('data', record); child.stderr.on('data', record)
    child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Server exit ${code}: ${log}`)) })
  })
}
async function stop() { if (running) { const child = running; running = undefined; const exited = once(child, 'exit'); child.kill(); await exited } }
async function api(route, method = 'GET', body, token) {
  return fetch(origin + route, { method, redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function status(page) { return page.evaluate(() => fetch('/api/auth/fastcas/status').then(response => response.json())) }
async function openLink(page, key) {
  await page.getByRole('button', { name: 'CAS认证', exact: true }).click()
  await page.getByLabel('当前账号的原 Key').fill(key)
}

try {
  await start('on')
  browser = await chromium.launch({ executablePath: process.argv[2], headless: true })
  const local = await browser.newContext(), cas = await browser.newContext()
  const page = await local.newPage(), login = await cas.newPage()
  const errors = []
  for (const target of [page, login]) target.on('pageerror', error => errors.push(error.message))
  for (const route of ['/', '/intro', '/workspace', '/?fastcas=failed', '/?launch=fast-task', '/#home']) {
    await page.goto(origin + route)
    await page.locator(route === '/' || route === '/intro' ? '.promo-page' : '.research-workspace').waitFor()
    results.push({ route, rendered: true })
  }
  const admin = await (await api('/api/admin/login', 'POST', { username: 'admin', password: 'disposable-admin-password' })).json()
  const issued = await (await api('/api/admin/keys', 'POST', { person: 'CAS mode member' }, admin.session)).json()
  assert.ok(issued.key)
  await page.goto(origin + '/workspace')
  await page.getByRole('button', { name: '登录', exact: true }).first().click()
  await page.locator('#personal-key').fill(issued.key)
  await page.locator('dialog form button[type=submit]').click()
  await page.locator('.header-identity').waitFor()
  const before = await page.evaluate(() => fetch('/api/content/me').then(response => response.json()))
  assert.equal((await api('/api/content/impression', 'PUT', { text: 'mode evidence notes' }, before.session)).status, 200)
  await openLink(page, issued.key)
  await page.getByRole('button', { name: '认证当前账号', exact: true }).click()
  await page.getByText('FastCAS 操作已完成').waitFor()
  assert.equal((await status(page)).link.state, 'active')
  await login.goto(origin + '/workspace')
  await login.getByRole('button', { name: '登录', exact: true }).click()
  await login.getByRole('link', { name: '使用 FastCAS 登录', exact: true }).click()
  await login.getByText('FastCAS 操作已完成').waitFor()
  const member = await login.evaluate(() => fetch('/api/content/me').then(response => response.json()))
  assert.equal(member.accountId, before.accountId)
  assert.equal(member.impression.text, 'mode evidence notes')
  assert.notEqual(member.session, before.session)
  results.push({ mode: 'on', sdk: '0.1.2', link: 'active', login: 'same account/content' })
  await stop(); await start('login-off')
  assert.deepEqual(await (await api('/api/auth/fastcas/available')).json(), { enabled: true, login_enabled: false, link_enabled: true })
  const guest = await browser.newPage()
  await guest.goto(origin + '/workspace'); await guest.locator('.research-workspace').waitFor()
  assert.equal(await guest.getByRole('link', { name: '使用 FastCAS 登录', exact: true }).count(), 0)
  await guest.getByRole('button', { name: '登录', exact: true }).first().click()
  assert.equal(await guest.locator('dialog').getByRole('link', { name: '使用 FastCAS 登录', exact: true }).count(), 0)
  assert.equal((await api('/api/auth/fastcas/login')).status, 403)
  assert.equal((await api('/api/content/me', 'GET', undefined, member.session)).status, 200)
  results.push({ mode: 'login-off', headerAndKeyDialog: 'hidden', backend: 403, existingSession: 200 })
  await guest.close()
  await stop(); await start('link-off')
  assert.deepEqual(await (await api('/api/auth/fastcas/available')).json(), { enabled: true, login_enabled: true, link_enabled: false })
  const loginOnly = await browser.newPage()
  await loginOnly.goto(origin + '/workspace')
  await loginOnly.getByRole('button', { name: '登录', exact: true }).click()
  await loginOnly.getByRole('link', { name: '使用 FastCAS 登录', exact: true }).waitFor()
  await loginOnly.close()
  await page.reload(); await openLink(page, issued.key)
  assert.equal((await status(page)).link_enabled, false)
  await page.getByRole('button', { name: '解除认证', exact: true }).click()
  await page.getByText('尚未认证', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '认证当前账号', exact: true }).isDisabled(), true)
  assert.equal((await api('/api/auth/fastcas/link', 'POST', { key: issued.key }, before.session)).status, 403)
  assert.equal((await api('/api/content/me', 'GET', undefined, member.session)).status, 401)
  assert.equal((await api('/api/content/me', 'GET', undefined, before.session)).status, 200)
  results.push({ mode: 'link-off', newLink: 'disabled/403', revoke: 'allowed', casSession: 401, keySession: 200 })
  // Interrupt the provider after prepare; the production adapter persists pending state.
  await stop(); await start('on'); rejectActivation = true
  await page.reload(); await openLink(page, issued.key)
  await page.getByRole('button', { name: '认证当前账号', exact: true }).click()
  await page.getByText('FastCAS 操作未完成').waitFor()
  assert.equal((await status(page)).link.state, 'prepared')
  rejectActivation = false
  await stop(); await start('link-off')
  await page.reload(); await openLink(page, issued.key)
  assert.equal(await page.getByRole('button', { name: '重试完成认证', exact: true }).isDisabled(), true)
  assert.equal((await api('/api/auth/fastcas/reconcile', 'POST', {}, before.session)).status, 403)
  assert.equal(await page.getByRole('button', { name: '解除认证', exact: true }).isEnabled(), true)
  results.push({ mode: 'link-off-pending', reconcile: 'disabled/403', revoke: 'enabled' })
  await stop(); await start('off')
  const count = requests.length
  await page.reload(); await page.locator('.header-identity').waitFor()
  await page.getByRole('button', { name: 'CAS认证', exact: true }).click()
  await page.getByText('当前部署尚未启用 CAS 认证', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'FastCAS 账号认证', exact: true }).count(), 0)
  assert.deepEqual(await (await api('/api/auth/fastcas/available')).json(), { enabled: false, login_enabled: false, link_enabled: false })
  assert.equal((await api('/api/auth/fastcas/login')).status, 404)
  assert.equal((await api('/api/content/me', 'GET', undefined, before.session)).status, 200)
  assert.equal(requests.length, count)
  results.push({ mode: 'off', controls: 'hidden', backend: 404, keySession: 200, providerRequests: 0 })
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(output, 'cas-off-local-session.png') })
  console.log(JSON.stringify({ results, output }, null, 2))
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, requests }, null, 2))
  await browser?.close(); await stop()
  await new Promise(resolve => provider.close(resolve))
}
