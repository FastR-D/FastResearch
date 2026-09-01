import { createServer } from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const PORT = Number(process.env.PORT ?? 8787)
const DATA_DIR = path.resolve(process.env.FASTRESEARCH_DATA_DIR ?? 'data')
const DATA_FILE = path.join(DATA_DIR, 'access.json')
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const sessions = new Map()
let data
let writeQueue = Promise.resolve()

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
  if (!Array.isArray(data.keys)) data.keys = []
}

function persist() {
  writeQueue = writeQueue.then(() => writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8'))
  return writeQueue
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-FastInsight-Key',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  })
  response.end(JSON.stringify(payload))
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message })
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

function getSession(request) {
  const header = request.headers.authorization ?? ''
  const sessionId = header.startsWith('Bearer ') ? header.slice(7) : ''
  const session = sessions.get(sessionId)
  if (!session || session.expiresAt < Date.now()) {
    if (sessionId) sessions.delete(sessionId)
    return null
  }
  return { sessionId, ...session }
}

function requireAdmin(request, response) {
  const session = getSession(request)
  if (!session) {
    sendError(response, 401, '管理员登录已失效')
    return null
  }
  return session
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

function normalizeItems(items, source) {
  if (!Array.isArray(items)) return []
  return items.slice(0, 100).map((item, index) => ({
    id: String(item.id ?? `${Date.now()}-${index}`),
    title: String(item.title ?? item.headline ?? '未命名内容').slice(0, 300),
    summary: String(item.summary ?? item.abstract ?? item.trend_summary ?? '').slice(0, 1200),
    url: String(item.url ?? item.paper_url ?? '').slice(0, 1000) || undefined,
    source: String(item.source ?? source).slice(0, 80),
    direction: String(item.direction ?? item.matched_direction ?? '').slice(0, 120) || undefined,
    receivedAt: String(item.receivedAt ?? item.received_at ?? new Date().toISOString()),
  }))
}

async function handle(request, response) {
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
    sessions.set(sessionId, { username: data.admin.username, expiresAt: Date.now() + SESSION_TTL_MS })
    sendJson(response, 200, { session: sessionId, username: data.admin.username, expiresAt: Date.now() + SESSION_TTL_MS })
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
      const record = data.keys.find((item) => item.id === keyId)
      if (!record) {
        sendError(response, 404, '个人 Key 不存在')
        return
      }
      record.revokedAt = new Date().toISOString()
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
    sendJson(response, 200, { person: record.person, recentArticles: record.recentArticles ?? [], insightItems: record.insightItems ?? [] })
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
    sendError(response, 400, error.message || '请求失败')
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FastResearch API listening on http://127.0.0.1:${PORT}`)
})
