import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const executablePath = edgeCandidates.find((candidate) => existsSync(candidate))
const baseUrl = process.env.VISUAL_CHECK_URL ?? 'http://127.0.0.1:5173'
const outputDir = path.resolve(process.env.VISUAL_CHECK_OUTPUT ?? 'test-results')

if (!executablePath) throw new Error('未找到 Edge，请通过 EDGE_PATH 指定浏览器路径。')
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const results = []

try {
  for (const testCase of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: testCase.width, height: testCase.height },
      colorScheme: 'light',
    })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(outputDir, `fastresearch-${testCase.name}-pw.png`), fullPage: true })

    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }))

    let dialog = null
    let credentialsDialog = null
    if (testCase.name === 'mobile') {
      await page.getByRole('button', { name: '使用个人 Key 查看整合内容' }).click()
      await page.waitForTimeout(200)
      credentialsDialog = await page.getByRole('dialog').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }
      })
      if (credentialsDialog.left < 0 || credentialsDialog.right > testCase.width) {
        throw new Error('个人 Key 弹窗超出移动端视口。')
      }
      await page.screenshot({ path: path.join(outputDir, 'fastresearch-mobile-key-pw.png') })
      await page.getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '管理员登录' }).click()
      await page.getByLabel('管理员账号').fill('admin')
      await page.getByLabel('管理员密码').fill('admin123456')
      await page.getByRole('button', { name: '登录后台' }).click()
      await page.waitForTimeout(400)
      await page.getByText('个人 Key 管理', { exact: true }).waitFor()
      await page.getByPlaceholder('成员姓名').fill('视觉测试')
      await page.getByRole('button', { name: '生成' }).click()
      await page.waitForTimeout(250)
      dialog = await page.getByRole('dialog').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }
      })
      await page.screenshot({ path: path.join(outputDir, 'fastresearch-mobile-dialog-pw.png') })
      const key = await page.locator('code').first().textContent()
      if (!key?.startsWith('fk_')) throw new Error('管理员未生成有效个人 Key。')
      await page.getByRole('button', { name: '关闭 Key 提示' }).click()
      await page.getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '使用个人 Key 查看整合内容' }).click()
      await page.getByRole('textbox', { name: '个人 Key' }).fill(key)
      await page.getByRole('button', { name: '解锁内容' }).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: '切换到深色模式' }).click()
      await page.waitForTimeout(350)
      await page.screenshot({ path: path.join(outputDir, 'fastresearch-mobile-dark-pw.png'), fullPage: true })
    }

    results.push({ ...testCase, ...layout, dialog, credentialsDialog, consoleErrors })
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
