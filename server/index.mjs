import { createServer } from 'node:http'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const PORT = Number(process.env.PORT ?? 8787)
const DATA_DIR = path.resolve(process.env.FASTRESEARCH_DATA_DIR ?? 'data')
const DATA_FILE = path.join(DATA_DIR, 'tokens.json')
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const ENTRY_IDS = ['read', 'write', 'fast-task', 'fast-news']
const ENTRY_NAMES = {
  read: 'Read',
  write: 'Write',
  'fast-task': 'FastTask',
  'fast-news': 'FastNews',
}

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

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function defaultData() {
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'admin123456'
  return {
    admin: { username, passwordHash: passwordHash(password) },
    tokens: Object.fromEntries(ENTRY_IDS.map((entryId) => [entryId, []])),
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
  for (const entryId of ENTRY_IDS) data.tokens[entryId] ??= []
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

function publicEntries() {
  return ENTRY_IDS.map((entryId) => ({ id: entryId, name: ENTRY_NAMES[entryId] }))
}

function tokenIsActive(record) {
  return !record.revokedAt && (!record.expiresAt || new Date(record.expiresAt).getTime() > Date.now())
}

function adminEntries() {
  return publicEntries().map((entry) => ({
    ...entry,
    tokens: data.tokens[entry.id].map((record) => ({
      id: record.id,
      label: record.label,
      tokenPreview: record.tokenPreview,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      active: tokenIsActive(record),
    })),
  }))
}

function findToken(entryId, token) {
  return data.tokens[entryId]?.find((record) => record.tokenHash === tokenHash(token) && tokenIsActive(record))
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

  if (request.method === 'GET' && route === '/api/admin/entries') {
    if (!requireAdmin(request, response)) return
    sendJson(response, 200, { entries: adminEntries() })
    return
  }

  const tokenRoute = route.match(/^\/api\/admin\/entries\/([^/]+)\/tokens(?:\/([^/]+))?$/)
  if (tokenRoute && ['POST', 'DELETE'].includes(request.method)) {
    if (!requireAdmin(request, response)) return
    const [, entryId, tokenId] = tokenRoute
    if (!ENTRY_IDS.includes(entryId)) {
      sendError(response, 404, '功能入口不存在')
      return
    }
    if (request.method === 'DELETE') {
      const record = data.tokens[entryId].find((item) => item.id === tokenId)
      if (!record) {
        sendError(response, 404, 'Token 不存在')
        return
      }
      record.revokedAt = new Date().toISOString()
      await persist()
      sendJson(response, 200, { ok: true })
      return
    }

    const body = await readBody(request)
    const rawToken = `fr_${randomBytes(24).toString('base64url')}`
    const record = {
      id: randomBytes(10).toString('hex'),
      label: String(body.label ?? '').trim().slice(0, 80) || '未命名 Token',
      tokenHash: tokenHash(rawToken),
      tokenPreview: `${rawToken.slice(0, 9)}...${rawToken.slice(-4)}`,
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
      revokedAt: null,
    }
    data.tokens[entryId].unshift(record)
    await persist()
    sendJson(response, 201, {
      token: rawToken,
      entryId,
      record: {
        id: record.id,
        label: record.label,
        tokenPreview: record.tokenPreview,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        active: true,
      },
    })
    return
  }

  if (request.method === 'POST' && route === '/api/guest/verify') {
    const body = await readBody(request)
    const entryId = String(body.entryId ?? '')
    const token = String(body.token ?? '').trim()
    if (!ENTRY_IDS.includes(entryId) || !token) {
      sendError(response, 400, '功能入口和 Token 不能为空')
      return
    }
    if (!findToken(entryId, token)) {
      sendError(response, 401, 'Token 无效、已撤销或已过期')
      return
    }
    sendJson(response, 200, { ok: true, entry: { id: entryId, name: ENTRY_NAMES[entryId] } })
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
