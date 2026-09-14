import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    try {
      const text = readFileSync(path.resolve(name), 'utf8')
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        if (process.env[key] === undefined) process.env[key] = value
      }
    } catch {
      // optional local env files
    }
  }
}

loadEnvFiles()
const PORT = Number(process.env.PORT ?? 8787)
const DATA_DIR = path.resolve(process.env.FASTRESEARCH_DATA_DIR ?? 'data')
const DATA_FILE = path.join(DATA_DIR, 'access.json')
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const TICKET_TTL_MS = 2 * 60 * 1000
const PUBLIC_API_URL = (process.env.FASTRESEARCH_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
const SSO_LAUNCH = {
  'fast-news': {
    fallbacks: () => [process.env.FASTNEWS_URL, process.env.VITE_FASTNEWS_URL, 'http://127.0.0.1:4173'],
    invalid: 'FastNews 地址无效',
    mode: 'ticket',
  },
  'fast-read': {
    fallbacks: () => [process.env.FASTREAD_URL, process.env.VITE_READ_URL, 'http://127.0.0.1:3015'],
    invalid: 'FastRead 地址无效',
    mode: 'ticket',
  },
}
const sessions = new Map()
const tickets = new Map()
const COOKIE_NAME = process.env.FASTRESEARCH_COOKIE_NAME ?? 'fr_session'
const COOKIE_DOMAIN = String(process.env.FASTRESEARCH_COOKIE_DOMAIN ?? '').trim()
const COOKIE_SAMESITE = String(process.env.FASTRESEARCH_COOKIE_SAMESITE ?? 'Lax').trim() || 'Lax'
let data
let writeQueue = Promise.resolve()
let activeRequest = null

function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function passwordMatches(password, encoded) {
  const [, salt, expected] = String(encoded ?? '').split('$')
  if (!salt || !expected) return false
  const actual = scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

function keyHash(key) {
  return createHash('sha256').update(key).digest('hex')
}

function defaultData() {
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'admin123456'
  return {
    admin: { username, passwordHash: passwordHash(password) },
    keys: [],
  }
}

function ensureKeyCollections(record) {
  if (!Array.isArray(record.followedAuthors)) record.followedAuthors = []
  if (!Array.isArray(record.customResearchTags)) record.customResearchTags = []
  return record
}

async function loadData() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    data = JSON.parse(await readFile(DATA_FILE, 'utf8'))
  } catch {
    data = defaultData()
    await persist()
  }
  // Migrate the previous per-entry token store to the new key store without
  // preserving credentials. Existing users must receive newly issued keys.
  let migrated = false
  if (!Array.isArray(data.keys)) {
    data.keys = []
    migrated = true
  }
  for (const record of data.keys) {
    if (!Array.isArray(record.followedAuthors) || !Array.isArray(record.customResearchTags)) {
      ensureKeyCollections(record)
      migrated = true
    }
  }
  if (!data.jwtSecret || typeof data.jwtSecret !== 'string') {
    data.jwtSecret = randomBytes(32).toString('hex')
    migrated = true
  }
  if (migrated) await persist()
}

function persist() {
  writeQueue = writeQueue.then(() => writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8'))
  return writeQueue
}

function jwtSecret() {
  return process.env.FASTRESEARCH_JWT_SECRET || data.jwtSecret
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signJwt(payload) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const body = b64urlJson(payload)
  const sig = createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verifyJwt(token) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url')
  const actual = Buffer.from(sig)
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload?.exp || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function readCookies(request) {
  const out = {}
  for (const part of String(request?.headers?.cookie ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

function isLocalHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function originFromUrl(value) {
  try {
    return new URL(String(value ?? '').trim()).origin
  } catch {
    return ''
  }
}

function allowedOrigins() {
  const extras = String(process.env.FASTRESEARCH_CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return new Set(
    [
      PUBLIC_API_URL,
      process.env.FASTNEWS_URL,
      process.env.VITE_FASTNEWS_URL,
      process.env.FASTREAD_URL,
      process.env.VITE_READ_URL,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://localhost:4173',
      'http://127.0.0.1:3015',
      'http://localhost:3015',
      ...extras,
    ].map(originFromUrl).filter(Boolean),
  )
}

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (allowedOrigins().has(origin)) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && isLocalHostname(url.hostname)
  } catch {
    return false
  }
}

function corsHeaders(request) {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-FastInsight-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    Vary: 'Origin',
  }
  const origin = String(request?.headers?.origin ?? '')
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function isSecureRequest(request) {
  const forwarded = String(request?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim()
  return forwarded === 'https'
}

function serializeCookie(value, { maxAge, request, sameSite = COOKIE_SAMESITE } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAge ?? 0))}`,
    `SameSite=${sameSite}`,
  ]
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`)
  if (isSecureRequest(request) || String(sameSite).toLowerCase() === 'none') parts.push('Secure')
  return parts.join('; ')
}

function memberCookieHeader(request, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor(((expiresAt ?? (Date.now() + SESSION_TTL_MS)) - Date.now()) / 1000))
  return { 'Set-Cookie': serializeCookie(token, { maxAge, request }) }
}

