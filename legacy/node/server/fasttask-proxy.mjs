import { Readable } from 'node:stream'

const DEFAULT_PUBLIC_HOST = 'task.fastrd.io'
const DEFAULT_ORIGIN = 'http://127.0.0.1:10000'

function hostname(value) {
  return String(value ?? '').split(',')[0].trim().split(':')[0].toLowerCase()
}

export function isFastTaskProxyHost(hostHeader, publicHost = process.env.FASTTASK_PROXY_HOST || DEFAULT_PUBLIC_HOST) {
  return hostname(hostHeader) === hostname(publicHost)
}

function responseHeaders(upstream) {
  const headers = []
  for (const [name, value] of upstream.headers) {
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(name.toLowerCase())) continue
    headers.push([name, value])
  }
  headers.push(['x-fasttask-proxy', 'fastresearch'])
  headers.push(['x-accel-buffering', 'no'])
  return headers
}

export async function handleFastTaskProxy(request, response, url, origin = process.env.FASTTASK_PROXY_URL || DEFAULT_ORIGIN) {
  const upstreamUrl = new URL(url.pathname + url.search, origin.replace(/\/$/, ''))
  const headers = new Headers()
  const method = request.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(request)

  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase()
    if (['host', 'accept-encoding', 'connection', 'keep-alive', 'upgrade', 'proxy-connection'].includes(lower)) continue
    if (!body && lower === 'content-length') continue
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
    response.writeHead(upstream.status, responseHeaders(upstream))
    if (method === 'HEAD' || !upstream.body) {
      response.end()
      return true
    }
    Readable.fromWeb(upstream.body).pipe(response)
    return true
  } catch (error) {
    const detail = [error?.message, error?.cause?.message].filter(Boolean).join(': ')
    response.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(JSON.stringify({ error: `FastTask 代理不可用: ${detail}` }))
    return true
  }
}
