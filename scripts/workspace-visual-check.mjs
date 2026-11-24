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
const team = [
  { keyId: 'key-1', person: '测试管理员', workflow: { doneCount: 1, total: 15, tasks: Array.from({ length: 15 }, (_, i) => ({ id: String(i), title: `我的流程任务 ${i + 1} ${longText}`, status: i === 0 ? 'done' : 'pending' })) }, apps: { planner: { accountState: 'active', tasks: today } } },
  { keyId: 'key-2', person: '成员乙', workflow: { doneCount: 0, total: 1, tasks: [{ id: 'other-task', title: '成员乙的专属任务', status: 'active' }] } },
  ...Array.from({ length: 24 }, (_, i) => ({ keyId: `member-${i}`, person: `研究员 ${i + 1}`, workflow: null })),
]
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
        case '/api/workflow/team': json = { members: emptyTeam ? [] : team }; break
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
        assert.ok(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2) <= 1, 'title and launch action should align vertically')
      }
      assert.equal(await page.locator('footer').count(), 0)
      const layout = await page.evaluate(() => {
        const sidebar = document.getElementById('workspace-sidebar')
        const main = document.getElementById('workspace-content')
        const header = document.querySelector('header')
        const firstNav = sidebar.querySelector('button')
        const controls = [...header.querySelectorAll('.fastui-toolbar > :not(nav), nav > *')].map(el => el.getBoundingClientRect())
        const centered = controls.every(rect => Math.abs(rect.y + rect.height / 2 - controls[0].y - controls[0].height / 2) <= 1)
        return { sidebarTop: sidebar.getBoundingClientRect().top, sidebarBottom: sidebar.getBoundingClientRect().bottom, viewport: innerHeight, headerBottom: header.getBoundingClientRect().bottom, headerFits: centered && controls.every(rect => rect.left >= 0 && rect.right <= innerWidth), mainBottom: main.getBoundingClientRect().bottom, documentHeight: document.documentElement.scrollHeight, rowHeight: firstNav?.getBoundingClientRect().height, navFont: firstNav && getComputedStyle(firstNav.querySelector('span')).fontSize, mainFont: getComputedStyle(main).fontSize }
      })
      assert.ok(layout.headerFits, 'all header controls must fit on a single row')
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
    const header = page.locator('header')
    assert.equal(await header.getByRole('button', { name: 'CAS认证', exact: true }).count(), 1)
    if (width < 768) {
      const menu = header.getByRole('button', { name: '工具导航', exact: true })
      const drawer = page.getByRole('dialog', { name: '工具导航', exact: true })
      const main = page.locator('#workspace-content')
      const before = await main.boundingBox()
      await menu.click()
      await drawer.waitFor()
      await drawer.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)) })
      const panel = await drawer.boundingBox()
      assert.equal(panel.x, 0)
      assert.equal(panel.y, 0)
      assert.equal(panel.height, 960)
      assert.ok(panel.width < width)
      assert.deepEqual(await main.boundingBox(), before)
      assert.equal(await drawer.evaluate(el => el.matches(':modal') && el.contains(document.activeElement)), true)
      await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-drawer.png`) })
      await page.keyboard.press('Escape')
      await drawer.waitFor({ state: 'hidden' })
      assert.equal(await menu.evaluate(el => el === document.activeElement), true)
      await menu.click()
      await page.mouse.click(width - 8, 200)
      await drawer.waitFor({ state: 'hidden' })
      if (colorScheme === 'light' && width === 390) {
        await page.setViewportSize({ width, height: 480 })
        await nav('管理账号')
        await page.getByRole('heading', { name: '管理账号', exact: true, level: 1 }).waitFor()
        await page.goBack()
        await page.getByRole('heading', { name: 'FastNews', exact: true, level: 1 }).waitFor()
        await menu.click()
        await page.setViewportSize({ width: 768, height: 480 })
        await page.locator('aside#workspace-sidebar').waitFor()
        await page.setViewportSize({ width, height: 960 })
        await menu.waitFor()
        assert.equal(await menu.getAttribute('aria-expanded'), 'false')
      }
    }
    const brandRadius = () => page.locator('.story-brand-mark').evaluate(mark => getComputedStyle(mark).borderRadius)
    assert.equal(await brandRadius(), '6px')
    const accountName = page.locator('header strong').getByText('测试管理员', { exact: true })
    assert.ok(await accountName.evaluate(name => Number(getComputedStyle(name).fontWeight) >= 700))
    assert.equal(await accountName.locator('xpath=preceding-sibling::*').innerText(), '测')
    const metric = page.getByRole('region', { name: 'FastNews 个人动态', exact: true }).locator('dl > div').first()
    const metricStyle = await metric.evaluate(el => {
      const label = el.querySelector('dt'), number = el.querySelector('dd')
      return { label: label.getBoundingClientRect().toJSON(), number: number.getBoundingClientRect().toJSON(), fontSize: parseFloat(getComputedStyle(number).fontSize), weight: Number(getComputedStyle(number).fontWeight) }
    })
    assert.ok(metricStyle.number.x > metricStyle.label.x)
    assert.ok(Math.abs(metricStyle.number.y + metricStyle.number.height/2 - metricStyle.label.y - metricStyle.label.height/2) < 1)
    assert.ok(metricStyle.fontSize >= 30 && metricStyle.weight >= 700)
    assert.equal(await page.getByText('从这里开始', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: /了解 Fast/ }).count(), 0)
    assert.equal(await page.locator('header').getByRole('link', { name: 'FastNews', exact: true }).getAttribute('href'), '/intro/news')
    assert.equal(await page.locator('#workspace-content ol').count(), 0)
    assert.equal(await page.getByRole('button', { name: '使用 CAS 进入', exact: true }).isEnabled(), true)
    assert.equal(await page.locator('link[rel=stylesheet]').evaluateAll(links => links.some(link => link.href.includes('PromoPage'))), false)
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-tool.png`), fullPage: true })
    for (const name of ['FastRead', 'FastWrite', 'FastPPT', 'FastLab']) {
      await nav(name)
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor()
      assert.equal(await page.locator('header').getByRole('link', { name, exact: true }).getAttribute('href'), `/intro/${name.slice(4).toLowerCase()}`)
      await assertLayout()
    }
    assert.equal(await page.getByRole('button', { name: '使用 CAS 进入', exact: true }).isDisabled(), true)
    await page.getByText('当前部署尚未配置该工具入口。', { exact: true }).waitFor()
    assert.equal(await page.locator('#workspace-content ul, #workspace-content ol').count(), 0)
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
    if (width < 768) {
      const teamList = page.getByRole('region', { name: '团队进度', exact: true })
      const first = teamList.getByRole('region', { name: '测试管理员', exact: true })
      const second = teamList.getByRole('region', { name: '成员乙', exact: true })
      const last = teamList.getByRole('region', { name: '研究员 24', exact: true })
      await first.getByRole('progressbar').waitFor()
      assert.equal(await teamList.getByRole('heading', { level: 2 }).count(), team.length)
      assert.equal(await teamList.getByRole('navigation', { name: '团队成员' }).count(), 0)
      assert.equal(await teamList.getByRole('button', { name: '下一位成员' }).count(), 0)
      assert.equal(await first.getByText('成员乙的专属任务').count(), 0)
      assert.equal(await second.getByText('成员乙的专属任务').count(), 1)
      const firstCard = await first.boundingBox()
      const secondCard = await second.boundingBox()
      assert.equal(firstCard.x, secondCard.x)
      assert.equal(firstCard.width, secondCard.width)
      assert.ok(secondCard.y >= firstCard.y + firstCard.height)
      await last.scrollIntoViewIfNeeded()
      assert.equal(await last.evaluate(el => el.getBoundingClientRect().top < innerHeight), true)
      await page.locator('#workspace-content').evaluate(el => { el.scrollTop = 0 })
    } else {
      const memberNav = page.getByRole('navigation', { name: '团队成员' })
      const memberDetail = page.locator('#team-member-detail')
      const memberHeading = name => memberDetail.getByRole('heading', { name, level: 2, exact: true })
      await memberHeading('测试管理员').waitFor()
      assert.equal(await memberNav.getByRole('button').count(), team.length)
      assert.equal(await memberDetail.getByRole('progressbar').count(), 1)
      assert.equal(await memberDetail.getByText('成员乙的专属任务').count(), 0)
      assert.ok((await memberNav.boundingBox()).x < (await memberDetail.boundingBox()).x)
      assert.equal(await memberDetail.evaluate(el => el.scrollWidth > el.clientWidth), false)
      const sidebarHeader = await memberNav.locator(':scope > div').first().boundingBox()
      const detailHeader = await memberDetail.locator(':scope > div').first().boundingBox()
      assert.ok(sidebarHeader.height >= 64)
      assert.equal(sidebarHeader.y, detailHeader.y)
      assert.equal(sidebarHeader.height, detailHeader.height)
      await memberDetail.hover()
      await page.mouse.wheel(0, 240)
      await page.waitForFunction(() => document.getElementById('team-member-detail').scrollTop > 0)
      await memberHeading('测试管理员').waitFor()
      await memberDetail.evaluate(el => { el.scrollTop = el.scrollHeight })
      await page.mouse.wheel(0, 220)
      await memberHeading('成员乙').waitFor()
      assert.equal(await memberDetail.getByText('成员乙的专属任务').count(), 1)
      assert.equal(await memberDetail.getByText('我的流程任务', { exact: false }).count(), 0)
      assert.equal(await memberNav.getByRole('button', { name: '成员乙' }).getAttribute('aria-current'), 'true')
      const primaryColor = await accountName.locator('xpath=preceding-sibling::*').evaluate(el => getComputedStyle(el).backgroundColor)
      await page.waitForFunction(color => {
        const active = document.querySelector('button[aria-controls="team-member-detail"][aria-current="true"]')
        return active && getComputedStyle(active).backgroundColor === color
      }, primaryColor)
      await page.mouse.wheel(0, -220)
      await memberHeading('测试管理员').waitFor()
      await memberNav.hover()
      await page.mouse.wheel(0, 220)
      await memberHeading('成员乙').waitFor()
      await page.mouse.wheel(0, -220)
      await memberHeading('测试管理员').waitFor()
      await memberNav.getByRole('button', { name: '研究员 24', exact: true }).click()
      await memberHeading('研究员 24').waitFor()
      await memberDetail.getByRole('button', { name: '上一位成员' }).click()
      await memberHeading('研究员 23').waitFor()
      await memberDetail.getByRole('button', { name: '下一位成员' }).click()
      await memberHeading('研究员 24').waitFor()
      assert.equal(await memberDetail.getByRole('button', { name: '下一位成员' }).isDisabled(), true)
      await memberNav.getByRole('button', { name: '测试管理员', exact: true }).click()
      await memberHeading('测试管理员').waitFor()
    }
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-team.png`), fullPage: true })
    await page.goBack()
    await page.getByRole('navigation', { name: '信箱条目' }).waitFor()
    await nav('论文分发设置')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'routing')
    const routing = page.getByRole('region', { name: '论文分发设置', exact: true })
    await routing.getByLabel('研究方向', { exact: true }).fill('新方向')
    // The direction name previously formed its React key and lost focus on edits.
    assert.equal(await routing.getByLabel('研究方向', { exact: true }).evaluate(el => el === document.activeElement), true)
    await routing.getByLabel('匹配关键词', { exact: false }).fill('Agent\nSecurity')
    await routing.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('FastInsight分发设置已保存', { exact: true }).waitFor()
    assert.equal(saved.roster.directions[0].name, '新方向')
    assert.deepEqual(saved.roster.directions[0].keywords, ['Agent', 'Security'])
    assert.equal(await routing.evaluate(el => el.scrollWidth > el.clientWidth), false)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-roster.png`) })
    await nav('管理账号')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'admin')
    const admin = page.getByRole('region', { name: '管理账号', exact: true })
    await admin.getByText('研究员 59', { exact: false }).waitFor()
    assert.equal(await admin.evaluate(el => el.scrollWidth > el.clientWidth), false)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await assertLayout()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-admin.png`) })
    await page.goBack()
    await routing.getByLabel('研究方向', { exact: true }).waitFor()
    await page.goForward()
    await admin.getByText('研究员 59', { exact: false }).waitFor()
    emptyTeam = true
    await page.goto(origin + '/workspace?view=team', { waitUntil: 'networkidle' })
    await page.getByText('暂无团队任务数据', { exact: false }).waitFor()
    signedIn = false
    await page.goto(origin + '/workspace?view=routing', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '打开管理员登录' }).click()
    const login = await admin.getByRole('link', { name: /FastCAS/ }).getAttribute('href')
    assert.equal(new URL(login, origin).searchParams.get('next'), '/workspace?view=admin')
    await page.goto(origin + '/workspace?tool=fast-news', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '让注意力，落在值得研究的问题上。', exact: true }).waitFor()
    await page.getByText('把学术动态、顶会论文与领域导读放到一处。从一个关键词出发，发现值得继续追踪的研究线索。', { exact: true }).waitFor()
    assert.equal(await page.getByText('当前部署尚未配置该工具入口。', { exact: true }).count(), 0)
    assert.equal(await page.locator('#workspace-content ul, #workspace-content ol').count(), 0)
    await assertLayout()
    assert.equal(await header.getByRole('button', { name: 'CAS认证', exact: true }).count(), 0)
    await header.getByRole('button', { name: '登录', exact: true }).click()
    const loginDialog = page.getByRole('dialog', { name: '登录 FastResearch', exact: true })
    await loginDialog.getByRole('link', { name: '使用 FastCAS 登录', exact: true }).waitFor()
    assert.equal(await loginDialog.innerText(), '使用 FastCAS 登录')
    assert.equal(await loginDialog.locator('a, button, input').count(), 1)
    await page.keyboard.press('Escape')
    await loginDialog.waitFor({ state: 'hidden' })
    await header.getByRole('button', { name: '登录', exact: true }).click()
    await page.mouse.click(width - 4, 100)
    await loginDialog.waitFor({ state: 'hidden' })
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-guest.png`), fullPage: true })
    await page.locator('header .story-brand-mark').click()
    await page.waitForURL('**/intro/news')
    assert.equal(await brandRadius(), '6px')
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Workspace checks passed: 4 widths × 2 themes, product intro links, task and mailbox navigation, stacked mobile team cards and desktop member switching, account and roster pages, history, and revision save')
} finally { await browser.close() }