function clearMemberCookieHeader(request) {
  return { 'Set-Cookie': serializeCookie('', { maxAge: 0, request }) }
}

function resolveLaunchUrl(next, fallbacks = []) {
  for (const value of [next, ...fallbacks]) {
    const raw = String(value ?? '').trim()
    if (!raw) continue
    try {
      const parsed = new URL(raw)
      if (!['http:', 'https:'].includes(parsed.protocol)) continue
      if (!isAllowedOrigin(parsed.origin)) continue
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {}
  }
  return ''
}


function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(activeRequest),
    ...extraHeaders,
  })
  response.end(status === 204 ? '' : JSON.stringify(payload))
}

function sendError(response, status, message, extraHeaders = {}) {
  sendJson(response, status, { error: message }, extraHeaders)
}

async function readBody(request) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 1024 * 1024) throw new Error('请求内容过大')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('请求格式无效')
  }
}

function getRequestToken(request) {
  const header = request.headers.authorization ?? ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return readCookies(request)[COOKIE_NAME] ?? ''
}

function getSession(request) {
  const sessionId = getRequestToken(request)
  if (!sessionId) return null
  const payload = verifyJwt(sessionId)
  if (payload?.role === 'member' && payload.keyId) {
    return {
      sessionId,
      role: 'member',
      keyId: payload.keyId,
      person: payload.person,
      expiresAt: payload.exp * 1000,
    }
  }
  const session = sessions.get(sessionId)
  if (!session || session.expiresAt < Date.now()) {
    if (sessionId) sessions.delete(sessionId)
    return null
  }
  return { sessionId, ...session }
}

function requireAdmin(request, response) {
  const session = getSession(request)
  if (!session || session.role === 'member') {
    sendError(response, 401, '管理员登录已失效')
    return null
  }
  return session
}

function requireMember(request, response) {
  const session = getSession(request)
  if (!session || session.role !== 'member') {
    sendError(response, 401, '成员登录已失效', clearMemberCookieHeader(request))
    return null
  }
  const record = data.keys.find((item) => item.id === session.keyId && keyIsActive(item))
  if (!record) {
    sessions.delete(session.sessionId)
    sendError(response, 401, '个人 Key 无效、已撤销或已过期', clearMemberCookieHeader(request))
    return null
  }
  return { ...session, record: ensureKeyCollections(record) }
}

function keyIsActive(record) {
  return !record.revokedAt && (!record.expiresAt || new Date(record.expiresAt).getTime() > Date.now())
}

function adminKeys() {
  return data.keys.map((record) => ({
    id: record.id,
    person: record.person,
    keyPreview: record.keyPreview,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    active: keyIsActive(record),
  }))
}

function findKey(key) {
  return data.keys.find((record) => record.keyHash === keyHash(key) && keyIsActive(record))
}

function createMemberSession(record) {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const session = signJwt({
    role: 'member',
    keyId: record.id,
    person: record.person,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt / 1000),
  })
  return { session, person: record.person, keyId: record.id, expiresAt }
}

function memberContent(record) {
  return {
    person: record.person,
    keyId: record.id,
    recentArticles: record.recentArticles ?? [],
    insightItems: record.insightItems ?? [],
    authors: record.followedAuthors ?? [],
    customTags: record.customResearchTags ?? [],
  }
}

function pruneTickets() {
  const now = Date.now()
  for (const [id, ticket] of tickets) {
    if (ticket.expiresAt < now) tickets.delete(id)
  }
}

function uniqueStrings(items, limit, length) {
  const unique = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items.slice(0, limit) : []) {
    const value = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, length)
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}

function normalizeFollowedAuthors(items) {
  if (!Array.isArray(items)) return []
  return items.slice(0, 200).map((item, index) => {
    const tags = uniqueStrings(item?.tags ?? (typeof item?.bio === 'string' ? item.bio.split(/[/、,;|]+/) : []), 20, 40)
    const fetchState = ['pending', 'success', 'error', 'cancelled', 'idle'].includes(item?.fetchState)
      ? item.fetchState
      : (item?.parsed ? 'success' : 'idle')
    return {
      id: String(item?.id ?? `${Date.now()}-${index}`).slice(0, 80),
      name: String(item?.name ?? '').trim().slice(0, 100),
      homepage: String(item?.homepage ?? '').trim().slice(0, 1000),
      tags,
      bio: tags.join(' / ').slice(0, 400),
      fetchState,
      fetchMessage: String(item?.fetchMessage ?? '').slice(0, 200),
      parsed: item?.parsed && typeof item.parsed === 'object' ? item.parsed : null,
    }
  }).filter((item) => item.name)
}

