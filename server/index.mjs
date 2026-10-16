import { createServer } from 'node:http'
import { FastCASService, CASFailure } from './fastcas-service.mjs'
import { ServiceIngest, ServiceIngestError } from './service-ingest.mjs'
import { handleFastCAS } from './fastcas-routes.mjs'
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { AccountStore, TokenStore } from './account-store.mjs'
import { migrateAccounts } from './account-migration.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { openWorkflowStore, getWorkflowsByAccount, getWorkflowById, getPendingEvents, markEventSynced, markEventFailed } from './workflow-store.mjs'
import { receiveDispatch, startWorkflow, completeStage, formatWorkflowView } from './fasttask-dispatch.mjs'
import { createFastWriteClient } from './fastwrite-client.mjs'
import { createFastTaskClient } from './fasttask-client.mjs'
import { RosterConflictError, RosterValidationError, readRoster, writeRoster } from './fastinsight-roster.mjs'
import { handleFastReadProxy, isFastReadProxyPath } from './fastread-proxy.mjs'

function loadEnvFiles() {
  for (const name of ['.env.production', '.env', '.env.local']) {
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
const HOST = process.env.HOST ?? '127.0.0.1'
const STATIC_DIR = path.resolve(process.env.FASTRESEARCH_STATIC_DIR ?? 'dist')
const DATA_DIR = path.resolve(process.env.FASTRESEARCH_DATA_DIR ?? 'data')
const DATA_FILE = path.join(DATA_DIR, 'access.json')
const WORKFLOW_FILE = path.join(DATA_DIR, 'workflows.sqlite')
const FASTINSIGHT_ROSTER_FILE = path.resolve(process.env.FASTINSIGHT_ROSTER ?? '../fastinsight/assets/colleagues.yaml')
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
let sessions
let tickets
const COOKIE_NAME = process.env.FASTRESEARCH_COOKIE_NAME ?? 'fr_session'
const COOKIE_DOMAIN = String(process.env.FASTRESEARCH_COOKIE_DOMAIN ?? '').trim()
const COOKIE_SAMESITE = String(process.env.FASTRESEARCH_COOKIE_SAMESITE ?? 'Lax').trim() || 'Lax'
let data
let requestQueue = Promise.resolve()
const requestScope = new AsyncLocalStorage()
let accountStore
let fastcas
let serviceIngest
let dataRevision = 0
let workflowDb
let fastWriteClient
let fastTaskClient
let fastTaskClients = new Map()
let fastTaskProvisionClient
let fastTaskBaseURL = ''
let fastTaskSyncTimer

// Pre-account snapshots need a deterministic fallback that never uses display
// names, which may be duplicated across members.
function derivedAccountId(keyId) {
  return 'account_' + createHash('sha256').update('FastResearch:legacy:' + keyId).digest('hex').slice(0, 32)
}

function accountIdOf(record) {
  if (!record?.id) return ''
  // Preserve the stable ID already used by FastRead/FastWrite. Only records
  // from pre-account snapshots receive a deterministic derived fallback.
  return String(record.accountId ?? '').trim() || derivedAccountId(record.id)
}

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
  if (!record.researchImpression || typeof record.researchImpression !== 'object') {
    record.researchImpression = { text: '', updatedAt: '' }
  } else {
    if (typeof record.researchImpression.text !== 'string') record.researchImpression.text = ''
    if (typeof record.researchImpression.updatedAt !== 'string') record.researchImpression.updatedAt = ''
  }
  if (!Array.isArray(record.inbox)) record.inbox = []
  if (record.workflow != null && (!record.workflow.tasks || !Array.isArray(record.workflow.tasks))) record.workflow = null
  if (record.workflow === undefined) record.workflow = null
  return record
}

async function loadData() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  const database = path.resolve(process.env.FASTRESEARCH_ACCOUNT_DATABASE ?? path.join(DATA_DIR, 'accounts.sqlite'))
  if (!existsSync(database)) {
    let initial
    try { initial = JSON.parse(await readFile(DATA_FILE, 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('账号文件无法读取；停止启动以保护原数据')
      initial = defaultData()
      initial.jwtSecret = randomBytes(32).toString('hex')
      await writeFile(DATA_FILE, `${JSON.stringify(initial, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    }
    // Migration validates before writing and keeps the original file untouched.
    migrateAccounts(DATA_FILE, database, { apply: true })
  }
  accountStore = new AccountStore(database)
  sessions = new TokenStore(accountStore, 'session')
  tickets = new TokenStore(accountStore, 'ticket')
  sessions.prune()
  fastcas = new FastCASService(accountStore, sessions)
  serviceIngest = new ServiceIngest()
  reloadData()
  for (const record of data.keys) ensureKeyCollections(record)
  if (!data.jwtSecret || typeof data.jwtSecret !== 'string') data.jwtSecret = randomBytes(32).toString('hex')
  await persist()

  // FastTask/FastWrite companion wiring. These are optional integrations: a
  // deployment without their credentials still serves the console normally.
  workflowDb = openWorkflowStore(WORKFLOW_FILE)

  const fastWriteUrl = process.env.FASTWRITE_URL || process.env.VITE_WRITE_URL
  const fastWritePublicUrl = process.env.FASTWRITE_PUBLIC_URL || process.env.VITE_WRITE_URL || fastWriteUrl
  const fastWriteApiKey = process.env.FASTWRITE_API_KEY
  if (fastWriteUrl && fastWriteApiKey) {
    fastWriteClient = createFastWriteClient(fastWriteUrl, fastWriteApiKey, fastWritePublicUrl)
    console.log('FastWrite 客户端已初始化:', fastWriteUrl)
  } else {
    console.log('FastWrite 客户端未配置 (需要 FASTWRITE_URL 和 FASTWRITE_API_KEY)')
  }

  const fastTaskUrl = process.env.FASTTASK_URL || process.env.VITE_FASTTASK_URL
  fastTaskBaseURL = String(fastTaskUrl ?? '').trim()
  const fastTaskApiKey = process.env.FASTTASK_API_KEY
  fastTaskClient = createFastTaskClient(fastTaskUrl, fastTaskApiKey)
  const fastTaskProvisionKey = process.env.FASTTASK_PROVISION_KEY || fastTaskApiKey
  fastTaskProvisionClient = createFastTaskClient(fastTaskUrl, fastTaskProvisionKey)
  fastTaskClients = new Map()
  const configuredFastTaskKeys = String(process.env.FASTTASK_API_KEYS ?? '').trim()
  if (configuredFastTaskKeys) {
    try {
      const entries = JSON.parse(configuredFastTaskKeys)
      const list = Array.isArray(entries)
        ? entries
        : Object.entries(entries).map(([accountId, value]) => ({ account_id: accountId, ...(value ?? {}) }))
      for (const entry of list) {
        const accountId = String(entry?.account_id ?? entry?.accountId ?? '').trim()
        const apiKey = String(entry?.api_key ?? entry?.apiKey ?? '').trim()
        const url = String(entry?.url ?? fastTaskUrl ?? '').trim()
        if (accountId && apiKey && url) fastTaskClients.set(accountId, createFastTaskClient(url, apiKey))
      }
    } catch (error) {
      console.warn('FASTTASK_API_KEYS 配置无效:', error.message)
    }
  }
  if (fastTaskClient || fastTaskProvisionClient || fastTaskClients.size) {
    console.log('FastTask 客户端已初始化:', fastTaskUrl || `${fastTaskClients.size} 个绑定客户端`)
    startFastTaskSync()
  } else {
    console.log('FastTask 客户端未配置 (需要 FASTTASK_URL 和 FASTTASK_API_KEY)')
  }
}

async function syncFastTaskEvents() {
  if ((!fastTaskClient && !fastTaskProvisionClient && !fastTaskClients.size) || !workflowDb) return
  const events = getPendingEvents(workflowDb, 10)
  for (const event of events) {
    const accountId = String(event.account_id ?? '').trim()
    const target = fastTaskClientForAccount(accountId)
    const client = target.client
    if (!client) continue
    try {
      const payload = event.payload ?? {}
      await client.publishProgress({
        schema_version: '1.0',
        trace_id: `fastresearch-${event.id}`,
        source: { external_id: event.id },
        kind: 'progress_evidence',
        title: `FastResearch 工序完成：${payload.stage_id ?? 'stage'}`,
        description: payload.description ?? '',
        artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
        metadata: {
          event_type: event.event_type,
          fastresearch_account_id: event.account_id,
          dispatch_id: payload.dispatch_id,
          dispatch_revision: payload.dispatch_revision,
          workflow_id: payload.workflow_id,
          stage_id: payload.stage_id,
          completion_type: payload.completion_type,
          task_id: payload.task_id,
          task_revision: payload.task_revision,
          completed_at: payload.completed_at,
        },
      }, event.id, target.receiverRef)
      markEventSynced(workflowDb, event.id)
    } catch (error) {
      const attempts = Number(event.attempts ?? 0) + 1
      const retryAt = Date.now() + Math.min(15 * 60_000, 1000 * (2 ** Math.min(attempts, 9)))
      markEventFailed(workflowDb, event.id, String(error?.message ?? error).slice(0, 500), retryAt)
    }
  }
}

function fastTaskClientForAccount(accountId) {
  const direct = fastTaskClients.get(String(accountId ?? '').trim())
  if (direct) return { client: direct, receiverRef: '' }
  const record = data?.keys?.find((item) => accountIdOf(item) === String(accountId ?? '').trim())
  if (record?.fasttaskProvisioned === true && fastTaskProvisionClient) {
    return { client: fastTaskProvisionClient, receiverRef: String(accountId ?? '').trim() }
  }
  return { client: fastTaskClient ?? fastTaskProvisionClient, receiverRef: '' }
}

function startFastTaskSync() {
  if (fastTaskSyncTimer) clearInterval(fastTaskSyncTimer)
  fastTaskSyncTimer = setInterval(() => { void syncFastTaskEvents() }, 5000)
  void syncFastTaskEvents()
}

function reloadData() {
  const snapshot = accountStore.load()
  data = snapshot.data
  dataRevision = snapshot.revision
}

function persist() {
  try { dataRevision = accountStore.save(data, dataRevision) }
  catch (error) { reloadData(); throw error }
  return Promise.resolve()
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
      const parsed = new URL(raw, PUBLIC_API_URL)
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
    ...corsHeaders(requestScope.getStore()),
    ...extraHeaders,
  })
  response.end(status === 204 ? '' : JSON.stringify(payload))
}

function sendError(response, status, message, extraHeaders = {}) {
  sendJson(response, status, { error: message }, extraHeaders)
}

async function readBody(request) {
  if (Object.hasOwn(request, 'parsedBody')) return request.parsedBody
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
  if (!sessionId || sessions.revoked(sessionId)) return null
  const payload = verifyJwt(sessionId)
  if (payload?.role === 'member' && payload.keyId && payload.sessionVersion !== 2) {
    return {
      sessionId,
      role: 'member',
      keyId: payload.keyId,
      person: payload.person,
      credentialVersion: payload.credentialVersion ?? 1,
      accountId: payload.accountId,
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
  const record = data.keys.find((item) => item.id === session.keyId)
  const permitted = record && !record.accountDisabledAt && (session.authSource === 'fastcas' || (keyIsActive(record) && session.credentialVersion === (record.credentialVersion ?? 1)))
  if (!permitted) {
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
    accountId: accountIdOf(record),
    fasttaskUserId: record.fasttaskUserId ?? null,
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
  const identity = {
    role: 'member', keyId: record.id, person: record.person,
    accountId: accountIdOf(record), credentialVersion: record.credentialVersion ?? 1,
    authSource: 'key', authenticatedAt: Date.now(),
  }
  const session = signJwt({ ...identity, sessionVersion: 2, jti: randomBytes(24).toString('base64url'),
    iat: Math.floor(Date.now()/1000), exp: Math.floor(expiresAt/1000) })
  sessions.set(session, { ...identity, expiresAt })
  return { session, person: record.person, keyId: record.id, accountId: identity.accountId, expiresAt }
}

function memberContent(record) {
  const impression = normalizeImpression(record.researchImpression)
  const inbox = normalizeInbox(record.inbox)
  return {
    person: record.person,
    keyId: record.id,
    accountId: accountIdOf(record),
    recentArticles: record.recentArticles ?? [],
    insightItems: record.insightItems ?? [],
    authors: record.followedAuthors ?? [],
    customTags: record.customResearchTags ?? [],
    impression,
    inboxUnread: inbox.filter((item) => !item.read).length,
    workflow: workflowView(record.workflow),
  }
}

function pruneTickets() { tickets.prune() }

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

function normalizeImpression(item) {
  const raw = item && typeof item === 'object' ? item : {}
  return {
    text: String(raw.text ?? '').replace(/\r\n/g, '\n').slice(0, 4000),
    updatedAt: String(raw.updatedAt ?? ''),
  }
}

function normalizeInbox(items) {
  if (!Array.isArray(items)) return []
  const out = []
  const seen = new Set()
  for (const item of items.slice(0, 180)) {
    if (!item || typeof item !== 'object') continue
    const date = String(item.date ?? '').trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const kind = String(item.kind ?? 'daily-paper').trim().slice(0, 40) || 'daily-paper'
    let id = String(item.id ?? '').trim().slice(0, 120)
    if (!id) id = `inbox-${date}-${out.length + 1}`
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id,
      date,
      kind,
      paperId: String(item.paperId ?? item.paper_id ?? '').trim().slice(0, 180),
      title: String(item.title ?? '').trim().slice(0, 300),
      title_zh: String(item.title_zh ?? item.titleZh ?? '').trim().slice(0, 300),
      summary: String(item.summary ?? '').trim().slice(0, 1200),
      reason: String(item.reason ?? '').trim().slice(0, 400),
      url: String(item.url ?? item.link ?? '').trim().slice(0, 1000),
      venue: String(item.venue ?? '').trim().slice(0, 200),
      year: String(item.year ?? '').trim().slice(0, 8),
      authors: String(item.authors ?? item.author ?? '').trim().slice(0, 300),
      category: String(item.category ?? '').trim().slice(0, 80),
      source: String(item.source ?? '').trim().slice(0, 80),
      read: Boolean(item.read),
      receivedAt: String(item.receivedAt ?? item.received_at ?? new Date().toISOString()).slice(0, 40),
    })
  }
  return out
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

const WORKFLOW_MODULES = {
  'fast-ppt': 'fast-ppt',
  fastppt: 'fast-ppt',
  ppt: 'fast-ppt',
  'fast-write': 'fast-write',
  fastwrite: 'fast-write',
  write: 'fast-write',
  'fast-read': 'fast-read',
  fastread: 'fast-read',
  read: 'fast-read',
  'fast-news': 'fast-news',
  fastnews: 'fast-news',
  news: 'fast-news',
  'fast-lab': 'fast-lab',
  fastlab: 'fast-lab',
  lab: 'fast-lab',
}
const MODULE_LABELS = {
  'fast-ppt': 'FastPPT',
  'fast-write': 'FastWrite',
  'fast-read': 'FastRead',
  'fast-news': 'FastNews',
  'fast-lab': 'FastLab',
}
const DEFAULT_WORKFLOW = {
  title: '默认研究流',
  tasks: [
    { module: 'fast-ppt', title: '整理研究演示', description: '把当前结论快速铺成可讲解的幻灯片。' },
    { module: 'fast-write', title: '撰写研究内容', description: '在结构化工作区里产出稿件与论证。' },
    { module: 'fast-read', title: '阅读与检索资料', description: '把论文和资料收进可回溯的阅读脉络。' },
    { module: 'fast-news', title: '跟踪最新信号', description: '查看与关注方向相关的新论文与资讯。' },
    { module: 'fast-lab', title: '实验与验证', description: '进入实验室工作区，完成验证与记录。' },
  ],
}
function resolveWorkflowModule(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  return WORKFLOW_MODULES[key] ?? WORKFLOW_MODULES[key.replaceAll('-', '')] ?? ''
}
function normalizeWorkflow(body, source = 'api') {
  const raw = body?.default === true ? DEFAULT_WORKFLOW : body
  const tasksIn = Array.isArray(raw?.tasks) ? raw.tasks : []
  if (!tasksIn.length) throw new Error('任务列表不能为空')
  const seen = new Set()
  const tasks = tasksIn.slice(0, 50).map((item, index) => {
    const module = resolveWorkflowModule(item?.module ?? item?.tool ?? item?.entry ?? item?.name)
    if (!module) throw new Error(`第 ${index + 1} 个任务的功能无效，需为 FastPPT / FastWrite / FastRead / FastNews / FastLab`)
    let id = String(item?.id ?? randomBytes(8).toString('hex')).slice(0, 80)
    if (!id || seen.has(id)) id = randomBytes(8).toString('hex')
    seen.add(id)
    return {
      id,
      module,
      title: String(item?.title ?? item?.name ?? MODULE_LABELS[module]).trim().slice(0, 300) || MODULE_LABELS[module],
      description: String(item?.description ?? item?.summary ?? '').trim().slice(0, 1200),
      completedAt: null,
    }
  })
  return {
    id: String(raw?.id ?? randomBytes(8).toString('hex')).slice(0, 80),
    title: String(raw?.title ?? raw?.name ?? '研究工作流').trim().slice(0, 200) || '研究工作流',
    source,
    receivedAt: new Date().toISOString(),
    tasks,
  }
}
function workflowView(workflow) {
  if (!workflow || !Array.isArray(workflow.tasks) || !workflow.tasks.length) return null
  const currentIndex = workflow.tasks.findIndex((task) => !task.completedAt)
  const tasks = workflow.tasks.map((task, index) => ({
    id: task.id,
    module: task.module,
    title: task.title,
    description: task.description ?? '',
    completedAt: task.completedAt ?? null,
    status: task.completedAt ? 'done' : currentIndex === index ? 'active' : 'pending',
  }))
  const doneCount = tasks.filter((task) => task.status === 'done').length
  return {
    id: workflow.id,
    title: workflow.title,
    source: workflow.source ?? 'api',
    receivedAt: workflow.receivedAt,
    currentIndex: currentIndex === -1 ? tasks.length : currentIndex,
    doneCount,
    total: tasks.length,
    completed: doneCount === tasks.length,
    currentTask: currentIndex === -1 ? null : tasks[currentIndex],
    tasks,
  }
}
function matchWorkflowTargets(person) {
  const requestedPerson = String(person ?? '').trim().toLocaleLowerCase()
  return data.keys.filter((record) => keyIsActive(record) && (!requestedPerson || record.person.toLocaleLowerCase() === requestedPerson))
}

// FastTask is an optional companion service. A network-level failure means the
// companion is down, rather than that the requested operation was rejected.
// Keep the local Key operation usable in that case; HTTP errors still propagate.
function isFastTaskUnavailable(error) {
  return !Number.isFinite(Number(error?.status))
}

/** Service tokens name a local account. A display name is not a receiver. */
function assessService(claims, body, scope) {
  const scopes = new Set(String(claims?.scope ?? '').split(' ').filter(Boolean))
  if (claims?.token_use && claims.token_use !== 'access') return { status: 401, error: 'API access token required' }
  if (!scopes.has(scope)) return { status: 403, error: 'Required permission missing' }
  const ref = String(body?.receiver_ref ?? '').trim()
  if (!ref) return { status: 400, error: 'receiver_ref required' }
  if (!claims?.sub) return { status: 401, error: 'subject required' }
  return { accountId: ref, subject: claims.sub }
}

function accountTargetsByRef(receiverRef, records = data.keys) {
  const ref = String(receiverRef ?? '').trim()
  if (!ref) return []
  return (records ?? []).filter((record) => keyIsActive(record) && accountIdOf(record) === ref)
}

/** CAS workflow delivery must name an account the caller explicitly allowed. */
function allowedServiceTargets(claims) {
  const clientId = String(claims?.client_id || claims?.sub || '')
  try {
    const policy = JSON.parse(process.env.FASTRESEARCH_FASTCAS_ALLOWED_TARGETS || '{}')
    const targets = policy[clientId]
    return { targets: Array.isArray(targets) ? targets : [] }
  } catch {
    return { targets: [] }
  }
}

async function serviceCredential(request, response, scope) {
  const header = String(request.headers.authorization ?? '')
  if (header) {
    if (!header.startsWith('Bearer ') || !header.slice(7).trim()) {
      sendError(response, 401, '服务令牌无效')
      return null
    }
    try {
      const sdk = await fastcas.sdk()
      const claims = await sdk.verifyAccessToken(header.slice(7).trim(), process.env.FASTRESEARCH_FASTCAS_AUDIENCE || PUBLIC_API_URL, [scope])
      if (!claims || claims.service !== true) throw Object.assign(new Error('服务令牌无效'), { status: 401 })
      return { claims }
    } catch (error) {
      sendError(response, error?.status === 403 ? 403 : 401, '服务令牌无效')
      return null
    }
  }
  if (scope === 'workflow:publish') {
    const taskKey = String(process.env.FASTTASK_INGEST_KEY ?? '')
    if (taskKey && request.headers['x-fasttask-key'] === taskKey) {
      return { legacy: true, source: 'fasttask' }
    }
    // FastTask database bindings retain only a hash of each member Key. In
    // that mode the service uses one provisioning secret plus the stable
    // receiver_ref, which lets us route the workflow without exposing the
    // member credential back to FastTask.
    const provisionKey = String(process.env.FASTTASK_PROVISION_KEY || process.env.FASTTASK_API_KEY || '').trim()
    const suppliedProvisionKey = String(request.headers['x-fastresearch-provision-key'] ?? '').trim()
    const provisionReceiver = String(request.headers['x-fastresearch-receiver-ref'] ?? '').trim()
    if (provisionKey && suppliedProvisionKey === provisionKey && provisionReceiver) {
      const account = data.keys.find((record) => accountIdOf(record) === provisionReceiver && keyIsActive(record))
      if (account) {
        return { legacy: true, source: 'fasttask-provision', accountId: accountIdOf(account), keyId: account.id }
      }
    }
    // A personal FastResearch Key is also a scoped dispatch credential. This
    // binds FastTask's request to the account that owns the Key, so a caller
    // cannot redirect a task to another member by changing receiver_ref.
    const memberKey = findKey(String(request.headers['x-fasttask-key'] ?? '').trim())
    if (memberKey) {
      return { legacy: true, source: 'fasttask-member-key', accountId: accountIdOf(memberKey), keyId: memberKey.id }
    }
  }
  if (!process.env.FASTINSIGHT_INGEST_KEY || request.headers['x-fastinsight-key'] !== process.env.FASTINSIGHT_INGEST_KEY) {
    sendError(response, 401, scope === 'workflow:publish' ? 'FastTask 发布凭证无效' : 'FastInsight 发布凭证无效')
    return null
  }
  return { legacy: true, source: 'fastinsight' }
}


const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function safeStaticPath(urlPath) {
  let decoded = '/'
  try {
    decoded = decodeURIComponent((urlPath || '/').split('?')[0] || '/')
  } catch {
    return null
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const full = path.resolve(STATIC_DIR, relative)
  if (full !== STATIC_DIR && !full.startsWith(STATIC_DIR + path.sep)) return null
  return full
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  let filePath = safeStaticPath(url.pathname)
  if (!filePath) return false
  const tryPaths = [filePath]
  if (!path.extname(filePath)) tryPaths.push(path.join(STATIC_DIR, 'index.html'))
  for (const candidate of tryPaths) {
    try {
      const contents = await readFile(candidate)
      const ext = path.extname(candidate).toLowerCase()
      response.writeHead(200, {
        'Content-Type': STATIC_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      })
      if (request.method === 'HEAD') response.end()
      else response.end(contents)
      return true
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        sendError(response, 500, '前端资源读取失败')
        return true
      }
    }
  }
  try {
    const contents = await readFile(path.join(STATIC_DIR, 'index.html'))
    response.writeHead(200, {
      'Content-Type': STATIC_TYPES['.html'],
      'Cache-Control': 'no-store',
    })
    if (request.method === 'HEAD') response.end()
    else response.end(contents)
    return true
  } catch {
    return false
  }
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
  const route = url.pathname.replace(/\/$/, '') || '/'

  if (isFastReadProxyPath(url.pathname)) {
    await handleFastReadProxy(request, response, url)
    return
  }

  const current = getSession(request)
  const independentEntry = ['/api/content/unlock','/api/content/logout','/api/auth/fastcas/login','/api/auth/fastcas/callback','/api/auth/fastcas/available','/api/auth/fastcas/events','/api/auth/fastcas/backchannel-logout','/api/sso/consume','/api/health','/api/connectors/news/profile'].includes(route)
  if (current?.authSource === 'fastcas' && !independentEntry && !route.startsWith('/api/admin/')) {
    try { await fastcas.validateSession(current.sessionId) }
    catch { sendError(response, 401, 'FastCAS 会话已失效，请使用原 Key 登录', clearMemberCookieHeader(request)); return }
  }
  if (await handleFastCAS(request, response, { service: fastcas, route, sendJson, requireMember, readCookies, getRequestToken, memberCookieHeader, cookieName: COOKIE_NAME })) return

  if (route === '/api/connectors/news/profile') {
    if(request.method!=='GET'){sendError(response,405,'只允许读取');return}
    try{
      const accountId=await fastcas.delegatedNewsAccount(String(request.headers.authorization??''))
      const records=data.keys.filter(record=>accountStore.accountIdForKey(record.id)===accountId)
      if(records.length!==1){sendError(response,404,'Research 账号内容不可用');return}
      const record=records[0]
      sendJson(response,200,{researchAccountId:accountId,authors:record.followedAuthors??[],customTags:record.customResearchTags??[],
        impression:normalizeImpression(record.researchImpression),inbox:normalizeInbox(record.inbox)})
    }catch(error){sendError(response,error instanceof CASFailure?error.status:502,'Research 委托认证失败')}
    return
  }

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

  if (route === '/api/admin/fastinsight/roster') {
    if (!requireAdmin(request, response)) return
    try {
      if (request.method === 'GET') {
        const current = await readRoster(FASTINSIGHT_ROSTER_FILE)
        sendJson(response, 200, {
          roster: current.roster,
          revision: current.revision,
          file: path.basename(FASTINSIGHT_ROSTER_FILE),
        })
        return
      }
      if (request.method === 'PUT') {
        const body = await readBody(request)
        const saved = await writeRoster(FASTINSIGHT_ROSTER_FILE, body.roster, String(body.revision ?? '').trim())
        sendJson(response, 200, {
          roster: saved.roster,
          revision: saved.revision,
          file: path.basename(FASTINSIGHT_ROSTER_FILE),
        })
        return
      }
      sendError(response, 405, '不支持的 FastInsight 名册操作')
    } catch (error) {
      if (error instanceof RosterConflictError) sendError(response, 409, error.message)
      else if (error instanceof RosterValidationError) sendError(response, 400, error.message)
      else sendError(response, 500, `FastInsight 名册保存失败：${error?.message || '未知错误'}`)
    }
    return
  }

  const rotateRoute = route.match(/^\/api\/admin\/keys\/([^/]+)\/rotate$/)
  if (rotateRoute && request.method === 'POST') {
    if (!requireAdmin(request, response)) return
    const record = data.keys.find(item => item.id === rotateRoute[1])
    if (!record) { sendError(response, 404, '个人 Key 不存在'); return }
    const accountId = accountIdOf(record)
    const rawKey = `fk_${randomBytes(24).toString('base64url')}`
    // The FastTask binding stores a Key hash, so rotating locally without the
    // companion would leave FastTask holding a credential nobody can use.
    if (fastTaskProvisionClient && accountId && record.fasttaskProvisioned === true) {
      try {
        await fastTaskProvisionClient.rotateAccountKey(accountId, rawKey)
      } catch (error) {
        if (isFastTaskUnavailable(error)) {
          console.warn(`FastTask 不可达，继续本地轮换 Key: ${error?.message || 'network error'}`)
          record.fasttaskProvisioned = false
        } else {
          const status = Number(error?.status)
          sendError(response, status >= 400 && status < 500 ? status : 502, error?.message || 'FastTask 账户 Key 轮换失败')
          return
        }
      }
    }
    record.keyHash = keyHash(rawKey)
    record.keyPreview = `${rawKey.slice(0, 9)}...${rawKey.slice(-4)}`
    record.credentialVersion = (record.credentialVersion ?? 1) + 1
    record.revokedAt = null
    record.expiresAt = null
    if (fastTaskBaseURL && accountId) fastTaskClients.set(accountId, createFastTaskClient(fastTaskBaseURL, rawKey))
    await persist()
    sendJson(response, 200, { key: rawKey, keyId: record.id, accountId, record: adminKeys().find((item) => item.id === record.id) })
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
      const record = data.keys[index]
      const accountId = accountIdOf(record)
      if (fastTaskProvisionClient && accountId && record.fasttaskProvisioned === true) {
        try {
          await fastTaskProvisionClient.deleteAccount(accountId)
        } catch (error) {
          if (isFastTaskUnavailable(error)) {
            console.warn(`FastTask 不可达，继续本地撤回 Key: ${error?.message || 'network error'}`)
          } else {
            const status = Number(error?.status)
            sendError(response, status >= 400 && status < 500 ? status : 502, error?.message || 'FastTask 账户删除失败')
            return
          }
        }
      }
      if (accountId) fastTaskClients.delete(accountId)
      // Credentials are revoked, never deleted: deleting a local account would
      // orphan the identity that FastCAS links already point at.
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
      followedAuthors: [],
      customResearchTags: [],
      workflow: null,
      fasttaskUserId: String(body.fasttask_user_id ?? body.fasttaskUserId ?? '').trim().slice(0, 200) || null,
      fasttaskProvisioned: false,
    }
    const accountId = accountIdOf(record)
    // A supplied fasttask_user_id is the legacy static-binding escape hatch.
    // New Panel-created Keys leave it empty and are provisioned automatically.
    if (fastTaskProvisionClient && !record.fasttaskUserId) {
      try {
        const provisioned = await fastTaskProvisionClient.provisionAccount({
          receiverRef: accountId,
          key: rawKey,
          displayName: record.person,
        })
        record.fasttaskUserId = String(provisioned.user_id ?? provisioned.user?.id ?? '').trim() || null
        record.fasttaskProvisioned = Boolean(record.fasttaskUserId)
        if (fastTaskBaseURL && accountId) fastTaskClients.set(accountId, createFastTaskClient(fastTaskBaseURL, rawKey))
      } catch (error) {
        if (isFastTaskUnavailable(error)) {
          console.warn(`FastTask 不可达，继续创建本地 Key: ${error?.message || 'network error'}`)
          record.fasttaskProvisioned = false
        } else {
          const status = Number(error?.status)
          sendError(response, status >= 400 && status < 500 ? status : 502, error?.message || 'FastTask 账户创建失败')
          return
        }
      }
    }
    data.keys.unshift(record)
    await persist()
    sendJson(response, 201, {
      key: rawKey,
      record: {
        id: record.id,
        accountId,
        fasttaskUserId: record.fasttaskUserId,
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
    const token = getRequestToken(request)
    if (token) sessions.delete(token)
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

  if (route === '/api/content/impression' && ['GET', 'PUT'].includes(request.method)) {
    const member = requireMember(request, response)
    if (!member) return
    if (request.method === 'GET') {
      sendJson(response, 200, { impression: normalizeImpression(member.record.researchImpression) })
      return
    }
    const body = await readBody(request)
    const impression = normalizeImpression({
      text: body.text ?? body.impression?.text ?? body.impression,
      updatedAt: new Date().toISOString(),
    })
    member.record.researchImpression = impression
    await persist()
    sendJson(response, 200, { impression })
    return
  }

  if (route === '/api/content/inbox' && ['GET', 'PUT'].includes(request.method)) {
    const member = requireMember(request, response)
    if (!member) return
    if (request.method === 'GET') {
      const items = normalizeInbox(member.record.inbox)
      sendJson(response, 200, {
        items,
        unread: items.filter((item) => !item.read).length,
      })
      return
    }
    const body = await readBody(request)
    let items = Array.isArray(body.items) ? normalizeInbox(body.items) : normalizeInbox(member.record.inbox)
    const readIds = new Set(
      (Array.isArray(body.readIds) ? body.readIds : []).map((id) => String(id ?? '').trim()).filter(Boolean),
    )
    if (readIds.size) {
      items = items.map((item) => (readIds.has(item.id) ? { ...item, read: true } : item))
    }
    member.record.inbox = items
    await persist()
    sendJson(response, 200, {
      items,
      unread: items.filter((item) => !item.read).length,
    })
    return
  }

  if (request.method === 'POST' && route === '/api/sso/ticket') {
    const member = requireMember(request, response)
    if (!member) return
    if (member.authSource === 'fastcas') { sendError(response, 409, '请在目标项目使用 FastCAS 登录；旧票据仅用于 Key 登录'); return }
    const body = await readBody(request)
    const audience = String(body.audience ?? '').trim()
    if (!SSO_LAUNCH[audience]) {
      sendError(response, 400, '不支持的登录入口')
      return
    }
    pruneTickets()
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + TICKET_TTL_MS
    tickets.set(ticket, { keyId: member.record.id, credentialVersion: member.record.credentialVersion ?? 1, person: member.record.person, audience, expiresAt })
    sendJson(response, 200, { ticket, expiresAt, apiUrl: PUBLIC_API_URL })
    return
  }

  if (request.method === 'POST' && route === '/api/sso/consume') {
    const body = await readBody(request)
    const ticketId = String(body.ticket ?? '').trim()
    const audience = String(body.audience ?? '').trim()
    pruneTickets()
    const ticket = tickets.take(ticketId)
    if (!ticket || ticket.expiresAt < Date.now() || ticket.audience !== audience) {
      sendError(response, 401, '登录票据无效或已过期')
      return
    }
    const record = data.keys.find((item) => item.id === ticket.keyId && keyIsActive(item))
    if (!record || ticket.credentialVersion !== (record.credentialVersion ?? 1)) {
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
    if (config.mode === 'ticket' && member.authSource !== 'fastcas') {
      pruneTickets()
      const ticket = randomBytes(24).toString('base64url')
      const expiresAt = Date.now() + TICKET_TTL_MS
      tickets.set(ticket, { keyId: member.record.id, credentialVersion: member.record.credentialVersion ?? 1, person: member.record.person, audience, expiresAt })
      const nextUrl = new URL(target)
      nextUrl.searchParams.set('sso', ticket)
      location = nextUrl.toString()
    }
    const auth = { session: member.sessionId, expiresAt: member.expiresAt }
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
    const body = await readBody(request)
    let serviceTargets
    try { serviceTargets = route === '/api/insight/publish' ? await serviceIngest.targets(request, body, data.keys, accountStore) : null }
    catch (error) { sendError(response, error instanceof ServiceIngestError ? error.status : 502, '服务投递认证失败'); return }
    let targets
    if (serviceTargets) { targets = serviceTargets.targets }
    else {
      const ingestKey = request.headers['x-fastinsight-key'] ?? ''
      if (request.headers.authorization || !process.env.FASTINSIGHT_INGEST_KEY || ingestKey !== process.env.FASTINSIGHT_INGEST_KEY) { sendError(response, 401, 'FastInsight 发布凭证无效'); return }
      const requestedPerson = String(body.person ?? '').trim().toLocaleLowerCase()
      targets = data.keys.filter((record) => keyIsActive(record) && (!requestedPerson || record.person.toLocaleLowerCase() === requestedPerson))
    }
    if (!targets.length) {
      sendError(response, 404, '没有匹配的成员 Key')
      return
    }
    const channel = route.includes('reading') ? 'recentArticles' : 'insightItems'
    const items = normalizeItems([body.item ?? body], route.includes('reading') ? 'FastRead' : 'FastInsight')
    if (serviceTargets) for (const item of items) item.publisherClientId = serviceTargets.clientId
    for (const target of targets) target[channel] = [...items, ...(target[channel] ?? [])].slice(0, 100)
    await persist()
    sendJson(response, 201, { ok: true, deliveredTo: targets.map((target) => target.person) })
    return
  }

  if (request.method === 'GET' && route === '/api/workflow') {
    const member = requireMember(request, response)
    if (!member) return
    sendJson(response, 200, { workflow: workflowView(member.record.workflow) })
    return
  }

  if (request.method === 'POST' && route === '/api/workflow') {
    const member = requireMember(request, response)
    if (!member) return
    try {
      member.record.workflow = normalizeWorkflow(await readBody(request), 'member')
    } catch (error) {
      sendError(response, 400, error.message || '任务列表无效')
      return
    }
    await persist()
    sendJson(response, 201, { workflow: workflowView(member.record.workflow) })
    return
  }

  if (request.method === 'POST' && route === '/api/workflow/complete') {
    const member = requireMember(request, response)
    if (!member) return
    const workflow = member.record.workflow
    if (!workflow?.tasks?.length) {
      sendError(response, 404, '尚未收到任务列表')
      return
    }
    const currentIndex = workflow.tasks.findIndex((task) => !task.completedAt)
    if (currentIndex === -1) {
      sendError(response, 400, '任务列表已全部完成')
      return
    }
    const body = await readBody(request)
    const taskId = String(body.taskId ?? '').trim()
    const current = workflow.tasks[currentIndex]
    if (taskId && taskId !== current.id) {
      sendError(response, 409, '请按任务顺序完成当前功能')
      return
    }
    current.completedAt = new Date().toISOString()
    await persist()
    const view = workflowView(workflow)
    sendJson(response, 200, { workflow: view, nextTask: view.currentTask })
    return
  }

  if (request.method === 'POST' && route === '/api/workflow/publish') {
    const credential = await serviceCredential(request, response, 'workflow:publish')
    if (!credential) return
    const body = await readBody(request)

    // 新协议：FastTask dispatch v1 走 SQLite 流水线，旧的 person 名单协议仍然兼容。
    if (body.schema_version === 'fasttask-dispatch-v1') {
      const decision = credential.legacy ? null : assessService(credential.claims, body, 'workflow:publish')
      if (decision?.status) return sendError(response, decision.status, decision.error)
      let targets
      if (credential.legacy) {
        if (credential.accountId && body.receiver_ref && body.receiver_ref !== credential.accountId) {
          sendError(response, 403, 'FastResearch Key 只能向其绑定账号分发任务')
          return
        }
        targets = accountTargetsByRef(credential.accountId || body.receiver_ref)
      } else {
        const allowed = allowedServiceTargets(credential.claims)
        if (!allowed.targets.includes(String(decision.accountId))) return sendError(response, 403, 'receiver_ref is outside allowed targets')
        targets = accountTargetsByRef(decision.accountId)
      }
      if (!targets.length) {
        sendError(response, 404, '接收账号未找到或无权限')
        return
      }

      const receiverAccountId = accountIdOf(targets[0])
      if (!receiverAccountId) {
        sendError(response, 404, '接收账号映射不存在')
        return
      }

      try {
        const dispatchBody = credential.accountId && !body.receiver_ref
          ? { ...body, receiver_ref: credential.accountId }
          : body
        const result = receiveDispatch(workflowDb, dispatchBody, receiverAccountId)
        // The member workspace reads its compact workflow projection from the
        // account store, while the dispatch API keeps the richer workflow
        // record in SQLite. Mirror the received stages so a Key-authenticated
        // user sees the same FastTask list immediately in the web UI.
        const memberRecord = targets[0]
        const receivedWorkflow = result.workflow
        if (memberRecord && receivedWorkflow) {
          ensureKeyCollections(memberRecord)
          const receivedStages = Array.isArray(receivedWorkflow.stages) ? receivedWorkflow.stages : []
          memberRecord.workflow = {
            id: receivedWorkflow.id,
            title: receivedWorkflow.title,
            source: receivedWorkflow.source ?? 'fasttask',
            receivedAt: receivedWorkflow.receivedAt ?? receivedWorkflow.received_at ?? new Date().toISOString(),
            tasks: receivedStages.map((stage, index) => ({
              id: stage.stageId ?? stage.stage_id ?? stage.id,
              module: stage.module,
              title: stage.title,
              description: stage.description ?? '',
              completedAt: stage.completedAt ?? stage.completed_at ?? (stage.status === 'completed' ? new Date().toISOString() : null),
              position: stage.position ?? index,
            })),
          }
          await persist()
        }
        sendJson(response, result.duplicate ? 200 : 201, {
          ok: true,
          duplicate: result.duplicate,
          receipt: result.receipt,
        })
        return
      } catch (error) {
        sendError(response, error.status ?? 500, error.message ?? '发布失败')
        return
      }
    }

    // 旧协议兼容
    const decision = credential.legacy ? null : assessService(credential.claims, body, 'workflow:publish')
    if (decision?.status) return sendError(response, decision.status, decision.error)
    let targets
    if (credential.legacy) {
      targets = credential.accountId ? accountTargetsByRef(credential.accountId) : matchWorkflowTargets(body.person)
    } else {
      const allowed = allowedServiceTargets(credential.claims)
      if (!allowed.targets.includes(String(decision.accountId))) return sendError(response, 403, 'receiver_ref is outside allowed targets')
      targets = accountTargetsByRef(decision.accountId)
    }
    let workflow
    try {
      workflow = normalizeWorkflow(body, 'api')
    } catch (error) {
      sendError(response, 400, error.message || '任务列表无效')
      return
    }
    if (!targets.length) {
      sendError(response, 404, '没有匹配的成员 Key')
      return
    }
    for (const target of targets) {
      ensureKeyCollections(target)
      target.workflow = {
        ...workflow,
        id: randomBytes(8).toString('hex'),
        tasks: workflow.tasks.map((task) => ({ ...task })),
      }
    }
    await persist()
    sendJson(response, 201, { ok: true, deliveredTo: targets.map((target) => target.person), workflow: workflowView(workflow) })
    return
  }

  if (request.method === 'GET' && route === '/api/workflow/team') {
    const member = requireMember(request, response)
    if (!member) return
    const members = data.keys
      .filter((record) => keyIsActive(record))
      .map((record) => ({
        keyId: record.id,
        person: record.person,
        workflow: workflowView(record.workflow),
      }))
      .sort((left, right) => left.person.localeCompare(right.person, 'zh-CN'))
    sendJson(response, 200, { members, currentKeyId: member.keyId })
    return
  }

  if (request.method === 'POST' && route === '/api/fasttask/tasks') {
    const member = requireMember(request, response)
    if (!member) return
    const accountId = String(member.accountId || accountIdOf(member.record) || '').trim()
    // Once per-account clients are configured, do not fall back to a global
    // credential for an unmapped member. That keeps one FastResearch account
    // from creating tasks under another account's FastTask binding.
    const target = fastTaskClientForAccount(accountId)
    const client = target.client
    if (!client) {
      sendError(response, 503, 'FastTask 服务未配置当前 FastResearch 用户的 Key')
      return
    }
    const body = await readBody(request)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(response, 400, '请求体必须是 JSON 对象')
      return
    }
    // The current FastResearch session supplies the account binding. A caller
    // may choose a goal or task details, but cannot redirect the request.
    if (body.receiver_ref || body.user_id) {
      sendError(response, 403, 'FastResearch 当前 Key 不能指定其他账户')
      return
    }
    try {
      const idempotencyKey = String(request.headers['idempotency-key'] ?? '').trim() || `fastresearch-${member.keyId}-${Date.now()}`
      const result = await client.createTasks(body, idempotencyKey, target.receiverRef)
      sendJson(response, 201, result)
    } catch (error) {
      const status = Number(error?.status)
      sendError(response, status >= 400 && status < 500 ? status : 502, error?.message || 'FastTask 请求失败')
    }
    return
  }

  if (request.method === 'GET' && route === '/api/workflows') {
    const member = requireMember(request, response)
    if (!member) return
    const accountId = member.accountId || accountIdOf(member.record)
    if (!accountId) {
      sendError(response, 400, '账号映射不存在')
      return
    }
    const active = getWorkflowsByAccount(workflowDb, accountId, 'active')
    const queued = getWorkflowsByAccount(workflowDb, accountId, 'queued')
    const completed = getWorkflowsByAccount(workflowDb, accountId, 'completed').slice(0, 10)
    sendJson(response, 200, {
      active: active.map(formatWorkflowView),
      queued: queued.map(formatWorkflowView),
      completed: completed.map(formatWorkflowView),
    })
    return
  }

  if (request.method === 'GET' && route.startsWith('/api/workflows/')) {
    const member = requireMember(request, response)
    if (!member) return
    const workflowId = route.slice('/api/workflows/'.length)
    const accountId = member.accountId || accountIdOf(member.record)
    if (!accountId) {
      sendError(response, 400, '账号映射不存在')
      return
    }
    const workflow = getWorkflowById(workflowDb, workflowId, accountId)
    if (!workflow) {
      sendError(response, 404, '流水线不存在')
      return
    }
    sendJson(response, 200, { workflow: formatWorkflowView(workflow) })
    return
  }

  if (request.method === 'POST' && route.startsWith('/api/workflows/') && route.endsWith('/start')) {
    const member = requireMember(request, response)
    if (!member) return
    const workflowId = route.slice('/api/workflows/'.length, -'/start'.length)
    const accountId = member.accountId || accountIdOf(member.record)
    if (!accountId) {
      sendError(response, 400, '账号映射不存在')
      return
    }
    try {
      const result = startWorkflow(workflowDb, workflowId, accountId)
      sendJson(response, 200, {
        workflow: formatWorkflowView(result.workflow),
        alreadyActive: result.alreadyActive,
      })
      return
    } catch (error) {
      sendError(response, error.status ?? 500, error.message ?? '启动失败')
      return
    }
  }

  if (request.method === 'POST' && route.startsWith('/api/workflows/') && route.includes('/stages/') && route.endsWith('/complete')) {
    const member = requireMember(request, response)
    if (!member) return
    const parts = route.split('/')
    const workflowId = parts[3]
    const stageId = parts[5]
    const accountId = member.accountId || accountIdOf(member.record)
    if (!accountId) {
      sendError(response, 400, '账号映射不存在')
      return
    }
    const body = await readBody(request)
    const operationId = String(body.operation_id ?? randomBytes(12).toString('hex')).slice(0, 80)
    try {
      const result = completeStage(workflowDb, workflowId, stageId, accountId, body, operationId)
      sendJson(response, result.duplicate ? 200 : 201, {
        ok: true,
        duplicate: result.duplicate,
        completion: result.completion,
        workflow: formatWorkflowView(result.workflow),
      })
      return
    } catch (error) {
      sendError(response, error.status ?? 500, error.message ?? '完成失败')
      return
    }
  }

  // FastWrite 集成端点
  if (request.method === 'GET' && route === '/api/fastwrite/projects') {
    const member = requireMember(request, response)
    if (!member) return
    if (!fastWriteClient) {
      sendError(response, 503, 'FastWrite 服务未配置')
      return
    }
    try {
      const result = await fastWriteClient.listProjects()
      sendJson(response, 200, result)
      return
    } catch (error) {
      sendError(response, 500, `获取 FastWrite 项目列表失败: ${error.message}`)
      return
    }
  }

  if (request.method === 'POST' && route === '/api/fastwrite/projects') {
    const member = requireMember(request, response)
    if (!member) return
    if (!fastWriteClient) {
      sendError(response, 503, 'FastWrite 服务未配置')
      return
    }
    try {
      const body = await readBody(request)
      const result = await fastWriteClient.createProject(body.title, {
        venue: body.venue,
        template: body.template,
      })
      sendJson(response, 201, result)
      return
    } catch (error) {
      sendError(response, 500, `创建 FastWrite 项目失败: ${error.message}`)
      return
    }
  }

  if (request.method === 'GET' && route.startsWith('/api/fastwrite/projects/') && !route.includes('/compile')) {
    const member = requireMember(request, response)
    if (!member) return
    if (!fastWriteClient) {
      sendError(response, 503, 'FastWrite 服务未配置')
      return
    }
    const projectId = route.slice('/api/fastwrite/projects/'.length)
    try {
      const result = await fastWriteClient.getProject(projectId)
      sendJson(response, 200, result)
      return
    } catch (error) {
      sendError(response, 404, `获取 FastWrite 项目失败: ${error.message}`)
      return
    }
  }

  if (request.method === 'POST' && route.startsWith('/api/fastwrite/projects/') && route.endsWith('/compile')) {
    const member = requireMember(request, response)
    if (!member) return
    if (!fastWriteClient) {
      sendError(response, 503, 'FastWrite 服务未配置')
      return
    }
    const projectId = route.slice('/api/fastwrite/projects/'.length, -'/compile'.length)
    try {
      const result = await fastWriteClient.compileProject(projectId)
      sendJson(response, 200, result)
      return
    } catch (error) {
      sendError(response, 500, `编译 FastWrite 项目失败: ${error.message}`)
      return
    }
  }

  if (request.method === 'POST' && route === '/api/fastwrite/login-url') {
    const member = requireMember(request, response)
    if (!member) return
    if (!fastWriteClient) {
      sendError(response, 503, 'FastWrite 服务未配置')
      return
    }
    try {
      const body = await readBody(request)
      const projectId = body?.projectId || null
      const accountId = String(accountIdOf(member.record) || member.record.id).trim()
      const loginUrl = await fastWriteClient.generateLoginUrl(projectId, {
        externalAccountId: accountId,
        displayName: member.record.person,
      })
      sendJson(response, 200, {
        url: loginUrl,
        message: '已生成自动登录链接'
      })
      return
    } catch (error) {
      console.error('生成 FastWrite 登录链接失败:', error)
      sendError(response, 500, error.message || '生成登录链接失败')
      return
    }
  }

  if (request.method === 'GET' && route === '/api/fastwrite/status') {
    const member = requireMember(request, response)
    if (!member) return
    const configured = Boolean(fastWriteClient)
    let healthy = false
    if (configured) {
      try {
        healthy = await fastWriteClient.checkHealth()
      } catch {
        healthy = false
      }
    }
    sendJson(response, 200, {
      configured,
      healthy,
      url: process.env.FASTWRITE_PUBLIC_URL || process.env.VITE_WRITE_URL || process.env.FASTWRITE_URL || null,
    })
    return
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && !route.startsWith('/api')) {
    if (await serveStatic(request, response)) return
  }
  sendError(response, 404, '接口不存在')
}

export async function startServer(port = PORT, host = HOST) {
  await loadData()
  const server = createServer((request, response) => {
    requestScope.run(request, async () => {
      try {
        // Parse before entering the queue so a slow upload cannot hold the writer.
        const requestUrl = new URL(request.url, 'http://localhost')
        const proxiedModuleRequest = isFastReadProxyPath(requestUrl.pathname)
        if (proxiedModuleRequest) {
          await handle(request, response)
          return
        }
        if (!proxiedModuleRequest && ['POST','PUT','PATCH','DELETE'].includes(request.method)) {
          if (String(request.headers['content-type'] ?? '').split(';')[0] === 'application/jwt' ||
              (requestUrl.pathname==='/api/auth/fastcas/backchannel-logout' && String(request.headers['content-type'] ?? '').split(';')[0] === 'application/x-www-form-urlencoded')) {
            const chunks = []; let size = 0
            for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error('事件过大'); chunks.push(chunk) }
            request.rawBody = Buffer.concat(chunks).toString('utf8')
          } else request.parsedBody = await readBody(request)
        }
        const operation = requestQueue.then(async () => { reloadData(); await handle(request, response) })
        requestQueue = operation.catch(() => {})
        await operation
      } catch (error) {
        sendError(response, 400, error.message || '请求失败')
      }
    })
  })
  server.on('close', () => {
    if (fastTaskSyncTimer) clearInterval(fastTaskSyncTimer)
    accountStore?.close()
    workflowDb?.close()
  })
  await new Promise((resolve) => server.listen(port, host, resolve))
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer()
  console.log(`FastResearch listening on http://${HOST}:${server.address().port}`)
}
