// Chinese full-screen product stories and application route acceptance.
// EDGE_PATH=/path/to/chromium PROMO_CHECK_URL=http://127.0.0.1:8787/ npm run test:promo
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const executablePath = [process.env.EDGE_PATH, '/usr/bin/google-chrome',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(candidate => candidate && existsSync(candidate))
if (!executablePath) throw new Error('Set EDGE_PATH to an installed Chromium browser')
const origin = new URL(process.env.PROMO_CHECK_URL ?? 'http://127.0.0.1:5173/')
origin.pathname = origin.pathname.replace(/intro\/?$/, '')
const workspaceUrl = new URL('workspace', origin)
const output = path.resolve(process.env.PROMO_CHECK_OUTPUT ?? 'test-results/promo')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const apps = ['news', 'read', 'write', 'ppt', 'lab', 'task', 'insight', 'figure', 'cas', 'ui']
const results = []
const errors = []
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.story-scroll').scrollWidth <= innerWidth), true)
async function chapter(page, index) {
  await page.locator('.story-pager a').nth(index).click()
  await page.waitForFunction(index => document.querySelector(`.story-pager a:nth-child(${index + 1})`)?.getAttribute('aria-current') === 'step' && document.querySelector('.story-page').dataset.moving === 'false', index)
}

try {
  // Old saved English preferences must have no effect on this Chinese-only UI.
  for (const width of [320, 390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await context.addInitScript(() => localStorage.setItem('fastresearch-locale', 'en-US'))
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      // The existing workspace uses a 401 response to detect a signed-out visitor.
      const guestSessionProbe = message.location().url === new URL('api/content/me', origin).href
        && message.text() === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)'
      if (message.type() === 'error' && !guestSessionProbe) errors.push(message.text())
    })
    await page.goto(origin.href, { waitUntil: 'networkidle' })
    assert.equal(new URL(page.url()).pathname, origin.pathname)
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
    assert.equal(await page.locator('h1').count(), 1)
    assert.equal(await page.locator('.story-screen').count(), 6)
    assert.equal(await page.locator('.promo-lang').count(), 0)
    assert.match(await page.locator('h1').innerText(), /连成下一次突破/)
    await noOverflow(page)
    const geometry = await page.locator('.story-nav').evaluate(el => ({ width: el.clientWidth, viewport: innerWidth }))
    assert.equal(geometry.width, width)
    assert.ok(await page.locator('.story-nav').evaluate(el => el.clientHeight <= 56 && getComputedStyle(el).borderRadius === '0px' && getComputedStyle(el).boxShadow === 'none'))
    for (let index = 0; index < 6; index++) {
      await chapter(page, index)
      await noOverflow(page)
      if (width >= 1024) assert.equal(await page.locator(`#chapter-${index}`).evaluate(el => Math.abs(el.clientHeight - document.querySelector('.story-scroll').clientHeight) <= 1), true, `Desktop chapter ${index} is a viewport`)
      const image = page.locator(`#chapter-${index} img`)
      if (await image.count()) await image.evaluate(img => img.decode())
    }
    assert.equal(await page.locator('.story-directory a').count(), 10)
    for (const id of apps) assert.equal(await page.locator(`.story-directory a[href="${new URL(`intro/${id}`, origin).pathname}"]`).count(), 1)
    const menu = page.getByRole('button', { name: '打开产品菜单' })
    await menu.click()
    await page.locator('#story-menu').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#story-menu').isVisible(), false)
    assert.equal(await menu.evaluate(el => document.activeElement === el), true)
    await chapter(page, 0)
    // A real wheel movement advances one complete screen, regardless of delta.
    await page.locator('.story-scroll').hover({ position: { x: width / 2, y: 500 } })
    await page.mouse.wheel(0, 900)
    await page.waitForFunction(() => document.querySelector('.story-page').dataset.activeScreen === '1' && document.querySelector('.story-page').dataset.moving === 'false')
    assert.equal(await page.locator('.story-scroll').evaluate(el => el.scrollTop), await page.locator('.story-scroll').evaluate(el => el.clientHeight))
    await chapter(page, 0)
    if ([390, 1440].includes(width)) {
      await page.screenshot({ path: path.join(output, `home-${width}.png`) })
      await chapter(page, 2)
      await page.screenshot({ path: path.join(output, `read-chapter-${width}.png`) })
      await chapter(page, 5)
      await page.screenshot({ path: path.join(output, `directory-${width}.png`) })
    }
    // An unrelated stale cookie must not redirect the public product homepage.
    await context.addCookies([{ name: 'fr_session', value: 'non-sensitive-fixture', url: origin.origin }])
    await page.goto(origin.href, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('.story-page').isVisible(), true)
    await context.clearCookies()
    await page.goto(new URL('workspace', origin).href, { waitUntil: 'networkidle' })
    assert.equal(await page.locator('#workspace-content').isVisible(), true)
    assert.equal(await page.locator('footer').count(), 0)
    assert.equal(await page.getByRole('button', { name: '切换语言' }).count(), 0)
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    results.push({ page: 'home/workspace', width, language: 'Chinese', chapters: 6, overflow: false, menu: 'Escape/focus', wheel: 'one gesture / one screen', footer: 'removed' })
    await context.close()
    console.log(`ok home + workspace / ${width}px`)
  }

  for (const width of [390, 1440]) for (const id of apps) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL(`intro/${id}`, origin).href, { waitUntil: 'networkidle' })
    const chapterCount = id === 'ppt' ? 5 : 4
    assert.equal(await page.locator('.story-screen').count(), chapterCount)
    assert.equal(await page.locator('h1').count(), 1)
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN')
    for (let index = 0; index < chapterCount; index++) { await chapter(page, index); await noOverflow(page) }
    if (['read', 'ppt'].includes(id)) {
      await chapter(page, 0)
      await page.screenshot({ path: path.join(output, `${id}-${width}.png`) })
    }
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.locator('.story-page').isVisible(), true)
    results.push({ page: `/intro/${id}`, width, chapters: chapterCount, overflow: false })
    await context.close()
    console.log(`ok /intro/${id} / ${width}px`)
  }

  const page = await browser.newPage()
  await page.goto(new URL('intro', origin).href, { waitUntil: 'networkidle' })
  assert.equal(new URL(page.url()).pathname, origin.pathname)
  await page.goto(new URL('fastppt/', origin).href, { waitUntil: 'networkidle' })
  assert.equal(new URL(page.url()).pathname, new URL('intro/ppt', origin).pathname)
  await page.goto(new URL('?fastcas=failed', origin).href, { waitUntil: 'networkidle' })
  assert.equal(new URL(page.url()).pathname, workspaceUrl.pathname)
  for (const tool of ['fast-read', 'fast-write', 'fast-ppt', 'fast-lab']) {
    await page.goto(`${workspaceUrl}?tool=${tool}`, { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('navigation', { name: '科研工具', exact: true }).locator('[aria-current=page]').innerText().then(text => text.includes({ 'fast-read': 'FastRead', 'fast-write': 'FastWrite', 'fast-ppt': 'FastPPT', 'fast-lab': 'FastLab' }[tool])), true)
  }
  await page.goto(`${workspaceUrl}?view=insight`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('region', { name: 'FASTINSIGHT · 学术文献速递', exact: true }).isVisible(), true)
  await page.goto(new URL('intro/unknown', origin).href, { waitUntil: 'networkidle' })
  assert.equal(await page.locator('.route-not-found').isVisible(), true)
  await page.close()

  const reduced = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'dark' })
  const reducedPage = await reduced.newPage()
  await reducedPage.goto(origin.href, { waitUntil: 'networkidle' })
  assert.equal(await reducedPage.locator('.story-page').getAttribute('data-fastui-theme'), 'light')
  assert.notEqual(await reducedPage.evaluate(() => localStorage.getItem('fastresearch-theme')), 'light')
  await reducedPage.locator('.story-pager a').nth(1).click()
  assert.equal(await reducedPage.locator('.story-page').getAttribute('data-moving'), 'false')
  await chapter(reducedPage, 3)
  await reduced.close()

  const offline = await browser.newContext()
  const offlinePage = await offline.newPage()
  await offlinePage.route('**/promo/*.webp*', route => route.abort())
  await offlinePage.goto(new URL('intro/read', origin).href, { waitUntil: 'networkidle' })
  await chapter(offlinePage, 1)
  await offlinePage.locator('.story-media.is-error').waitFor()
  assert.match(await offlinePage.locator('.story-image-fallback').innerText(), /图片暂时无法加载/)
  assert.equal(await offlinePage.locator('#chapter-1 .story-button').isVisible(), true)
  await offline.close()
  assert.deepEqual(errors, [])
  console.log('ok routes, legacy links, tool deep links, Chinese-only UI, reduced motion, scoped theme, image fallback')
} finally {
  await browser.close()
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
}
console.log(`Passed ${results.length} page/viewport combinations. Evidence: ${output}`)