function normalizeCustomTags(items) {
  return uniqueStrings(items, 40, 40)
}

function normalizeItems(items, source) {
  if (!Array.isArray(items)) return []
  return items.slice(0, 100).map((item, index) => ({
    id: String(item.id ?? `${Date.now()}-${index}`),
    title: String(item.title ?? item.headline ?? '未命名内容').slice(0, 300),
    summary: String(item.summary ?? item.abstract ?? item.trend_summary ?? '').slice(0, 1200),
    url: String(item.url ?? item.paper_url ?? '').slice(0, 1000) || undefined,
    source: String(item.source ?? source).slice(0, 80),
    direction: String(item.direction ?? item.matched_direction ?? '').slice(0, 120) || undefined,
    authors: String(item.authors ?? item.author ?? '').slice(0, 300) || undefined,
    venue: String(item.venue ?? item.year_venue ?? item.yearVenue ?? '').slice(0, 200) || undefined,
    receivedAt: String(item.receivedAt ?? item.received_at ?? new Date().toISOString()),
  }))
}

async function handle(request, response) {
  activeRequest = request
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  const route = url.pathname.replace(/\/$/, '') || '/'

  if (request.method === 'GET' && route === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'POST' && route === '/api/admin/login') {
    const body = await readBody(request)
    if (body.username !== data.admin.username || !passwordMatches(String(body.password ?? ''), data.admin.passwordHash)) {
      sendError(response, 401, '管理员账号或密码错误')
      return
    }
    const sessionId = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + SESSION_TTL_MS
    sessions.set(sessionId, { role: 'admin', username: data.admin.username, expiresAt })
    sendJson(response, 200, { session: sessionId, username: data.admin.username, expiresAt })
    return
  }

  if (request.method === 'POST' && route === '/api/admin/logout') {
    const session = getSession(request)
    if (session) sessions.delete(session.sessionId)
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && route === '/api/admin/keys') {
    if (!requireAdmin(request, response)) return
    sendJson(response, 200, { keys: adminKeys() })
    return
  }

  const keyRoute = route.match(/^\/api\/admin\/keys(?:\/([^/]+))?$/)
  if (keyRoute && ['POST', 'DELETE'].includes(request.method)) {
    if (!requireAdmin(request, response)) return
    const [, keyId] = keyRoute
    if (request.method === 'DELETE') {
      if (!keyId) {
        sendError(response, 400, '缺少个人 Key')
        return
      }
      const index = data.keys.findIndex((item) => item.id === keyId)
      if (index === -1) {
        sendError(response, 404, '个人 Key 不存在')
        return
      }
      data.keys.splice(index, 1)
      await persist()
      sendJson(response, 200, { ok: true })
      return
    }

    const body = await readBody(request)
    const rawKey = `fk_${randomBytes(24).toString('base64url')}`
    const record = {
      id: randomBytes(10).toString('hex'),
      person: String(body.person ?? '').trim().slice(0, 80) || '未命名成员',
      keyHash: keyHash(rawKey),
      keyPreview: `${rawKey.slice(0, 9)}...${rawKey.slice(-4)}`,
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      revokedAt: null,
      recentArticles: [],
      insightItems: [],
      followedAuthors: [],
      customResearchTags: [],
    }
    data.keys.unshift(record)
    await persist()
    sendJson(response, 201, {
      key: rawKey,
      record: {
        id: record.id,
        person: record.person,
        keyPreview: record.keyPreview,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        active: true,
      },
    })
    return
  }

  if (request.method === 'POST' && route === '/api/content/unlock') {
    const body = await readBody(request)
    const key = String(body.key ?? '').trim()
    if (!key) {
      sendError(response, 400, '个人 Key 不能为空')
      return
    }
    const record = findKey(key)
    if (!record) {
      sendError(response, 401, '个人 Key 无效、已撤销或已过期')
      return
    }
    ensureKeyCollections(record)
    const auth = createMemberSession(record)
    sendJson(response, 200, { ...auth, ...memberContent(record) }, memberCookieHeader(request, auth.session, auth.expiresAt))
    return
  }

  if (request.method === 'POST' && route === '/api/content/logout') {
    sendJson(response, 200, { ok: true }, clearMemberCookieHeader(request))
    return
  }

  if (request.method === 'GET' && route === '/api/content/me') {
    const member = requireMember(request, response)
    if (!member) return
    const auth = { session: member.sessionId, expiresAt: member.expiresAt }
    sendJson(response, 200, { ...auth, ...memberContent(member.record) }, memberCookieHeader(request, auth.session, auth.expiresAt))
    return
  }

  if (route === '/api/content/authors' && ['GET', 'PUT'].includes(request.method)) {
    const member = requireMember(request, response)
    if (!member) return
    if (request.method === 'GET') {
      sendJson(response, 200, {
        authors: member.record.followedAuthors ?? [],
        customTags: member.record.customResearchTags ?? [],
      })
      return
    }
    const body = await readBody(request)
    member.record.followedAuthors = normalizeFollowedAuthors(body.authors)
    member.record.customResearchTags = normalizeCustomTags(body.customTags)
    await persist()
    sendJson(response, 200, {
      authors: member.record.followedAuthors,
      customTags: member.record.customResearchTags,
    })
    return
  }

  if (request.method === 'POST' && route === '/api/sso/ticket') {
    const member = requireMember(request, response)
    if (!member) return
    const body = await readBody(request)
    const audience = String(body.audience ?? '').trim()
    if (!SSO_LAUNCH[audience]) {
      sendError(response, 400, '不支持的登录入口')
      return
    }
    pruneTickets()
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + TICKET_TTL_MS
    tickets.set(ticket, { keyId: member.record.id, person: member.record.person, audience, expiresAt })
    sendJson(response, 200, { ticket, expiresAt, apiUrl: PUBLIC_API_URL })
    return
  }

  if (request.method === 'POST' && route === '/api/sso/consume') {
    const body = await readBody(request)
    const ticketId = String(body.ticket ?? '').trim()
    const audience = String(body.audience ?? '').trim()
    pruneTickets()
    const ticket = tickets.get(ticketId)
    if (ticket) tickets.delete(ticketId)
    if (!ticket || ticket.expiresAt < Date.now() || ticket.audience !== audience) {
      sendError(response, 401, '登录票据无效或已过期')
      return
    }
    const record = data.keys.find((item) => item.id === ticket.keyId && keyIsActive(item))
    if (!record) {
      sendError(response, 401, '个人 Key 无效、已撤销或已过期')
      return
    }
    ensureKeyCollections(record)
    const auth = createMemberSession(record)
    sendJson(response, 200, { ...auth, ...memberContent(record) }, memberCookieHeader(request, auth.session, auth.expiresAt))
    return
  }

  if (request.method === 'GET' && route === '/api/sso/launch') {
    const member = requireMember(request, response)
    if (!member) return
    const audience = String(url.searchParams.get('audience') ?? '').trim()
    const config = SSO_LAUNCH[audience]
    if (!config) {
      sendError(response, 400, '不支持的登录入口')
      return
    }
    const target = resolveLaunchUrl(url.searchParams.get('next'), config.fallbacks())
    if (!target) {
      sendError(response, 400, config.invalid)
      return
    }
    let location = target
    if (config.mode === 'ticket') {
      pruneTickets()
      const ticket = randomBytes(24).toString('base64url')
      const expiresAt = Date.now() + TICKET_TTL_MS
      tickets.set(ticket, { keyId: member.record.id, person: member.record.person, audience, expiresAt })
      const nextUrl = new URL(target)
      nextUrl.searchParams.set('sso', ticket)
      location = nextUrl.toString()
    }
    const auth = createMemberSession(member.record)
    response.writeHead(302, {
      Location: location,
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
      ...memberCookieHeader(request, auth.session, auth.expiresAt),
    })
    response.end()
    return
  }

  if (request.method === 'POST' && ['/api/insight/publish', '/api/content/reading/publish'].includes(route)) {
    const ingestKey = request.headers['x-fastinsight-key'] ?? ''
    if (!process.env.FASTINSIGHT_INGEST_KEY || ingestKey !== process.env.FASTINSIGHT_INGEST_KEY) {
      sendError(response, 401, 'FastInsight 发布凭证无效')
      return
    }
    const body = await readBody(request)
    const requestedPerson = String(body.person ?? '').trim().toLocaleLowerCase()
    const targets = data.keys.filter((record) => keyIsActive(record) && (!requestedPerson || record.person.toLocaleLowerCase() === requestedPerson))
    if (!targets.length) {
      sendError(response, 404, '没有匹配的成员 Key')
      return
    }
    const channel = route.includes('reading') ? 'recentArticles' : 'insightItems'
    const items = normalizeItems([body.item ?? body], route.includes('reading') ? 'FastRead' : 'FastInsight')
    for (const target of targets) target[channel] = [...items, ...(target[channel] ?? [])].slice(0, 100)
    await persist()
    sendJson(response, 201, { ok: true, deliveredTo: targets.map((target) => target.person) })
    return
  }

  sendError(response, 404, '接口不存在')
}

await loadData()
createServer((request, response) => {
  handle(request, response).catch((error) => {
    activeRequest = request
    sendError(response, 400, error.message || '请求失败')
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FastResearch API listening on http://127.0.0.1:${PORT}`)
})