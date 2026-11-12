import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const testRoot = path.join(process.cwd(), '.staging-static')
mkdirSync(testRoot, { recursive: true })
const dir = mkdtempSync(path.join(testRoot, 'static-test-'))
const staticDir = path.join(dir, 'dist')
mkdirSync(path.join(staticDir, 'fastppt', 'assets'), { recursive: true })
writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>FastResearch</title>')
writeFileSync(path.join(staticDir, 'fastppt', 'index.html'), '<!doctype html><title>FastPPT</title>')
writeFileSync(path.join(staticDir, 'fastppt', 'styles.css'), 'body { color: #123; }')
writeFileSync(path.join(staticDir, 'fastppt', 'assets', 'cover.webp'), Buffer.from('webp'))

process.env.FASTRESEARCH_STATIC_DIR = staticDir
process.env.FASTRESEARCH_DATA_DIR = path.join(dir, 'data')
process.env.FASTRESEARCH_JWT_SECRET = 'static-route-test-secret'
process.env.ADMIN_PASSWORD = 'static-route-test-admin'
process.env.FASTNEWS_PUBLIC_URL = 'https://news.fixture.test'
process.env.FASTREAD_PUBLIC_URL = 'https://read.fixture.test/reader'
process.env.FASTWRITE_PUBLIC_URL = 'https://write.fixture.test'
process.env.FASTTASK_PUBLIC_URL = 'https://task.fixture.test'
process.env.FASTPPT_PUBLIC_URL = ''
process.env.VITE_FASTPPT_URL = ''
delete process.env.FASTRESEARCH_FASTCAS_ISSUER
delete process.env.FASTRESEARCH_FASTCAS_CLIENT_ID
delete process.env.FASTRESEARCH_FASTCAS_CLIENT_SECRET
delete process.env.FASTRESEARCH_FASTCAS_REDIRECT_URI

const { startServer } = await import('./index.mjs')

test('product intro routes share the SPA, legacy PPT redirects, and media stays available', async () => {
  const server = await startServer(0, '127.0.0.1')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const catalog = await (await fetch(base + '/api/workspace/apps')).json()
    assert.equal(catalog.apps.length, 6)
    assert.ok(catalog.apps.every(app => !Object.hasOwn(app, 'target')))
    for (const [id, target] of [
      ['fast-news', 'https://news.fixture.test/api/auth/fastcas/login'],
      ['fast-read', 'https://read.fixture.test/reader/api/auth/fastcas/login'],
      ['fast-write', 'https://write.fixture.test/api/auth/fastcas/login?returnTo=%2Fpanel'],
      ['fast-task', 'https://task.fixture.test/api/v1/auth/fastcas/login'],
    ]) {
      const launch = await fetch(`${base}/api/workspace/apps/${id}/launch?next=https://untrusted.test&sso=do-not-forward`, { redirect: 'manual', headers: { Authorization: 'Bearer do-not-forward' } })
      assert.equal(launch.status, 302)
      assert.equal(launch.headers.get('location'), target)
      assert.equal(launch.headers.get('cache-control'), 'no-store')
    }
    assert.equal((await fetch(base + '/api/workspace/apps/unknown/launch', { redirect: 'manual' })).status, 404)
    assert.equal((await fetch(base + '/api/workspace/apps/fast-ppt/launch', { redirect: 'manual' })).status, 503)
    const redirect = await fetch(`${base}/fastppt`, { redirect: 'manual' })
    assert.equal(redirect.status, 301)
    assert.equal(redirect.headers.get('location'), '/intro/ppt')

    const oldTrailingSlash = await fetch(`${base}/fastppt/?from=old`, { redirect: 'manual' })
    assert.equal(oldTrailingSlash.status, 301)
    assert.equal(oldTrailingSlash.headers.get('location'), '/intro/ppt?from=old')

    const home = await fetch(`${base}/intro/ppt`)
    assert.equal(home.status, 200)
    assert.match(home.headers.get('content-type') ?? '', /^text\/html/)
    assert.equal(await home.text(), '<!doctype html><title>FastResearch</title>')
    for (const route of ['/', '/workspace', '/intro/read', '/intro/news/', '/intro/figure']) {
      const response = await fetch(base + route)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), '<!doctype html><title>FastResearch</title>')
    }

    const styles = await fetch(`${base}/fastppt/styles.css`)
    assert.equal(styles.status, 200)
    assert.match(styles.headers.get('content-type') ?? '', /^text\/css/)

    const image = await fetch(`${base}/fastppt/assets/cover.webp`)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/webp')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
