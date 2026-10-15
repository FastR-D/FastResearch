// Captures the desensitized promo screenshots (public/promo/*.webp) from a
// scratch FastResearch instance. See docs/FASTRESEARCH-PROMO-PAGE.md.
//
// Usage:
//   1. FASTRESEARCH_DATA_DIR=<scratch-dir> PORT=8790 node server/index.mjs
//   2. VITE_API_URL=http://127.0.0.1:8790 npx vite --port 5175 --strictPort
//   3. node scripts/promo-screenshot.mjs
//
// The script seeds one demo member ("示例研究员"), a standard workflow with the
// first stage completed, and three demo insight cards built from well-known
// public papers. All data is demo data and the promo page labels it as such.

import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const API_BASE = process.env.PROMO_API_URL ?? 'http://127.0.0.1:8790'
const APP_BASE = process.env.PROMO_APP_URL ?? 'http://127.0.0.1:5175/workspace'
const outputDir = path.resolve('public/promo')
const scratchDir = path.resolve('.promo-tmp')
const DEMO_PERSON = '示例研究员'

function envFileValue(name) {
  for (const file of ['.env', '.env.local']) {
    try {
      const text = readFileSync(path.resolve(file), 'utf8')
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#') || !line.startsWith(`${name}=`)) continue
        return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '')
      }
    } catch {
      // optional env file
    }
  }
  return ''
}

