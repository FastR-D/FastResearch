// Exercise actual transitions, large deltas, long momentum tails, touch and keyboard.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const origin = process.env.PROMO_CHECK_URL ?? 'http://127.0.0.1:18789/'
const output = path.resolve(process.env.PROMO_CHECK_OUTPUT ?? 'test-results/journey')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? '/usr/bin/google-chrome', headless: true })
const results = []
const errors = []
const settled = (page, index) => page.waitForFunction(index => {
  const story = document.querySelector('.story-page')
  const root = document.querySelector('.story-scroll')
  return story.dataset.activeScreen === String(index) && story.dataset.moving === 'false' && Math.abs(root.scrollTop - root.clientHeight * index) < 1
}, index)
try {
  for (const route of ['', 'intro/read']) for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 390 })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle' })
    await settled(page, 0)
    assert.equal(await page.locator('.node-scene').count(), 0)
    const shape = await page.locator('.journey-track').evaluate(el => {
      const length = el.getTotalLength()
      const points = Array.from({ length: 200 }, (_, i) => el.getPointAtLength(length * i / 199))
      const reversals = points.slice(1, -1).filter((p, i) => Math.sign(p.y - points[i].y) !== Math.sign(points[i + 2].y - p.y)).length
      const box = el.getBBox()
      return { reversals, left: box.x, right: box.x + box.width }
    })
    assert.ok(shape.reversals >= 6, 'The continuous route rises and falls repeatedly')
    assert.ok(shape.left < 0 && shape.right > 1600, 'The route extends beyond both screen edges')
    await page.locator('.story-scroll').hover({ position: { x: width / 2, y: 300 } })
    await page.mouse.wheel(0, 3000)
    await page.waitForFunction(() => document.querySelector('.story-page').dataset.moving === 'true')
    // A continuous momentum tail lasts beyond the screen animation; it must not queue pages.
    await page.evaluate(async () => {
      const root = document.querySelector('.story-scroll')
      for (let i = 0; i < 26; i++) {
        root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 - i * 3, bubbles: true, cancelable: true }))
        await new Promise(resolve => setTimeout(resolve, 65))
      }
    })
    await settled(page, 1)
    await page.screenshot({ path: path.join(output, `${route ? 'read' : 'home'}-${width}-screen-2.png`) })
    await page.waitForTimeout(260)
    await page.mouse.wheel(0, 3000)
    await page.waitForFunction(() => document.querySelector('.story-page').dataset.moving === 'true')
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(output, `${route ? 'read' : 'home'}-${width}-in-motion.png`) })
    await settled(page, 2)
    await page.waitForTimeout(260)
    await page.mouse.wheel(0, -3000)
    await settled(page, 1)
    await page.locator('.story-scroll').focus()
    await page.keyboard.press('PageDown')
    await settled(page, 2)
    await page.keyboard.press('Home')
    await settled(page, 0)
    const count = await page.locator('.story-screen').count()
    await page.keyboard.press('End')
    await settled(page, count - 1)
    await page.waitForTimeout(260)
    await page.mouse.wheel(0, 3000)
    await settled(page, count - 1)
    const zoom = await page.locator('.story-scroll').evaluate(root => {
      const event = new WheelEvent('wheel', { deltaY: 400, ctrlKey: true, bubbles: true, cancelable: true })
      root.dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(zoom, false)
    if (width === 390) {
      await page.keyboard.press('Home')
      await settled(page, 0)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 600 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 490 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 300 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await settled(page, 1)
    }
    results.push({ route: route || '/', width, wheel: 'large delta moves one screen', momentum: 'no queued pages', reverse: 'one screen', keyboard: 'PageDown/Home/End', touch: width === 390, shape })
    await context.close()
    console.log(`ok ${route || '/'} ${width}px: one-screen motion, momentum, reverse, keyboard, boundaries`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
}
console.log(`Passed ${results.length} animated gesture scenarios. Evidence: ${output}`)
