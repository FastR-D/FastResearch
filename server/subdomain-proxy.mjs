import { request as httpRequest } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'

// All upstreams are fixed loopback services. No request input selects an origin.
export const SUBDOMAIN_SITES = Object.freeze({
  'research.fastrd.io': { app: 'fastresearch', redirectOrigin: 'https://fastrd.io' },
  'insight.fastrd.io': { app: 'fastinsight', botInformation: true },
  'cas.fastrd.io': { app: 'fastcas', port: 8900 },
  'task.fastrd.io': { app: 'fasttask', port: 10000 },
  'read.fastrd.io': { app: 'fastread', port: 8584 },
  'write.fastrd.io': { app: 'fastwrite', port: 3003 },
  'news.fastrd.io': { app: 'fastnews', port: 8788, stripPrefix: '/news' },
  'ui.fastrd.io': { app: 'fastui', port: 8792 },
  'figure.fastrd.io': { app: 'fastfigure', port: 5178, protected: true },
  'fastlabs.fastrd.io': { app: 'fastlabs', port: 8789, protected: true },
})

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'])

function hostname(request) {
  const value = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0].trim()
  try {
    const url = new URL('http://' + value)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return ''
    return url.hostname.toLowerCase().replace(/\.$/, '')
  } catch { return '' }
}

function digest(value) { return createHash('sha256').update(value).digest() }
function equal(left, right) { return timingSafeEqual(digest(left), digest(right)) }
function credentialsMatch(request, credentials) {
  if (!credentials.username || !credentials.password) return false
  const value = String(request.headers.authorization ?? '')
  if (!/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(value)) return false
  const raw = Buffer.from(value.slice(6), 'base64').toString('utf8')
  const separator = raw.indexOf(':')
  return separator >= 0 && equal(raw.slice(0, separator), credentials.username) && equal(raw.slice(separator + 1), credentials.password)
}

function failure(response, status, message, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra })
  response.end(JSON.stringify({ error: message }))
}

function filteredHeaders(headers) {
  const connection = String(headers.connection ?? '').toLowerCase().split(',').map(value => value.trim())
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.has(name.toLowerCase()) && !connection.includes(name.toLowerCase())))
}

export function createSubdomainProxy({ sites = SUBDOMAIN_SITES,
  credentials = () => ({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || '' }) } = {}) {
  function match(request) { return sites[hostname(request)] }
  function authorize(request, response, site, host) {
    if (!site.protected) return true
    // Only this authenticated gateway may translate a public origin to loopback.
    if (request.headers.origin && request.headers.origin !== `https://${host}`) {
      failure(response, 403, '不允许跨站访问此预览环境')
      return false
    }
    if (!credentialsMatch(request, credentials())) {
      failure(response, 401, '请使用 FastResearch 管理员凭据登录预览环境',
        { 'WWW-Authenticate': 'Basic realm="FastRD preview", charset="UTF-8"' })
      return false
    }
    return true
  }
  function options(request, site, host, upgrade = false) {
    const url = new URL(request.url, `https://${host}`)
    let path = url.pathname
    if (site.stripPrefix && (path === site.stripPrefix || path.startsWith(site.stripPrefix + '/'))) {
      path = path.slice(site.stripPrefix.length) || '/'
    }
    const headers = filteredHeaders(request.headers)
    headers.host = site.protected ? `127.0.0.1:${site.port}` : host
    headers['x-forwarded-host'] = host
    headers['x-forwarded-proto'] = 'https'
    if (site.protected) {
      delete headers.authorization
      if (request.headers.origin) headers.origin = `http://127.0.0.1:${site.port}`
    }
    if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    return { hostname: '127.0.0.1', port: site.port, path: path + url.search,
      method: request.method, headers }
  }
  return {
    matches(request) { return Boolean(match(request)) },
    handle(request, response) {
      const site = match(request)
      if (!site) return false
      const host = hostname(request)
      if (site.redirectOrigin) {
        const url = new URL(request.url, site.redirectOrigin)
        response.writeHead(308, { Location: site.redirectOrigin + url.pathname + url.search, 'Cache-Control': 'no-store' })
        response.end(); request.resume(); return true
      }
      if (site.botInformation) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FastInsight</title><body><main><h1>FastInsight</h1><p>FastInsight 通过飞书机器人收集和整理研究资料，没有独立网页控制台。</p><p><a href="https://fastrd.io">打开 FastResearch 查看收集的内容</a></p></main></body></html>')
        request.resume(); return true
      }
      if (!authorize(request, response, site, host)) { request.resume(); return true }
      const upstream = httpRequest(options(request, site, host), incoming => {
        const headers = filteredHeaders(incoming.headers)
        headers['x-fastdeploy-app'] = site.app
        headers['x-accel-buffering'] = 'no'
        response.writeHead(incoming.statusCode, headers)
        incoming.on('error', () => response.destroy())
        incoming.pipe(response)
      })
      upstream.on('error', () => {
        if (!response.headersSent) failure(response, 502, '项目服务暂不可用')
        else response.destroy()
      })
      request.on('aborted', () => upstream.destroy())
      response.on('close', () => upstream.destroy())
      request.pipe(upstream)
      return true
    },
    upgrade(request, socket, head) {
      const site = match(request)
      if (!site) return false
      const host = hostname(request)
      if (!site.port) { socket.destroy(); return true }
      const response = {
        status: 500, headers: {},
        writeHead(status, headers) { this.status = status; this.headers = headers },
        end(body = '') {
          const text = Object.entries(this.headers).map(([name, value]) => `${name}: ${value}\r\n`).join('')
          socket.end(`HTTP/1.1 ${this.status} Rejected\r\n${text}Connection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
        },
      }
      if (!authorize(request, response, site, host)) return true
      if (String(request.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return true }
      const upstream = httpRequest(options(request, site, host, true))
      upstream.on('upgrade', (incoming, peer, peerHead) => {
        const headers = Object.entries(incoming.headers).flatMap(([name, value]) =>
          (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}\r\n`)).join('')
        socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n${headers}\r\n`)
        if (peerHead.length) socket.write(peerHead)
        if (head.length) peer.write(head)
        peer.on('error', () => socket.destroy())
        socket.on('error', () => peer.destroy())
        socket.on('close', () => peer.destroy())
        peer.on('close', () => socket.destroy())
        peer.pipe(socket); socket.pipe(peer)
      })
      upstream.on('response', incoming => { incoming.resume(); socket.end(`HTTP/1.1 ${incoming.statusCode} Rejected\r\nConnection: close\r\n\r\n`) })
      upstream.on('error', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.end()
      return true
    },
  }
}