async function api(pathname, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status}: ${payload.error ?? 'unknown error'}`)
  return payload
}

const DEMO_INSIGHTS = [
  {
    title: 'Attention Is All You Need',
    url: 'https://arxiv.org/abs/1706.03762',
    authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar 等',
    venue: 'NeurIPS 2017',
    direction: '序列建模',
    summary: '提出完全基于注意力机制的 Transformer 结构，不再依赖循环或卷积。\n\n趋势：注意力结构已成为后续大量模型的基础组件，值得关注其在长序列与多模态场景下的新进展。',
  },
  {
    title: 'Deep Residual Learning for Image Recognition',
    url: 'https://arxiv.org/abs/1512.03385',
    authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun',
    venue: 'CVPR 2016',
    direction: '视觉识别',
    summary: '通过残差连接缓解深层网络训练困难的问题，使更深的网络能够稳定收敛。\n\n趋势：残差设计被广泛借鉴，是理解现代深层网络结构的关键线索。',
  },
  {
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    url: 'https://arxiv.org/abs/1810.04805',
    authors: 'Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova',
    venue: 'NAACL 2019',
    direction: '预训练语言模型',
    summary: '以双向 Transformer 进行预训练，再针对下游任务微调，显著提升多项语言理解任务表现。\n\n趋势：预训练加微调的范式延续至今，建议跟踪其向更少标注数据方向的发展。',
  },
]

async function seedDemoData() {
  const adminUser = envFileValue('ADMIN_USERNAME') || 'admin'
  const adminPass = envFileValue('ADMIN_PASSWORD')
  const ingestKey = envFileValue('FASTINSIGHT_INGEST_KEY')
  if (!adminPass || !ingestKey) throw new Error('缺少 ADMIN_PASSWORD / FASTINSIGHT_INGEST_KEY,无法在临时数据目录中准备演示数据。')

  const admin = await api('/api/admin/login', { method: 'POST', body: { username: adminUser, password: adminPass } })

  const existing = await api('/api/admin/keys', { token: admin.session })
  const stale = existing.keys.filter((item) => item.person === DEMO_PERSON && item.active)
  for (const item of stale) await api(`/api/admin/keys/${item.id}`, { method: 'DELETE', token: admin.session })

  const created = await api('/api/admin/keys', { method: 'POST', body: { person: DEMO_PERSON }, token: admin.session })
  const key = created.key

  for (const item of DEMO_INSIGHTS) {
    await api('/api/insight/publish', { method: 'POST', body: { person: DEMO_PERSON, item }, headers: { 'x-fastinsight-key': ingestKey } })
  }

  const member = await api('/api/content/unlock', { method: 'POST', body: { key } })
  const workflow = await api('/api/workflow', { method: 'POST', body: { default: true }, token: member.session })
  await api('/api/workflow/complete', { method: 'POST', body: { taskId: workflow.workflow.tasks[0].id }, token: member.session })

  return key
}

async function toWebp(page, pngPath, webpPath, quality) {
  const dataUrl = `data:image/png;base64,${readFileSync(pngPath).toString('base64')}`
  const encoded = await page.evaluate(async ({ dataUrl, quality }) => {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return canvas.toDataURL('image/webp', quality).split(',')[1]
  }, { dataUrl, quality })
  writeFileSync(webpPath, Buffer.from(encoded, 'base64'))
}

async function main() {
  const executablePath = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate))
  if (!executablePath) throw new Error('未找到 Edge,请通过 EDGE_PATH 指定浏览器路径。')

  mkdirSync(outputDir, { recursive: true })
  mkdirSync(scratchDir, { recursive: true })
  const key = await seedDemoData()

  const browser = await chromium.launch({ executablePath, headless: true })
  const shots = []

  const capture = async (page, name, { element, quality = 0.9 } = {}) => {
    const pngPath = path.join(scratchDir, `${name}.png`)
    const webpPath = path.join(outputDir, `${name}.webp`)
    if (element) await page.locator(element).screenshot({ path: pngPath })
    else await page.screenshot({ path: pngPath })
    await toWebp(page, pngPath, webpPath, quality)
    const png = readFileSync(pngPath).length
    const webp = readFileSync(webpPath).length
    shots.push({ name, png, webp })
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' })
    const page = await context.newPage()
    await page.goto(APP_BASE, { waitUntil: 'networkidle' })

    // Unlock with the demo key through the real dialog so the app stores its own session.
    await page.getByRole('button', { name: '验证个人 Key' }).first().click()
    await page.getByRole('textbox', { name: '个人科研 Key (PERSONAL KEY)' }).fill(key)
    await page.getByRole('button', { name: '验证并进入工作台' }).click()
    await page.waitForTimeout(600)

    // Reload so the workflow seeded through the API renders with one completed stage.
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    const scrollTo = async (target, offset) => {
      await page.evaluate(({ target, offset }) => {
        const element = document.querySelector(target)
        if (!element) throw new Error(`missing ${target}`)
        window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - offset)
      }, { target, offset })
      await page.waitForTimeout(400)
    }

    await scrollTo('.research-workspace', 88)
    await capture(page, 'hero-desktop', { element: '.research-workspace', quality: 0.88 })

    await capture(page, 'workflow-board', { element: '.workflow-board', quality: 0.9 })

    for (const [moduleName, name] of [['FastNews', 'module-news'], ['FastRead', 'module-read'], ['FastWrite', 'module-write']]) {
      await page.locator('.module-switcher').getByRole('button', { name: moduleName, exact: true }).click()
      await page.waitForTimeout(350)
      await capture(page, name, { element: '.module-showcase', quality: 0.9 })
    }

    await page.getByRole('button', { name: /FastInsight 信箱/ }).click()
    await page.locator('.insight-mailbox').waitFor()
    await page.waitForTimeout(600)
    await capture(page, 'insight', { element: '.insight-mailbox', quality: 0.9 })

    await page.getByRole('button', { name: /团队任务进度/ }).click()
    await page.locator('.team-progress-panel').waitFor()
    await page.waitForTimeout(600)
    await capture(page, 'team', { element: '.team-progress-panel', quality: 0.9 })
    await context.close()

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })
    const mobilePage = await mobile.newPage()
    await mobilePage.goto(APP_BASE, { waitUntil: 'networkidle' })
    await mobilePage.getByRole('button', { name: '验证个人 Key' }).first().click()
    await mobilePage.getByRole('textbox', { name: '个人科研 Key (PERSONAL KEY)' }).fill(key)
    await mobilePage.getByRole('button', { name: '验证并进入工作台' }).click()
    await mobilePage.waitForTimeout(600)
    await mobilePage.reload({ waitUntil: 'networkidle' })
    await mobilePage.waitForTimeout(800)
    await mobilePage.evaluate(() => {
      const element = document.querySelector('.research-workspace')
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 72)
    })
    await mobilePage.waitForTimeout(400)
    await capture(mobilePage, 'hero-mobile', { element: '.research-workspace', quality: 0.88 })
    await mobile.close()
  } finally {
    await browser.close()
    for (const file of ['hero-desktop', 'hero-mobile', 'workflow-board', 'module-news', 'module-read', 'module-write', 'insight', 'team']) {
      rmSync(path.join(scratchDir, `${file}.png`), { force: true })
    }
  }

  for (const shot of shots) console.log(`${shot.name}: png ${(shot.png / 1024).toFixed(0)}KB -> webp ${(shot.webp / 1024).toFixed(0)}KB`)
}

await main()
