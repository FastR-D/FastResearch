import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const executablePath = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Edge is required for the workspace visual check')

const baseUrl = process.env.VISUAL_CHECK_URL ?? 'http://127.0.0.1:5174/workspace'
const outputDir = path.resolve('test-results')
mkdirSync(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 700 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('.module-showcase').waitFor()
    const favicon = await page.locator('link[rel="icon"]').getAttribute('href')
    if (!favicon || !(await page.request.get(new URL(favicon, baseUrl).toString())).ok()) throw new Error('Favicon is missing')
    const workspaceHeight = () => page.locator('.research-workspace').evaluate((element) => Math.round(element.getBoundingClientRect().height))
    const initialHeight = await workspaceHeight()
    const assertWorkspaceHeight = async () => {
      const currentHeight = await workspaceHeight()
      if (Math.abs(currentHeight - initialHeight) > 1) throw new Error(`Workspace height changed: ${initialHeight} -> ${currentHeight}`)
    }

    for (const moduleName of ['FastNews', 'FastRead', 'FastWrite']) {
      await page.locator('.module-switcher').getByRole('button', { name: moduleName }).click()
      if (!(await page.locator('.module-overview h3').textContent()).includes(moduleName)) throw new Error(`${moduleName} overview is missing`)
    }
    await page.locator('.module-switcher').getByRole('button', { name: 'FastWrite' }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(outputDir, `workspace-${viewport.name}.png`), fullPage: true })

    if (viewport.name === 'desktop') {
      const stage = page.locator('.workflow-stage')
      const stageCanScroll = await stage.evaluate((element) => element.scrollHeight > element.clientHeight + 1)
      if (!stageCanScroll) throw new Error('Desktop workflow details cannot scroll inside the fixed workspace')
      await stage.hover()
      const initialStageScrollTop = await stage.evaluate((element) => element.scrollTop)
      await page.mouse.wheel(0, 360)
      await page.waitForTimeout(120)
      const scrolledStage = await stage.evaluate((element) => ({ scrollTop: element.scrollTop, view: document.querySelector('.workspace-tabs button.is-active')?.textContent }))
      if (scrolledStage.view?.includes('科研工序') === false || scrolledStage.scrollTop <= initialStageScrollTop) throw new Error(`Workflow content did not scroll inside workspace: ${JSON.stringify(scrolledStage)}`)
      await stage.evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.waitForTimeout(500)
      await page.locator('.workspace-toolbar').hover()
      await page.mouse.wheel(0, 360)
      await page.locator('.insight-mailbox').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.mouse.wheel(0, 360)
      await page.locator('.workspace-team-page').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.mouse.wheel(0, 360)
      await page.locator('.roster-editor--locked').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.mouse.wheel(0, 360)
      await page.locator('.workflow-board').waitFor()
      await assertWorkspaceHeight()
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(500)
      await page.locator('.workspace-toolbar').hover()
      await page.mouse.wheel(0, -360)
      await page.locator('.roster-editor--locked').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.mouse.wheel(0, -360)
      await page.locator('.workspace-team-page').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.mouse.wheel(0, -360)
      await page.locator('.insight-mailbox').waitFor()
      await assertWorkspaceHeight()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(outputDir, 'workspace-inbox-desktop.png'), fullPage: true })
    } else {
      const content = page.locator('.workspace-page')
      const contentCanScroll = await content.evaluate((element) => element.scrollHeight > element.clientHeight + 1)
      if (!contentCanScroll) throw new Error('Mobile workspace content cannot scroll inside the fixed workspace')
      await page.getByRole('button', { name: 'FastInsight 信箱' }).click()
      await assertWorkspaceHeight()
      const inboxSizes = await page.evaluate(() => Object.fromEntries(['.research-workspace', '.insight-mailbox', '.mailbox-head', '.mailbox-locked'].map((selector) => {
        const element = document.querySelector(selector)
        return [selector, { height: Math.round(element.getBoundingClientRect().height), minHeight: getComputedStyle(element).minHeight, display: getComputedStyle(element).display }]
      })))
      console.log(`mobile inbox: ${JSON.stringify(inboxSizes)}`)
      await page.getByRole('button', { name: '验证 Key 并解锁信箱' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '团队任务进度' }).click()
      await page.locator('.workspace-team-page').waitFor()
      await assertWorkspaceHeight()
      if (!(await page.locator('.team-progress-panel').isVisible())) throw new Error('Mobile team progress page is missing')
      await page.waitForTimeout(450)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(outputDir, `workspace-team-${viewport.name}.png`), fullPage: true })
      await page.getByRole('button', { name: '分发配置' }).click()
      await page.locator('.roster-editor--locked').waitFor()
      await assertWorkspaceHeight()
      if (!(await page.getByRole('button', { name: '打开管理员登录' }).isVisible())) throw new Error('Mobile routing editor does not show the administrator gate')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(outputDir, `workspace-routing-${viewport.name}.png`), fullPage: true })
    }

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      workspace: Math.round(document.querySelector('.research-workspace').getBoundingClientRect().width),
      overflowing: [...document.querySelectorAll('body *')].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((element) => `${element.tagName.toLowerCase()}.${element.className.baseVal ?? element.className}`),
      footer: (() => {
        const brand = document.querySelector('.footer-brand').getBoundingClientRect()
        const tagline = document.querySelector('.footer-tagline').getBoundingClientRect()
        const pulse = document.querySelector('.footer-pulse').getBoundingClientRect()
        return { brandRight: brand.right, taglineLeft: tagline.left, brandBottom: brand.bottom, taglineTop: tagline.top, pulseRight: pulse.right }
      })(),
    }))
    if (layout.document > layout.viewport + 1) throw new Error(`Horizontal overflow: ${JSON.stringify(layout)}`)
    if (layout.footer.pulseRight > layout.viewport || (layout.footer.taglineTop < layout.footer.brandBottom && layout.footer.taglineLeft < layout.footer.brandRight - 1)) {
      throw new Error(`Footer items overlap or overflow: ${JSON.stringify(layout.footer)}`)
    }
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join('; ')}`)
    console.log(`${viewport.name}: ${JSON.stringify(layout)}`)
    await page.close()
  }
} finally {
  await browser.close()
}
