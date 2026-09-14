import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const executablePath = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((candidate) => existsSync(candidate))

if (!executablePath) throw new Error('未找到 Edge')

const outputDir = path.resolve('test-results')
mkdirSync(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const shots = [
  { name: 'fastresearch-dark-green', url: 'http://127.0.0.1:5173', width: 1440, height: 900 },
  { name: 'fastnews-dark-green', url: 'http://127.0.0.1:4173', width: 1440, height: 900 },
]

try {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      colorScheme: 'dark',
    })
    await context.addInitScript(() => {
      localStorage.setItem('fastresearch-theme', 'dark')
      localStorage.setItem('fastnews.theme', 'dark')
      document.documentElement.classList.add('dark')
    })
    const page = await context.newPage()
    await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(500)
    const out = path.join(outputDir, `${shot.name}.png`)
    await page.screenshot({ path: out, fullPage: true })
    const bg = await page.evaluate(() => {
      const body = getComputedStyle(document.body).backgroundColor
      const html = getComputedStyle(document.documentElement).backgroundColor
      const app = getComputedStyle(document.querySelector('.tech-app, .app-shell, body')).backgroundColor
      return { htmlClass: document.documentElement.className, html, body, app }
    })
    console.log(JSON.stringify({ name: shot.name, out, bg }))
    await context.close()
  }
} finally {
  await browser.close()
}
