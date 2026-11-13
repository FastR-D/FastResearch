// Workspace behavior and visual regression checks. Product APIs use deterministic
// fixtures here; real Key login is covered by activity-browser.mjs and OIDC by Go.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const origin = process.env.FASTRESEARCH_CHECK_URL ?? 'http://127.0.0.1:18789'
const output = path.resolve(process.env.FASTRESEARCH_CHECK_OUTPUT ?? 'test-results/workspace-refactor')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? '/usr/bin/google-chrome', headless: true })
const errors = []
const longText = '科研项目与协作进展'.repeat(15)
const today = { received: true, date: '2026-11-12', progress: { total: 3, completed: 1, inProgress: 1, planned: 1, skipped: 0 }, items: ['satisfied', 'in_progress', 'planned'].map((status, i) => ({ id: `today-${i}`, title: `今日任务 ${i + 1} ${longText}`, status, minimumAction: '阅读并记录研究发现', targetMinutes: 30 })) }
const items = Array.from({ length: 20 }, (_, i) => ({ id: `paper-${i}`, title: `论文 ${i + 1} ${longText}`, summary: '研究摘要与关键发现', url: 'https://example.test/' + 'paper'.repeat(50), authors: longText, venue: '研究会议', direction: '安全', receivedAt: '2026-11-12T00:00:00Z' }))
try {
  for (const colorScheme of ['light', 'dark']) for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ colorScheme, viewport: { width, height: 960 }, isMobile: width < 768, hasTouch: width < 768 })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    let roster = { directions: [{ name: '原方向', keywords: ['Agent'], owners: [{ name: '研究员', feishu_open_id: 'ou_test' }] }] }
    let revision = 'v1'
    let saved = null
    let emptyTeam = false
    let signedIn = true
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let json
      switch (url.pathname) {
        case '/api/auth/fastcas/available': json = { enabled: true, login_enabled: true, legacy_key_enabled: true }; break
        case '/api/content/me':
          if (!signedIn) return route.fulfill({ status: 401, json: { error: '请先登录' } })
          json = { person: '测试管理员', keyId: 'key-1', accountId: 'account-1', role: 'admin', expiresAt: 9999999999999, insightItems: items }; break
        case '/api/admin/me': json = { username: '测试管理员', expiresAt: 9999999999999 }; break
        case '/api/admin/keys': json = { keys: Array.from({ length: 60 }, (_, i) => ({ id: `key-${i}`, person: `研究员 ${i} ${longText}` })) }; break
        case '/api/auth/fastcas/status': json = { role: 'admin' }; break
        case '/api/workspace/apps': json = { apps: ['fast-news', 'fast-read', 'fast-write', 'fast-ppt', 'fast-lab', 'planner'].map(id => ({ id, name: id === 'planner' ? '任务规划器' : id, configured: id !== 'fast-lab', auth: 'cas', capabilities: id === 'planner' ? ['activity','tasks'] : ['fast-news','fast-read','fast-write'].includes(id) ? ['activity'] : [], launchPath: `/api/workspace/apps/${id}/launch` })) }; break
        case '/api/workflow/team': json = { members: emptyTeam ? [] : [{ keyId: 'key-1', person: '测试管理员', workflow: { doneCount: 1, total: 3, tasks: ['done', 'active', 'pending'].map((status, i) => ({ id: String(i), title: longText, status })) }, apps: { planner: { accountState: 'active', tasks: today } } }] }; break
        case '/api/admin/fastinsight/roster':
          if (route.request().method() === 'PUT') {
            saved = route.request().postDataJSON()
            assert.equal(saved.revision, revision)
            roster = saved.roster
            revision = 'v2'
          }
          json = { roster, revision, file: 'colleagues.yaml' }; break
        default:
          if (url.pathname.endsWith('/activity')) json = { tasks: url.pathname.includes('/planner/') ? today : undefined, appId: url.pathname.split('/')[4], accountState: 'active', metrics: [{ id: 'updates', label: '未读动态', value: 3 }], items: [{ id: 'update', title: longText, description: longText, kind: 'comment', path: 'https://example.test/update' }] }
          else throw new Error(`Unexpected fixture request: ${route.request().method()} ${url.pathname}`)
      }
      await route.fulfill({ json })
    })
    const assertLayout = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${colorScheme}/${width}: ${page.url()}`)
      assert.equal(await page.locator('h1').count(), 1)
      if (!new URL(page.url()).searchParams.has('view')) {
        const heading = await page.locator('h1').boundingBox()
        const action = await page.getByRole('button', { name: /使用 CAS 进入|打开 Fast|正在读取/ }).boundingBox()
        assert.ok(action.x >= heading.x + heading.width - 1, 'launch action must sit beside the title')
        assert.ok(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2) <= 1, 'title/action should align vertically')
      }
      assert.equal(await page.locator('footer').count(), 0)
      const layout = await page.evaluate(() => {
        const sidebar = document.getElementById('workspace-sidebar')
        const main = document.getElementById('workspace-content')
        const header = document.querySelector('header')
        const firstNav = sidebar.querySelector('button')
        return { sidebarTop: sidebar.getBoundingClientRect().top, sidebarBottom: sidebar.getBoundingClientRect().bottom, sidebarHeight: sidebar.clientHeight, viewport: innerHeight, headerBottom: header.getBoundingClientRect().bottom, mainBottom: main.getBoundingClientRect().bottom, documentHeight: document.documentElement.scrollHeight, rowHeight: firstNav.getBoundingClientRect().height, navFont: getComputedStyle(firstNav.querySelector('span')).fontSize, mainFont: getComputedStyle(main).fontSize }
      })
      assert.equal(layout.mainFont, '14px')
      assert.ok(Math.abs(layout.mainBottom - layout.viewport) <= 1)
      assert.ok(layout.documentHeight <= layout.viewport + 1)
      if (width >= 768) {
        assert.ok(Math.abs(layout.sidebarTop - layout.headerBottom) <= 1)
        assert.ok(Math.abs(layout.sidebarBottom - layout.viewport) <= 1)
        assert.ok(layout.rowHeight >= 44)
        assert.equal(layout.navFont, '14px')
      }
    }
    const nav = async label => {
      if (width < 768 && await page.getByRole('button', { name: '工具导航', exact: true }).getAttribute('aria-expanded') === 'false') await page.getByRole('button', { name: '工具导航', exact: true }).click()
      await page.locator('#workspace-sidebar').getByRole('button', { name: label, exact: false }).click()
    }
    await page.goto(origin + '/workspace?tool=fast-news', { waitUntil: 'networkidle' })
    await page.getByRole('region', { name: 'FastNews 个人动态', exact: true }).getByText(longText, { exact: true }).first().waitFor()
    await assertLayout()
    const metric = page.getByRole('region', { name: 'FastNews 个人动态', exact: true }).locator('dl > div').first()
    const metricStyle = await metric.evaluate(el => {
      const label = el.querySelector('dt'), number = el.querySelector('dd')
      return { label: label.getBoundingClientRect().toJSON(), number: number.getBoundingClientRect().toJSON(), fontSize: parseFloat(getComputedStyle(number).fontSize), weight: Number(getComputedStyle(number).fontWeight) }
    })
    assert.ok(metricStyle.number.x > metricStyle.label.x)
    assert.ok(Math.abs(metricStyle.number.y + metricStyle.number.height/2 - metricStyle.label.y - metricStyle.label.height/2) < 1)
    assert.ok(metricStyle.fontSize >= 30 && metricStyle.weight >= 700)
    assert.equal(await page.getByText('从这里开始', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: '了解 FastNews', exact: true }).count(), 0)
    assert.equal(await page.locator('#workspace-content ol').count(), 0)
    assert.equal(await page.getByRole('button', { name: '使用 CAS 进入', exact: true }).isEnabled(), true)
    assert.equal(await page.locator('link[rel=stylesheet]').evaluateAll(links => links.some(link => link.href.includes('PromoPage'))), false)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-tool.png`), fullPage: true })
    for (const name of ['FastRead', 'FastWrite', 'FastPPT', 'FastLab']) {
      await nav(name)
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor()
      await assertLayout()
    }
    assert.equal(await page.getByRole('button', { name: '使用 CAS 进入', exact: true }).isDisabled(), true)
    assert.equal(await page.getByText('从这里开始', { exact: true }).count(), 1)
    assert.equal(await page.getByRole('link', { name: '了解 FastLab', exact: true }).count(), 1)
    await nav('今日任务')
    await page.getByRole('button', { name: '打开 任务规划器', exact: true }).waitFor()
    await page.getByRole('progressbar').waitFor()
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), '33')
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-today.png`), fullPage: true })
    await nav('FastInsight 信箱')
    await page.getByRole('navigation', { name: '信箱条目' }).getByRole('button').nth(1).click()
    assert.ok((await page.locator('#insight-detail h3').first().innerText()).startsWith('论文 2 '))
    assert.ok(await page.evaluate(() => localStorage.getItem('fastresearch-insight-read:key-1')?.includes('paper-1')))
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-insight.png`), fullPage: true })
    await nav('团队进度')
    await page.getByRole('progressbar').waitFor()
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-team.png`), fullPage: true })
    await page.goBack()
    await page.getByRole('navigation', { name: '信箱条目' }).waitFor()
    await nav('论文分发设置')
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('研究方向', { exact: true }).fill('新方向')
    const modalHeaderHeight = await dialog.locator(':scope > .fastui-panel-header').evaluate(el => el.getBoundingClientRect().height)
    assert.ok(modalHeaderHeight <= (width < 768 ? 58 : 42), `modal header is too tall: ${modalHeaderHeight}`)
    // The direction name previously formed its React key and lost focus on edits.
    assert.equal(await dialog.getByLabel('研究方向', { exact: true }).evaluate(el => el === document.activeElement), true)
    await dialog.getByLabel('匹配关键词', { exact: false }).fill('Agent\nSecurity')
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('FastInsight分发设置已保存', { exact: true }).waitFor()
    assert.equal(saved.roster.directions[0].name, '新方向')
    assert.deepEqual(saved.roster.directions[0].keywords, ['Agent', 'Security'])
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-roster.png`) })
    await page.keyboard.press('Escape')
    if (width < 768 && await page.getByRole('button', { name: '工具导航', exact: true }).getAttribute('aria-expanded') === 'false') await page.getByRole('button', { name: '工具导航', exact: true }).click()
    await page.getByRole('button', { name: '管理员登录', exact: true }).click()
    await dialog.getByText('研究员 59', { exact: false }).waitFor()
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-admin.png`) })
    await page.keyboard.press('Escape')
    emptyTeam = true
    await page.goto(origin + '/workspace?view=team', { waitUntil: 'networkidle' })
    await page.getByText('暂无团队任务数据', { exact: false }).waitFor()
    signedIn = false
    await page.goto(origin + '/workspace?tool=fast-news', { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: '了解 FastNews', exact: true }).waitFor()
    assert.equal(await page.getByText('从这里开始', { exact: true }).count(), 1)
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-guest.png`), fullPage: true })
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Workspace checks passed: 4 widths × 2 themes, tool navigation/history, tasks, mailbox/read state, team/empty state, long admin list, roster editing and revision save, full-height sidebar/scrolling, comfortable spacing, compact modal headers, member/deployment-specific content')
} finally { await browser.close() }
