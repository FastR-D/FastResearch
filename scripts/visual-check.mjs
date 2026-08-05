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
      await page.getByRole('button', { name: '进入 FastTask' }).click()
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
      await page.getByLabel('Access Token').fill('visual-check-token')
      await page.getByRole('button', { name: '确认连接' }).click()
      await page.waitForTimeout(400)
      if (await page.getByText('进入工具', { exact: true }).count() !== 1) {
        throw new Error('FastTask Token 连接状态未更新。')
      }
      await page.getByRole('button', { name: 'Read', exact: true }).click()
      await page.getByRole('heading', { name: '连接 Read Token' }).waitFor()
      if (await page.getByLabel('Access Token').inputValue() !== '') {
        throw new Error('Read 错误地复用了 FastTask Token。')
      }
      await page.getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '管理访问凭证' }).click()
      await page.waitForTimeout(250)
      await page.getByText('1 / 4 已连接').waitFor()
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
        throw new Error('访问凭证弹窗超出移动端视口。')
      }
      await page.screenshot({ path: path.join(outputDir, 'fastresearch-mobile-credentials-pw.png') })
      await page.getByRole('button', { name: '更新 FastTask Token' }).click()
      await page.getByRole('button', { name: '移除 Token' }).click()
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
