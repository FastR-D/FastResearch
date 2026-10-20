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
delete process.env.FASTRESEARCH_FASTCAS_ISSUER
delete process.env.FASTRESEARCH_FASTCAS_CLIENT_ID
delete process.env.FASTRESEARCH_FASTCAS_CLIENT_SECRET
delete process.env.FASTRESEARCH_FASTCAS_REDIRECT_URI

const { startServer } = await import('./index.mjs')

test('FastPPT promo routes serve nested static pages and assets', async () => {
  const server = await startServer(0, '127.0.0.1')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const redirect = await fetch(`${base}/fastppt`, { redirect: 'manual' })
    assert.equal(redirect.status, 301)
    assert.equal(redirect.headers.get('location'), '/fastppt/')

    const home = await fetch(`${base}/fastppt/`)
    assert.equal(home.status, 200)
    assert.match(home.headers.get('content-type') ?? '', /^text\/html/)
    assert.equal(await home.text(), '<!doctype html><title>FastPPT</title>')

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
