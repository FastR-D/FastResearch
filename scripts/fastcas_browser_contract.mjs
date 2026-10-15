import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const { FASTCAS_CONTRACT_ISSUER: issuer, FASTCAS_CONTRACT_RESEARCH_ORIGIN: origin } = process.env
if (!issuer || !origin) throw Error('browser contract configuration missing')

async function json(url, options) {
  const response = await fetch(url, options)
  assert.ok(response.ok, `${url}: ${response.status}`)
  return response.json()
}

const admin = await json(`${origin}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ username: 'admin', password: 'local-admin-password' }),
})
const issued = await json(`${origin}/api/admin/keys`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${admin.session}` },
  body: JSON.stringify({ person: 'Alice' }),
})
assert.ok(issued.key?.startsWith('fk_'))

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(10000)

async function authorize(target) {
  await target.locator('input[name=email]').fill('alice@example.test')
  await target.locator('input[name=password]').fill('correct horse battery staple')
  await target.getByRole('button', { name: '登录', exact: true }).click()
  await target.getByRole('button', { name: '确认并继续' }).click()
  await target.getByText('FastCAS 操作已完成').waitFor()
}

try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '科研凭证认证' }).click()
  await page.getByLabel('个人科研凭证 (PERSONAL KEY)').fill(issued.key)
  await page.getByRole('button', { name: '验证凭证并进入工作空间' }).click()
  await page.getByText('👤 Alice').waitFor()
  const before = await page.evaluate(() => fetch('/api/content/me').then(response => response.json()))
  assert.ok(before.accountId && before.keyId)
  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/content/impression', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Browser preserved notes' }) })
    return response.status
  })
  assert.equal(saved, 200)
  await page.getByRole('button', { name: 'FastCAS 认证' }).click()
  await page.getByLabel('当前账号的原 Key').fill(issued.key)
  await page.getByRole('button', { name: '认证当前账号' }).click()
  await authorize(page)
  await page.getByText('👤 Alice').waitFor()
  const link = await page.evaluate(() => fetch('/api/auth/fastcas/status').then(response => response.json()))
  assert.equal(link.link?.state, 'active')
  const afterLink = await page.evaluate(() => fetch('/api/content/me').then(response => response.json()))
  assert.equal(afterLink.accountId, before.accountId)
  assert.equal(afterLink.impression.text, 'Browser preserved notes')

  const second = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const login = await second.newPage()
    login.setDefaultTimeout(10000)
    await login.goto(origin, { waitUntil: 'networkidle' })
    await login.getByRole('link', { name: '使用 FastCAS 登录' }).click()
    await authorize(login)
    await login.getByText('👤 Alice').waitFor()
    const cas = await login.evaluate(() => fetch('/api/content/me').then(response => response.json()))
    assert.equal(cas.accountId, before.accountId)
    assert.equal(cas.keyId, before.keyId)
    assert.equal(cas.impression.text, 'Browser preserved notes')
    assert.notEqual(cas.session, before.session)
    const overflow = await login.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 2).slice(0, 10).map(element => ({ tag: element.tagName, className: String(element.className).slice(0, 80), right: element.getBoundingClientRect().right })) }))
    assert.equal(overflow.scroll > overflow.width, false, `mobile Research page overflow: ${JSON.stringify(overflow)}`)

    await page.getByRole('button', { name: 'FastCAS 认证' }).click()
    await page.getByLabel('当前账号的原 Key').fill(issued.key)
    await page.getByRole('button', { name: '解除认证' }).click()
    await page.getByText('尚未认证', { exact: true }).waitFor()
    assert.equal(await login.evaluate(() => fetch('/api/content/me').then(response => response.status)), 401)
    const local = await page.evaluate(() => fetch('/api/content/me').then(response => response.json()))
    assert.equal(local.accountId, before.accountId)
    assert.equal(local.impression.text, 'Browser preserved notes')
  } finally { await second.close() }
  console.log('FastResearch browser contract passed: Key login, explicit link, FastCAS login, revoke isolation, stable account and content')
} catch (error) {
  console.error('browser state:', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 500))
  throw error
} finally { await browser.close() }
