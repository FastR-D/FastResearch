// Real built UI -> production Node server -> isolated SQLite/roster files.
// Run after npm run build: node scripts/fastui-browser.mjs <browser> <output>.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const executable = process.argv[2] || process.env.EDGE_PATH
const output = path.resolve(process.argv[3] || 'test-results/fastui')
if (!executable) throw new Error('Supply a Chromium executable path or EDGE_PATH.')
await mkdir(output, { recursive: true })
const data = path.join(output, 'data')
await mkdir(data, { recursive: true })
const roster = path.join(data, 'roster.yaml')
await writeFile(roster, JSON.stringify({ directions: Array.from({ length: 12 }, (_, index) => ({
  name: `UI field ${String(index + 1).padStart(2, '0')}`, keywords: ['security', 'systems'],
  owners: [{ name: 'Fixture owner', feishu_open_id: 'fixture-open-id' }], priority: index,
})), default_owner: { name: 'Fixture owner' } }))
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: {
  ...process.env, PORT: '0', HOST: '127.0.0.1', ADMIN_USERNAME: 'ui-review', ADMIN_PASSWORD: 'ui-local-only-password',
  FASTRESEARCH_DATA_DIR: data, FASTRESEARCH_ACCOUNT_DATABASE: path.join(data, 'accounts.sqlite'),
  FASTINSIGHT_ROSTER: roster, FASTRESEARCH_STATIC_DIR: path.join(root, 'dist'),
  FASTTASK_URL: '', FASTTASK_API_KEY: '', FASTWRITE_URL: '', FASTWRITE_API_KEY: '',
}, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stderr.on('data', chunk => { log += chunk })
const origin = await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error('Research startup timed out: ' + log)), 20000)
  child.once('error', reject)
  child.stdout.on('data', chunk => {
    log += chunk
    const match = log.match(/FastResearch listening on (http:\/\/127\.0\.0\.1:\d+)/)
    if (match) { clearTimeout(deadline); resolve(match[1]) }
  })
})
const results = []
let browser
try {
  const adminResponse = await fetch(origin + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ui-review', password: 'ui-local-only-password' }) })
  assert.equal(adminResponse.status, 200)
  const admin = await adminResponse.json()
  let memberKey
  for (let index = 0; index < 24; index++) {
    const response = await fetch(origin + '/api/admin/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.session}` }, body: JSON.stringify({ person: `UI fixture ${index + 1}` }) })
    assert.equal(response.status, 201)
    memberKey = (await response.json()).key
  }
  browser = await chromium.launch({ executablePath: executable, headless: true })
  for (const scheme of ['light', 'dark']) for (const width of [1440, 1024, 390]) {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 960 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = [], classes = new Set()
    page.on('pageerror', error => errors.push(error.message))
    const snapshot = async name => {
      for (const value of await page.evaluate(() => [...new Set([...document.querySelectorAll('[class]')].flatMap(element => [...element.classList]))])) classes.add(value)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' overflow')
      await page.screenshot({ path: path.join(output, `${scheme}-${width}-${name}.png`), fullPage: true })
    }
    await page.goto(origin + '/workspace', { waitUntil: 'load' })
    await page.locator('.research-workspace').waitFor()
    assert.equal(await page.locator('html').getAttribute('data-fastui-theme'), scheme)
    await snapshot('guest')
    const trigger = page.getByRole('button', { name: '管理员登录', exact: true })
    await trigger.click()
    await page.locator('#admin-user').fill('ui-review')
    await page.locator('#admin-pass').fill('ui-local-only-password')
    await page.locator('dialog .dialog-form button[type=submit]').click()
    await page.locator('.admin-key-row').nth(23).waitFor()
    assert.equal(await page.locator('dialog').evaluate(element => element.matches(':modal')), true)
    assert.equal(await page.locator('.admin-key-list').evaluate(element => element.scrollHeight > element.clientHeight), true)
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog:modal'))), true)
    }
    await snapshot('admin-long-list')
    await page.keyboard.press('Escape')
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
    await page.getByRole('button', { name: '论文分发设置', exact: true }).click()
    await page.locator('.roster-direction-card').nth(11).waitFor()
    const firstName = page.locator('.roster-direction-card input').first()
    await firstName.fill(`UI edited ${scheme} ${width}`)
    await snapshot('roster')
    const [saved] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/fastinsight/roster')),
      page.locator('form.roster-editor button[type=submit]').click(),
    ])
    assert.equal(saved.status(), 200)
    assert.equal((await saved.json()).roster.directions[0].name, `UI edited ${scheme} ${width}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '验证个人Key', exact: true }).first().click()
    await page.locator('#personal-key').fill(memberKey)
    await page.locator('dialog form button[type=submit]').click()
    await page.locator('.header-identity').waitFor()
    await page.locator('.workspace-tabs button').filter({ hasText: '科研工具' }).click()
    await page.locator('.workflow-stage').waitFor()
    await snapshot('workflow-member')
    await page.locator('.workspace-tabs button').filter({ hasText: 'FastInsight信箱' }).click()
    await page.locator('.insight-mailbox').waitFor()
    await snapshot('inbox-member')
    await page.goto(origin + '/intro', { waitUntil: 'load' })
    assert.equal(await page.locator('.promo-page').getAttribute('data-fastui-theme'), 'light')
    await snapshot('intro')
    assert.deepEqual(errors, [])
    results.push({ scheme, width, classes: [...classes].sort(), pageErrors: errors, roster: 'saved', keys: 'long list scrolls', dialog: 'native/focus cycle/Escape/restore', overflow: false })
    await context.close()
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, log }, null, 2))
  await browser?.close()
  child.kill()
}
console.log(JSON.stringify({ passed: results.length, output }, null, 2))
