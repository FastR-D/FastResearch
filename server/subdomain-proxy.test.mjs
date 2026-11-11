import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { createSubdomainProxy, SUBDOMAIN_SITES } from './subdomain-proxy.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port
}
function close(server) { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) }
function request(port, { host = 'write.fastrd.io', path = '/', method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const client = httpRequest({ hostname: '127.0.0.1', port, path, method, headers: { host, ...headers } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
    })
    client.on('error', reject); client.end(body)
  })
}
const basic = 'Basic ' + Buffer.from('preview:private-password').toString('base64')

async function fixture(t, handler, protectedSite = false) {
  const origin = createServer(handler)
  const originPort = await listen(origin)
  const host = protectedSite ? 'figure.fastrd.io' : 'write.fastrd.io'
  const sites = { [host]: { app: protectedSite ? 'fastfigure' : 'fastwrite', port: originPort, protected: protectedSite },
    'news.fastrd.io': { app: 'fastnews', port: originPort, stripPrefix: '/news' } }
  const proxy = createSubdomainProxy({ sites, credentials: () => ({ username: 'preview', password: 'private-password' }) })
  const edge = createServer((req, res) => { if (!proxy.handle(req, res)) { res.writeHead(404); res.end() } })
  edge.on('upgrade', (req, socket, head) => { if (!proxy.upgrade(req, socket, head)) socket.destroy() })
  const port = await listen(edge)
  t.after(async () => { await close(edge); await close(origin) })
  return { port, origin, originPort, proxy }
}

test('subdomains use exact hosts and fixed loopback routes', () => {
  const proxy = createSubdomainProxy()
  assert.ok(proxy.matches({ headers: { host: 'WRITE.FASTRD.IO:443' } }))
  assert.ok(proxy.matches({ headers: { host: 'internal', 'x-forwarded-host': 'news.fastrd.io' } }))
  for (const host of ['evilwrite.fastrd.io', 'write.fastrd.io.evil.test', 'evil@write.fastrd.io', 'write.fastrd.io/path']) {
    assert.equal(proxy.matches({ headers: { host } }), false)
  }
  assert.equal(SUBDOMAIN_SITES['labs.fastrd.io'], undefined)
  assert.equal(SUBDOMAIN_SITES['fastlabs.fastrd.io'].protected, true)
})

test('streams request bodies and preserves independent cookies and redirects', async t => {
  const seen = []
  const { port } = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    seen.push({ headers: req.headers, body, path: req.url })
    res.writeHead(302, { 'Set-Cookie': ['one=1; Path=/; HttpOnly', 'two=2; Path=/'], Location: '/next', 'Content-Type': 'text/plain' })
    res.end('body')
  })
  const response = await request(port, { path: '/api/upload?part=2', method: 'POST', headers: { Origin: 'https://write.fastrd.io', Authorization: 'Bearer app-token' }, body: 'streamed request' })
  assert.equal(response.status, 302)
  assert.equal(response.body, 'body')
  assert.equal(response.headers['set-cookie'].length, 2)
  assert.equal(response.headers.location, '/next')
  assert.equal(response.headers['x-fastdeploy-app'], 'fastwrite')
  assert.equal(seen[0].path, '/api/upload?part=2')
  assert.equal(seen[0].headers.host, 'write.fastrd.io')
  assert.equal(seen[0].headers.authorization, 'Bearer app-token')
  assert.equal(seen[0].headers['x-forwarded-proto'], 'https')
  assert.equal(seen[0].body, 'streamed request')
})

test('news accepts its existing public prefix on the independent hostname', async t => {
  const { port } = await fixture(t, (req, res) => res.end(req.url))
  assert.equal((await request(port, { host: 'news.fastrd.io', path: '/news/api/auth/me?x=1' })).body, '/api/auth/me?x=1')
  assert.equal((await request(port, { host: 'news.fastrd.io', path: '/assets/site.js' })).body, '/assets/site.js')
})

test('agent previews require authentication and reject cross-site requests', async t => {
  let requests = 0
  const { port, originPort } = await fixture(t, (req, res) => { requests++; res.end(JSON.stringify(req.headers)) }, true)
  const denied = await request(port, { host: 'figure.fastrd.io' })
  assert.equal(denied.status, 401)
  assert.match(denied.headers['www-authenticate'], /^Basic/)
  assert.equal((await request(port, { host: 'figure.fastrd.io', headers: { Authorization: basic, Origin: 'https://attacker.test' } })).status, 403)
  assert.equal(requests, 0)
  const allowed = await request(port, { host: 'figure.fastrd.io', method: 'POST', headers: { Authorization: basic, Origin: 'https://figure.fastrd.io' }, body: '{}' })
  assert.equal(allowed.status, 200)
  const headers = JSON.parse(allowed.body)
  assert.equal(headers.authorization, undefined)
  assert.equal(headers.host, `127.0.0.1:${originPort}`)
  assert.equal(headers.origin, `http://127.0.0.1:${originPort}`)
  assert.equal(headers['x-forwarded-host'], 'figure.fastrd.io')
})

test('unavailable projects return a safe gateway error', async t => {
  const { port, origin } = await fixture(t, (_req, res) => res.end('ok'))
  await close(origin)
  const response = await request(port)
  assert.equal(response.status, 502)
  assert.equal(response.body.includes('127.0.0.1'), false)
})

test('websocket upgrades preserve the initial head and relay both directions', { timeout: 3000 }, async t => {
  const { port, origin } = await fixture(t, (_req, res) => res.end())
  origin.on('upgrade', (_req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    if (head.length) socket.write(head)
    socket.on('data', data => socket.write(data))
    socket.on('end', () => socket.end())
  })
  const socket = connect(port, '127.0.0.1')
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  const received = new Promise((resolve, reject) => {
    let text = ''
    socket.on('data', chunk => { text += chunk; if (text.includes('initial-head')) { socket.destroy(); resolve(text) } })
    socket.on('error', reject)
  })
  socket.write('GET /api/ws HTTP/1.1\r\nHost: write.fastrd.io\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\ninitial-head')
  const response = await received
  assert.match(response, /^HTTP\/1\.1 101/)
  assert.match(response, /initial-head/)
})
