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
    const adminButton = page.getByRole('button', { name: '管理员登录', exact: true })
    await adminButton.click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.locator('dialog input[type=password]').count(), 0)
    assert.equal(await page.locator('dialog a[href$="/api/auth/fastcas/login"]').count(), 1)
    assert.ok((await page.getByRole('dialog').innerText()).includes('不提供独立管理员密码或自行注册入口'))
    assert.equal(await page.locator('dialog').evaluate(element => element.matches(':modal')), true)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}.png`), animations: 'disabled' })
    assert.equal(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), true)
    await page.keyboard.press('Escape')
    assert.equal(await adminButton.evaluate(el => el === document.activeElement), true)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Workspace browser checks passed: light/dark, 320/390/768/1024/1440px, CAS-only administrator entry')
} finally { await browser.close() }
