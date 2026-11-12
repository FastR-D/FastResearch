import { Readable } from 'node:stream'

const FASTREAD_PREFIX = '/read'
const REWRITABLE_TYPES = /(?:^|\/)(?:javascript|ecmascript|css)(?:;|$)/i

export function isFastReadProxyPath(pathname) {
  return pathname === FASTREAD_PREFIX || pathname.startsWith(`${FASTREAD_PREFIX}/`)
}

export function fastReadTargetPath(pathname) {
  if (!isFastReadProxyPath(pathname)) return null
  const target = pathname.slice(FASTREAD_PREFIX.length)
  return target && target !== '/' ? target : '/'
}

export function rewriteFastReadText(value) {
  return String(value)
    .replaceAll('"/api', '"/read/api')
    .replaceAll("'/api", "'/read/api")
    .replaceAll('`/api', '`/read/api')
    .replaceAll('"/vendor', '"/read/vendor')
    .replaceAll("'/vendor", "'/read/vendor")
    .replaceAll('`/vendor', '`/read/vendor')
}

function proxiedLocation(value, upstreamUrl) {
  if (!value) return value
  try {
    const target = new URL(value, upstreamUrl)
    if (target.origin !== upstreamUrl.origin) return value
    return `${FASTREAD_PREFIX}${target.pathname}${target.search}${target.hash}`
  } catch {
    return value
  }
}

function responseHeaders(upstream, upstreamUrl) {
  const headers = []
  for (const [name, value] of upstream.headers) {
    if (['content-encoding', 'content-length', 'transfer-encoding', 'location'].includes(name.toLowerCase())) continue
    if (name.toLowerCase() === 'set-cookie') continue
    headers.push([name, value])
  }
  for (const value of upstream.headers.getSetCookie?.() ?? []) headers.push(['set-cookie', value])
  const location = upstream.headers.get('location')
  if (location) headers.push(['location', proxiedLocation(location, upstreamUrl)])
  headers.push(['x-fastread-proxy', 'fastresearch'])
  return headers
}

export async function handleFastReadProxy(request, response, url, origin = process.env.FASTREAD_PROXY_URL || 'http://127.0.0.1:3015') {
  const targetPath = fastReadTargetPath(url.pathname)
  if (!targetPath) return false

  const upstreamUrl = new URL(targetPath, origin.replace(/\/$/, ''))
  upstreamUrl.search = url.search
  const headers = new Headers()
  const method = request.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(request)
  for (const [name, value] of Object.entries(request.headers)) {
    const excluded = ['host', 'accept-encoding']
    if (!body) excluded.push('content-length')
    if (excluded.includes(name.toLowerCase())) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  headers.set('accept-encoding', 'identity')

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      ...(body ? { duplex: 'half' } : {}),
      redirect: 'manual',
    })
    const outgoing = responseHeaders(upstream, upstreamUrl)
    const contentType = upstream.headers.get('content-type') || ''
    if (REWRITABLE_TYPES.test(contentType) && upstream.body) {
      const rewritten = rewriteFastReadText(await upstream.text())
      const buffer = Buffer.from(rewritten)
      const filtered = outgoing.filter(([name]) => name.toLowerCase() !== 'content-length')
      filtered.push(['content-length', String(buffer.length)])
      response.writeHead(upstream.status, filtered)
      response.end(method === 'HEAD' ? undefined : buffer)
      return true
    }

    response.writeHead(upstream.status, outgoing)
    if (method === 'HEAD' || !upstream.body) {
      response.end()
      return true
    }
    Readable.fromWeb(upstream.body).pipe(response)
    return true
  } catch (error) {
    const detail = [error?.message, error?.cause?.message].filter(Boolean).join(': ')
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: `FastRead 代理不可用: ${detail}` }))
    return true
  }
}
