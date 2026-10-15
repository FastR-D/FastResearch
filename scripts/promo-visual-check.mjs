// Acceptance checks for the /intro promo page (docs/FASTRESEARCH-PROMO-PAGE.md).
//
// Usage: start the app (vite dev or preview), then:
//   PROMO_CHECK_URL=http://127.0.0.1:5173/intro node scripts/promo-visual-check.mjs
//
// Covers: responsive widths without horizontal scroll, anchors, workspace CTAs,
// mobile menu, language switch + persistence, reduced motion, image fallback,
// a single H1, and no console errors.

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const executablePath = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Edge is required for the promo visual check')

const baseUrl = process.env.PROMO_CHECK_URL ?? 'http://127.0.0.1:5173/intro'
const rootUrl = new URL(baseUrl)
rootUrl.pathname = rootUrl.pathname.replace(/intro\/?$/, '')
const workspaceUrl = new URL('workspace', rootUrl)
const outputDir = path.resolve(process.env.PROMO_CHECK_OUTPUT ?? 'test-results/promo')
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
let failures = 0

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`ok   ${label}`)
  } else {
    failures += 1
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

try {
  for (const viewport of [
    { name: 'w320', width: 320, height: 700 },
    { name: 'w390', width: 390, height: 844 },
    { name: 'w768', width: 768, height: 900 },
    { name: 'w1024', width: 1024, height: 900 },
    { name: 'w1440', width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: 'light' })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => consoleErrors.push(error.message))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)

    const layout = await page.evaluate((workspacePath) => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      h1: document.querySelectorAll('h1').length,
      lang: document.documentElement.lang,
      sections: ['workflow', 'modules', 'insight', 'team', 'access'].filter((id) => document.getElementById(id)).length,
      heroVisible: (() => {
        const hero = document.querySelector('.promo-hero')
        return hero ? hero.getBoundingClientRect().bottom : -1
      })(),
      nextSectionPeek: (() => {
        const next = document.getElementById('workflow')
        return next ? Math.round(next.getBoundingClientRect().top) : -1
      })(),
      ctaLinks: [...document.querySelectorAll('a[href]')].filter((link) => new URL(link.href).pathname === workspacePath).length,
    }), workspaceUrl.pathname)

    check(`${viewport.name}: no horizontal scroll`, layout.scroll <= layout.client + 1, `scroll ${layout.scroll} > client ${layout.client}`)
    check(`${viewport.name}: exactly one h1`, layout.h1 === 1, `found ${layout.h1}`)
    check(`${viewport.name}: all sections present`, layout.sections === 5, `found ${layout.sections}`)
    check(`${viewport.name}: html lang set`, layout.lang === 'zh-CN' || layout.lang === 'en-US', layout.lang)
    check(`${viewport.name}: hero is a band with next section visible`, layout.nextSectionPeek <= viewport.height, `next section top ${layout.nextSectionPeek} >= viewport ${viewport.height}`)
    check(`${viewport.name}: workspace CTAs present`, layout.ctaLinks >= 2, `found ${layout.ctaLinks}`)

    // Anchors all resolve to real sections.
    for (const id of ['workflow', 'modules', 'insight', 'team']) {
      const link = page.locator(`.promo-nav-links a[href="#${id}"], .promo-menu a[href="#${id}"]`).first()
      check(`${viewport.name}: anchor #${id} exists`, await link.count() > 0)
    }

    if (viewport.name === 'w390') {
      await page.getByRole('button', { name: '打开导航菜单' }).click()
      const menuVisible = await page.locator('#promo-menu').isVisible()
      check('w390: mobile menu opens', menuVisible)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
      check('w390: Escape closes mobile menu', !(await page.locator('#promo-menu').isVisible()))

      const desktopLinksVisible = await page.locator('.promo-nav-links').isVisible()
      check('w390: desktop nav links hidden', !desktopLinksVisible)

      await page.screenshot({ path: path.join(outputDir, 'promo-mobile.png'), fullPage: false })
    }

    if (viewport.name === 'w1440') {
      await page.screenshot({ path: path.join(outputDir, 'promo-desktop.png'), fullPage: false })
      // Language switch updates copy and persists for the workspace.
      await page.locator('.promo-lang').click()
      await page.waitForTimeout(250)
      const enHeading = await page.locator('h1').textContent()
      check('w1440: language switch updates copy', /Every step of research/.test(enHeading ?? ''), enHeading ?? '')
      const stored = await page.evaluate(() => localStorage.getItem('fastresearch-locale'))
      check('w1440: locale persisted for workspace', stored === 'en-US', String(stored))
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(300)
      check('w1440: locale kept after reload', /Every step of research/.test((await page.locator('h1').textContent()) ?? ''))
      await page.locator('.promo-lang').click()
      await page.waitForTimeout(200)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(outputDir, 'promo-footer.png'), fullPage: false })
    }

    check(`${viewport.name}: no console errors`, consoleErrors.length === 0, consoleErrors.join('; '))
    await context.close()
  }

  const routePage = await browser.newPage()
  await routePage.goto(rootUrl.toString(), { waitUntil: 'networkidle' })
  check('root: defaults to /intro', routePage.url() === baseUrl && await routePage.locator('.promo-hero').isVisible(), routePage.url())
  await routePage.locator('.promo-hero-actions .promo-btn--primary').click()
  await routePage.locator('.research-workspace').waitFor()
  check('CTA: opens /workspace', new URL(routePage.url()).pathname === workspaceUrl.pathname, routePage.url())
  await routePage.reload({ waitUntil: 'networkidle' })
  check('workspace: direct refresh keeps the workspace', await routePage.locator('.research-workspace').isVisible())
  await routePage.goto(new URL('?fastcas=1', rootUrl).toString(), { waitUntil: 'networkidle' })
  check('legacy FastCAS callback: opens workspace', new URL(routePage.url()).pathname === workspaceUrl.pathname, routePage.url())
  await routePage.close()

  // Reduced motion: all revealed content must be visible without scrolling animation.
  const reduced = await browser.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' })
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await reducedPage.waitForTimeout(300)
  const hiddenBlocks = await reducedPage.evaluate(() => [...document.querySelectorAll('.promo-reveal')].filter((el) => getComputedStyle(el).opacity !== '1').length)
  check('reduced motion: no hidden reveal blocks', hiddenBlocks === 0, `${hiddenBlocks} blocks still transparent`)
  await reduced.close()

  // Image failure fallback keeps text and navigation usable.
  const offline = await browser.newContext({ viewport: { width: 1024, height: 900 } })
  const offlinePage = await offline.newPage()
  await offlinePage.route('**/promo/*.webp', (route) => route.abort())
  await offlinePage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  // Scroll through so lazy-loaded figures below the fold are requested too.
  for (let step = 0; step < 12; step += 1) {
    await offlinePage.mouse.wheel(0, 900)
    await offlinePage.waitForTimeout(120)
  }
  await offlinePage.waitForTimeout(800)
  const fallback = await offlinePage.evaluate(() => ({
    figures: document.querySelectorAll('.promo-figure.is-error').length,
    fallbackText: document.body.textContent?.includes('图片暂时无法加载') ?? false,
    h1: document.querySelector('h1')?.textContent ?? '',
  }))
  check('image fallback: broken images show a text state', fallback.figures >= 6 && fallback.fallbackText, JSON.stringify(fallback))
  check('image fallback: headline still rendered', fallback.h1.includes('FastResearch'))
  await offlinePage.screenshot({ path: path.join(outputDir, 'promo-image-fallback.png') })
  await offline.close()
} finally {
  await browser.close()
}

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall promo checks passed')
