// Routing editor interaction checks; persistence and authorization use Go tests.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const origin = process.env.FASTRESEARCH_CHECK_URL ?? 'http://127.0.0.1:18789'
const output = path.resolve(process.env.FASTRESEARCH_CHECK_OUTPUT ?? 'test-results/roster')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? '/usr/bin/microsoft-edge', headless: true })
const errors = []
try {
  for (const colorScheme of ['light', 'dark']) for (const width of [390, 1440]) {
    const context = await browser.newContext({ colorScheme, viewport: { width, height: 960 } })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    let roster = { keywords: ['Agent', 'Security'], members: [{ id: 'm1', name: '张老师' }, { id: 'm2', name: '李同学' }], directions: [{ id: 'd1', name: '智能体安全', keywords: ['Agent'], owners: [{ id: 'm1', name: '张老师' }] }, { id: 'd2', name: '机器学习', keywords: [], owners: [] }] }
    let revision = 1
    let forceConflict = false
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let json
      switch (url.pathname) {
        case '/api/auth/fastcas/available': json = { enabled: true, login_enabled: true }; break
        case '/api/content/me': json = { person: '管理员', accountId: 'a1', role: 'admin', expiresAt: 9999999999999 }; break
        case '/api/admin/me': json = { username: '管理员', expiresAt: 9999999999999 }; break
        case '/api/workflow/team': json = { members: [] }; break
        case '/api/auth/fastcas/status': json = { role: 'admin' }; break
        case '/api/workspace/apps': json = { apps: [] }; break
        case '/api/admin/fastinsight/roster':
          if (route.request().method() === 'PUT') {
            if (forceConflict) return route.fulfill({ status: 409, json: { error: '配置已被其他管理员更新，请重新加载后修改' } })
            const saved = route.request().postDataJSON()
            assert.equal(saved.revision, String(revision))
            roster = saved.roster
            revision++
          }
          json = { roster, revision: String(revision), storage: 'database' }; break
        default: throw new Error(`Unexpected API: ${url.pathname}`)
      }
      await route.fulfill({ json })
    })
    await page.goto(origin + '/workspace?view=routing', { waitUntil: 'networkidle' })
    const graph = page.getByRole('region', { name: '论文分发设置', exact: true })
    const col = kind => page.locator(`[data-roster-column="${kind}"]`)
    const save = async () => { await graph.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByText('FastInsight分发设置已保存', { exact: true }).waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent.includes('正在保存'))) }
    const openNode = async (kind, name) => { await col(kind).getByRole('button', { name, exact: false }).filter({ hasNot: page.locator('svg') }).click() }
    await col('keyword').getByText('未匹配任何关键词').waitFor()
    assert.equal(await page.locator('textarea').count(), 0)
    await openNode('member', '李同学')
    let dialog = page.getByRole('dialog', { name: '编辑接收成员' })
    await dialog.getByRole('checkbox', { name: '智能体安全', exact: true }).check()
    await dialog.getByRole('checkbox', { name: '接收未匹配关键词的论文' }).check()
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-member-dialog.png`) })
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await save()
    assert.equal(roster.default_owner.id, 'm2')
    assert.deepEqual(roster.directions[0].owners.map(m => m.id), ['m1', 'm2'])
    // The input is one tag, including spaces/commas. No delimiter parsing.
    await graph.getByRole('button', { name: '新增关键词', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '新增关键词' })
    await dialog.getByLabel('关键词', { exact: true }).fill('Large models, safety')
    await dialog.getByRole('checkbox', { name: '智能体安全', exact: true }).check()
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await save()
    assert.ok(roster.keywords.includes('Large models, safety'))
    assert.ok(roster.directions[0].keywords.includes('Large models, safety'))
    // Cancelled modal changes do not modify the graph.
    await openNode('member', '张老师')
    dialog = page.getByRole('dialog', { name: '编辑接收成员' })
    await dialog.getByLabel('姓名', { exact: true }).fill('不应保存')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await col('member').getByText('张老师', { exact: true }).waitFor()
    if (width === 1440) {
      // Real pointer drag from keyword port to direction port.
      const a = await col('keyword').getByRole('button', { name: '连接 Security', exact: true }).boundingBox()
      const b = await col('direction').getByRole('button', { name: '连接 机器学习', exact: true }).first().boundingBox()
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
      await page.mouse.up()
      await graph.getByRole('button', { name: '解除关系：Security → 机器学习', exact: true }).waitFor({ state: 'attached' })
      await save()
      assert.deepEqual(roster.directions[1].keywords, ['Security'])
      const keywordLink = graph.getByRole('button', { name: '解除关系：Security → 机器学习', exact: true })
      const midpoint = await keywordLink.evaluate(el => {
        const p = el.getPointAtLength(el.getTotalLength() / 2)
        const point = new DOMPoint(p.x, p.y).matrixTransform(el.getScreenCTM())
        return { x: point.x, y: point.y }
      })
      await page.mouse.click(midpoint.x, midpoint.y)
      await save()
      assert.deepEqual(roster.directions[1].keywords, [])
      // Keyboard equivalent and keyboard removal.
      await col('direction').getByRole('button', { name: '连接 机器学习', exact: true }).last().focus()
      await page.keyboard.press('Enter')
      await col('member').getByRole('button', { name: '连接 张老师', exact: true }).focus()
      await page.keyboard.press('Enter')
      const link = graph.getByRole('button', { name: '解除关系：机器学习 → 张老师', exact: true })
      await link.waitFor({ state: 'attached' }); await link.focus(); await page.keyboard.press('Delete')
      await page.keyboard.press('Enter')
      await save()
      assert.deepEqual(roster.directions[1].owners, [])
    }
    await page.screenshot({ path: path.join(output, `${colorScheme}-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    // Reload after persistence, then delete member and check all references.
    await page.reload({ waitUntil: 'networkidle' })
    await openNode('member', '李同学')
    await page.getByRole('dialog').getByRole('button', { name: '删除节点' }).click()
    await save()
    assert.equal(roster.default_owner, undefined)
    assert.ok(roster.directions.every(d => d.owners.every(m => m.id !== 'm2')))
    // A conflict keeps local changes until the explicit reload action.
    await graph.getByRole('button', { name: '新增关键词', exact: true }).click()
    await page.getByRole('dialog').getByLabel('关键词', { exact: true }).fill('本地修改')
    await page.getByRole('dialog').getByRole('button', { name: '应用修改' }).click()
    forceConflict = true
    await graph.getByRole('button', { name: '保存设置', exact: true }).click()
    await graph.getByRole('button', { name: '放弃本地修改并加载最新配置' }).waitFor()
    await col('keyword').getByText('本地修改', { exact: true }).waitFor()
    forceConflict = false
    await graph.getByRole('button', { name: '放弃本地修改并加载最新配置' }).click()
    await page.waitForFunction(() => !document.body.textContent.includes('本地修改'))
    // A new database starts empty; all three catalogs can be built from the UI.
    roster = { keywords: [], members: [], directions: [] }
    revision++
    await page.reload({ waitUntil: 'networkidle' })
    await graph.getByRole('button', { name: '新增研究方向', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '新增研究方向' })
    await dialog.getByLabel('研究方向', { exact: true }).fill('全新方向')
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await graph.getByRole('button', { name: '新增接收成员', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '新增接收成员' })
    await dialog.getByLabel('姓名', { exact: true }).fill('新成员')
    await dialog.getByRole('checkbox', { name: '全新方向', exact: true }).check()
    await dialog.getByRole('checkbox', { name: '接收未匹配关键词的论文' }).check()
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await graph.getByRole('button', { name: '新增关键词', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '新增关键词' })
    await dialog.getByLabel('关键词', { exact: true }).fill('New keyword')
    await dialog.getByRole('checkbox', { name: '全新方向', exact: true }).check()
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await save()
    assert.deepEqual(roster.directions[0].keywords, ['New keyword'])
    assert.equal(roster.directions[0].owners[0].id, roster.default_owner.id)
    await openNode('member', '新成员')
    dialog = page.getByRole('dialog', { name: '编辑接收成员' })
    await dialog.getByLabel('姓名', { exact: true }).fill('新名字')
    await dialog.getByRole('button', { name: '应用修改' }).click()
    await save()
    assert.equal(roster.default_owner.name, '新名字')
    assert.equal(roster.directions[0].owners[0].name, '新名字')
    // Many nodes exercise all three independent scroll containers.
    roster = { keywords: Array.from({ length: 40 }, (_, i) => `关键词 ${i}`), members: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `成员 ${i}` })), directions: Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, name: `方向 ${i}`, keywords: [`关键词 ${i}`], owners: [{ id: `m${i}`, name: `成员 ${i}` }] })) }
    revision++
    await page.reload({ waitUntil: 'networkidle' })
    await col('keyword').getByText('关键词 39', { exact: true }).waitFor({ state: 'attached' })
    assert.equal(await page.locator('[data-roster-column]').count(), 3)
    for (const kind of ['keyword', 'direction', 'member']) {
      assert.ok(await col(kind).evaluate(el => el.scrollHeight > el.clientHeight))
      await col(kind).evaluate(el => { el.scrollTop = 150 })
      for (const other of ['keyword', 'direction', 'member'].filter(k => k !== kind)) assert.equal(await col(other).evaluate(el => el.scrollTop), 0)
      await col(kind).evaluate(el => { el.scrollTop = 0 })
    }
    if (width === 1440) {
      const line = graph.getByRole('button', { name: '解除关系：关键词 0 → 方向 0', exact: true })
      const before = await line.getAttribute('d')
      await col('keyword').evaluate(el => { el.scrollTop = 20 })
      await page.waitForFunction(({ old }) => document.querySelector('[aria-label="解除关系：关键词 0 → 方向 0"]')?.getAttribute('d') !== old, { old: before })
      await page.screenshot({ path: path.join(output, `${colorScheme}-${width}-scroll.png`) })
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('Roster checks passed: drag, keyboard links, tags, default, cancel/delete, persistence, conflict, independent scrolling, light/dark and mobile.')
} finally { await browser.close() }
