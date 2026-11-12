import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
const data = await mkdtemp(path.join(tmpdir(), 'fastresearch-activity-'))
await writeFile(path.join(data, 'access.json'), JSON.stringify({ keys: [{ id: 'browser-key', person: '测试研究员', keyHash: createHash('sha256').update('fixture-personal-key').digest('hex'), credentialVersion: 1 }] }))
const listener = net.createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const origin = `http://127.0.0.1:${port}`
const server = spawn(path.resolve('bin/fastresearch'), [], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), FASTRESEARCH_DATA_DIR: data, FASTRESEARCH_ACCOUNT_DATABASE: path.join(data, 'accounts.sqlite'), FASTRESEARCH_STATIC_DIR: path.resolve('dist'), FASTRESEARCH_PUBLIC_URL: origin, FASTRESEARCH_ALLOW_LEGACY_KEY_LOGIN: 'true', FASTRESEARCH_FASTCAS_ENABLED: 'false', FASTRESEARCH_WORKSPACE_SERVICE_ENABLED: 'false', FASTWRITE_FASTCAS_SERVICE_ENABLED: 'false', FASTTASK_SERVICE_ENABLED: 'false', FASTTASK_FASTCAS_SERVICE_ENABLED: 'false' }, stdio: 'ignore' })
for (let attempt = 0; ; attempt++) {
  try { const response = await fetch(origin + '/api/health'); if (response.ok) break } catch {}
  if (attempt >= 100) { server.kill(); throw Error('QA server did not start') }
  await new Promise(resolve => setTimeout(resolve, 100))
}
await mkdir('test-results/activity', { recursive: true })
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })
const errors = []
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/workspace', { waitUntil: 'networkidle' })
    await page.getByRole('region', { name: 'FastNews 个人动态', exact: true }).getByRole('button').click()
    await page.locator('#personal-key').fill('fixture-personal-key')
    await page.locator('dialog form button[type=submit]').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('region', { name: /个人动态$/ }).getByText('使用关联的 FastCAS 账号登录', { exact: true }).waitFor()
    let state = 'active'
    await page.route('**/api/workspace/apps/*/activity', route => {
      const appId = new URL(route.request().url()).pathname.split('/')[4]
      return route.fulfill({ json: { schemaVersion: 'fastresearch.workspace.v1', appId, accountState: state, message: state === 'missing' ? '尚未开通此应用' : '暂时无法读取个人动态，请稍后重试', registrationPath: state === 'missing' ? `/api/workspace/apps/${appId}/register` : undefined, metrics: state === 'active' ? [{ id: 'updates', label: '未读动态', value: 3 }] : [], items: state === 'active' ? [{ id: 'item', kind: 'comment', title: '个人研究动态已更新', description: '仅展示当前账号信息', path: 'https://write.example.test/projects/paper', occurredAt: '2026-11-12T00:00:00Z' }] : [] } })
    })
    for (const [id, name] of [['fast-news','FastNews'], ['fast-read','FastRead'], ['fast-write','FastWrite']]) {
      await page.goto(origin + '/workspace?tool=' + id, { waitUntil: 'networkidle' })
      await page.getByRole('region', { name: /个人动态$/ }).locator('ul').getByText('个人研究动态已更新').waitFor()
      assert.equal(await page.getByRole('region', { name: /个人动态$/ }).locator('dd').innerText(), '3')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      state = 'missing'
      await page.getByRole('button', { name: `刷新 ${name} 动态`, exact: true }).click()
      await page.getByRole('region', { name: /个人动态$/ }).getByRole('link', { name: `注册 / 开通 ${name} 账号` }).waitFor()
      assert.equal(await page.getByRole('region', { name: /个人动态$/ }).locator('ul').count(), 0)
      await page.screenshot({ path: `test-results/activity/${id}-${width}-missing.png` })
      state = 'unavailable'
      await page.getByRole('button', { name: `刷新 ${name} 动态`, exact: true }).click()
      await page.getByRole('region', { name: /个人动态$/ }).getByText('暂时无法读取个人动态，请稍后重试').waitFor()
      assert.equal(await page.getByRole('region', { name: /个人动态$/ }).getByRole('link').count(), 0)
      state = 'active'
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Passed real Key login and Read/News/Write activity active/missing/unavailable states at 390/1440px')
} finally {
  await browser.close()
  const stopped = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await stopped
  await rm(data, { recursive: true, force: true })
}
