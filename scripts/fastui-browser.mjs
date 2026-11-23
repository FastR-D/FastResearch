// Run against the real built Go application. Authentication contracts are tested
// by the signed OIDC provider fixture in internal/httpapi/server_test.go.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const origin = process.env.FASTRESEARCH_CHECK_URL ?? 'http://127.0.0.1:18789'
const output = path.resolve(process.env.FASTRESEARCH_CHECK_OUTPUT ?? 'test-results/workspace')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? '/usr/bin/google-chrome', headless: true })
const errors = []
try {
  for (const colorScheme of ['light', 'dark']) for (const width of [320, 390, 768, 1024, 1440]) {
    const context = await browser.newContext({ colorScheme, viewport: { width, height: 960 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/workspace', { waitUntil: 'networkidle' })
    await page.locator('#workspace-content').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    if (width < 768) await page.getByRole('button', { name: '工具导航', exact: true }).click()
    const adminButton = page.getByRole('button', { name: '管理账号', exact: true })
    await adminButton.click()
    const admin = page.getByRole('region', { name: '管理账号', exact: true })
    await admin.waitFor()
    assert.equal(new URL(page.url()).searchParams.get('view'), 'admin')
    assert.equal(await admin.locator('input[type=password]').count(), 0)
    const login = await admin.locator('a[href*="/api/auth/fastcas/login"]').getAttribute('href')
    assert.equal(new URL(login, origin).searchParams.get('next'), '/workspace?view=admin')
    assert.ok((await admin.innerText()).includes('不提供独立管理员密码或自行注册入口'))
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}.png`), animations: 'disabled' })
    if (width < 768) assert.equal(await page.locator('#workspace-content').evaluate(el => el === document.activeElement), true)
    await page.goBack()
    await page.getByRole('heading', { name: 'FastNews', level: 1, exact: true }).waitFor()
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Workspace browser checks passed: light/dark, 320/390/768/1024/1440px, CAS-only administrator entry')
} finally { await browser.close() }
