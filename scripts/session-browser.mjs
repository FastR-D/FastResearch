// Browser scheduling uses API fixtures; signed OIDC, refresh, cookie lifetime,
// callback binding, logout and return-path validation are covered by Go tests.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const origin = process.env.FASTRESEARCH_CHECK_URL ?? 'http://127.0.0.1:18789'
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH ?? '/usr/bin/google-chrome', headless: true })
async function scenario({ source = 'fastcas', nearExpiry = false, expired = false, hint = false, marker = '', available = true, teamFails = false, next = '/workspace?tool=fast-read' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (hint) await context.addInitScript(() => sessionStorage.setItem('fastresearch-cas-session-hint', 'true'))
  let renewal = null
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url())
    let json = {}
    switch (u.pathname) {
      case '/api/auth/fastcas/login':
        renewal = u
        return route.fulfill({ contentType: 'text/html', body: '<h1>CAS renewal</h1>' })
      case '/api/auth/fastcas/available': json = { enabled: available, login_enabled: available, legacy_key_enabled: true }; break
      case '/api/content/me':
        if (expired) return route.fulfill({ status: 401, json: { error: '会话已过期' } })
        json = { person: '续期测试用户', keyId: 'session-key', accountId: 'session-account', source, role: 'member', expiresAt: Date.now() + (nearExpiry ? 30_000 : 86400_000), insightItems: [] }; break
      case '/api/workflow/team':
        if (teamFails) return route.fulfill({ status: 503, json: { error: '临时网络错误' } })
        json = { members: [] }; break
      case '/api/workspace/apps': json = { apps: [{ id: 'fast-read', configured: true, auth: 'cas', capabilities: ['activity'], launchPath: '/api/workspace/apps/fast-read/launch' }] }; break
      default:
        if (u.pathname.endsWith('/activity')) json = { accountState: 'active', metrics: [], items: [] }
        else throw new Error('Unexpected fixture endpoint: ' + u.pathname)
    }
    return route.fulfill({ json })
  })
  await page.goto(origin + next + marker, { waitUntil: 'networkidle' })
  return { page, context, errors, renewal: () => renewal, next }
}
try {
  for (const next of ['/workspace?tool=fast-read', '/workspace?view=team']) {
    const s = await scenario({ nearExpiry: true, next })
    await s.page.getByRole('heading', { name: 'CAS renewal', exact: true }).waitFor()
    assert.equal(s.renewal().searchParams.get('next'), next)
    assert.deepEqual(s.errors, [])
    await s.context.close()
  }
  for (const options of [{ source: 'key', nearExpiry: true }, {}, { expired: true, hint: true, marker: '&fastcas=failed' }, { expired: true, hint: true, available: false }, { teamFails: true }]) {
    const s = await scenario(options)
    await s.page.locator('#workspace-content').waitFor()
    assert.equal(s.renewal(), null, JSON.stringify(options))
    if (options.teamFails) assert.equal(await s.page.getByRole('button', { name: '退出登录', exact: true }).count(), 1)
    assert.deepEqual(s.errors, [])
    await s.context.close()
  }
  const stale = await scenario({ expired: true, hint: true })
  await stale.page.getByRole('heading', { name: 'CAS renewal', exact: true }).waitFor()
  assert.equal(stale.renewal().searchParams.get('next'), stale.next)
  await stale.context.close()
  console.log('Passed CAS proactive renewal, expired-session restoration, return state, failed/disabled CAS loop guards, Key isolation and transient-error session retention')
} finally { await browser.close() }
