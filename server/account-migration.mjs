import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, closeSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const credentialFields = new Set(['id', 'keyHash', 'keyPreview', 'expiresAt', 'revokedAt', 'credentialVersion'])
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
export function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }

export function planAccounts(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Array.isArray(source.keys)) throw new Error('Expected a current access.json object with a keys array')
  const seen = new Set()
  const seenAccountIds = new Set()
  const accounts = source.keys.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id || seen.has(record.id)) throw new Error('Missing or duplicate legacy Key ID; migration stopped')
    if (typeof record.keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(record.keyHash)) throw new Error('Invalid legacy credential; migration stopped')
    seen.add(record.id)
    // Preserve an existing non-secret account ID when present; otherwise derive
    // one from the stable record ID so old snapshots remain deterministic.
    const id = String(record.accountId ?? '').trim() || 'account_' + createHash('sha256').update('FastResearch:legacy:' + record.id).digest('hex').slice(0,32)
    if (seenAccountIds.has(id)) throw new Error('Duplicate account ID; migration stopped')
    seenAccountIds.add(id)
    const content = Object.fromEntries(Object.entries(record).filter(([key]) => !credentialFields.has(key)))
    const credential = Object.fromEntries(Object.entries(record).filter(([key]) => credentialFields.has(key)))
    return { id, legacyKeyId: record.id, content, credential }
  })
  const metadata = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'keys'))
  return { accounts, metadata, sourceDigest: digest(source), report: {
    schema: 1, accounts: accounts.length, credentials: accounts.length,
    mappings: accounts.map(account => ({ accountId: account.id, legacyKeyId: account.legacyKeyId, contentDigest: digest(account.content) })),
  } }
}

function canonicalItem(value) {
  return JSON.stringify(canonical(value))
}

function mergeItems(current, incoming) {
  const result = []
  const seen = new Set()
  for (const item of [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(current) ? current : [])]) {
    const key = canonicalItem(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function newerObject(current, incoming) {
  if (!current || typeof current !== 'object') return incoming ?? current ?? null
  if (!incoming || typeof incoming !== 'object') return current
  const currentTime = Date.parse(current.updatedAt ?? current.receivedAt ?? '')
  const incomingTime = Date.parse(incoming.updatedAt ?? incoming.receivedAt ?? '')
  return Number.isFinite(incomingTime) && (!Number.isFinite(currentTime) || incomingTime >= currentTime) ? incoming : current
}

function mergedContent(current, incoming, accountId) {
  const result = { ...(incoming ?? {}), ...(current ?? {}) }
  result.accountId = accountId
  for (const field of ['recentArticles', 'insightItems', 'followedAuthors', 'customResearchTags', 'inbox']) {
    result[field] = mergeItems(current?.[field], incoming?.[field])
  }
  result.workflow = newerObject(current?.workflow, incoming?.workflow)
  result.researchImpression = newerObject(current?.researchImpression, incoming?.researchImpression)
  return result
}

export function mergeAccounts(sourcePath, destinationPath, { apply = false } = {}) {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
  if (!source || typeof source !== 'object' || !Array.isArray(source.keys)) throw new Error('Expected a current access.json object with a keys array')
  const db = new DatabaseSync(destinationPath)
  try {
    const accountTable = legacyAccountsTable(db)
    const existingRows = db.prepare(`SELECT a.id,a.legacy_key_id,a.content,c.credential FROM ${accountTable} a JOIN credentials c ON c.account_id=a.id`).all()
    const existing = new Map(existingRows.map(row => [row.legacy_key_id, {
      id: row.id,
      content: JSON.parse(row.content),
      credential: JSON.parse(row.credential),
    }]))
    const registry = new Map()
    try {
      for (const row of db.prepare('SELECT id,key_id FROM accounts').all()) registry.set(row.key_id, row.id)
    } catch {
      // A fresh migration database may not have a separate FastCAS registry.
    }
    const ids = new Set(existing.values().map(row => row.id))
    const report = { applied: false, sourceDigest: digest(source), total: source.keys.length, added: [], updated: [], unchanged: [] }
    const records = []
    for (const sourceRecord of source.keys) {
      if (!sourceRecord || typeof sourceRecord !== 'object' || typeof sourceRecord.id !== 'string' || !sourceRecord.id) throw new Error('Missing legacy Key ID; merge stopped')
      if (typeof sourceRecord.keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(sourceRecord.keyHash)) throw new Error('Invalid legacy credential; merge stopped')
      const current = existing.get(sourceRecord.id)
      const accountId = current?.id || registry.get(sourceRecord.id) || String(sourceRecord.accountId ?? '').trim() || 'account_' + createHash('sha256').update('FastResearch:legacy:' + sourceRecord.id).digest('hex').slice(0,32)
      if (ids.has(accountId) && current?.id !== accountId) throw new Error('Duplicate account ID; merge stopped')
      ids.add(accountId)
      const content = mergedContent(current?.content, Object.fromEntries(Object.entries(sourceRecord).filter(([key]) => !credentialFields.has(key))), accountId)
      const credential = current?.credential ?? Object.fromEntries(Object.entries(sourceRecord).filter(([key]) => credentialFields.has(key)))
      const changed = !current || JSON.stringify(current.content) !== JSON.stringify(content) || JSON.stringify(current.credential) !== JSON.stringify(credential)
      records.push({ id: accountId, legacyKeyId: sourceRecord.id, content, credential })
      if (!current) report.added.push(sourceRecord.id)
      else if (changed) report.updated.push(sourceRecord.id)
      else report.unchanged.push(sourceRecord.id)
    }
    if (!apply) return report
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        db.prepare(`INSERT INTO ${accountTable} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET legacy_key_id=excluded.legacy_key_id,content=excluded.content`).run(record.id, record.legacyKeyId, JSON.stringify(record.content))
        db.prepare('INSERT INTO credentials VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,legacy_key_id=excluded.legacy_key_id,credential=excluded.credential').run('key_' + record.legacyKeyId, record.id, record.legacyKeyId, JSON.stringify(record.credential))
        try {
          db.prepare('INSERT INTO accounts(id,key_id,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET key_id=excluded.key_id').run(record.id, record.legacyKeyId, new Date().toISOString())
        } catch {
          // Legacy-only test databases do not have the FastCAS registry table.
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { ...report, applied: true }
  } finally {
    db.close()
  }
}

export const ACCOUNT_SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE accounts(id TEXT PRIMARY KEY,legacy_key_id TEXT NOT NULL UNIQUE,content TEXT NOT NULL);
CREATE TABLE credentials(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),legacy_key_id TEXT NOT NULL UNIQUE,credential TEXT NOT NULL);
CREATE TABLE migrations(version INTEGER PRIMARY KEY,source_digest TEXT NOT NULL,created_at TEXT NOT NULL);
`;

export function legacyAccountsTable(db) {
  for (const name of ['accounts', 'accounts_main_legacy']) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name)
    if (columns.includes('legacy_key_id') && columns.includes('content')) return name
  }
  throw new Error('Legacy account table is missing or has an unsupported schema')
}

export function readLegacySnapshot(db) {
  const metadata = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='legacy-root'").get().value)
  const accountTable = legacyAccountsTable(db)
  const records = db.prepare(`SELECT a.content,c.credential FROM ${accountTable} a JOIN credentials c ON c.account_id=a.id ORDER BY c.rowid`).all()
  return { ...metadata, keys: records.map(row => ({ ...JSON.parse(row.content), ...JSON.parse(row.credential) })) }
}

export function migrateAccounts(sourcePath, destinationPath, { apply = false } = {}) {
  const bytes = readFileSync(sourcePath)
  const source = JSON.parse(bytes.toString('utf8'))
  const plan = planAccounts(source)
  if (!apply) return { ...plan.report, applied: false }
  const staging = destinationPath + '.migration-' + process.pid
  const backup = sourcePath + '.pre-accounts.json'
  let db, ownedStaging = false
  try {
    closeSync(openSync(staging, 'wx', 0o600)); ownedStaging = true
    db = new DatabaseSync(staging)
    db.exec(ACCOUNT_SCHEMA)
    db.exec('BEGIN IMMEDIATE')
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('legacy-root', JSON.stringify(plan.metadata))
    for (const account of plan.accounts) {
      db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(account.id, account.legacyKeyId, JSON.stringify(account.content))
      db.prepare('INSERT INTO credentials VALUES(?,?,?,?)').run('key_'+account.legacyKeyId, account.id, account.legacyKeyId, JSON.stringify(account.credential))
    }
    db.prepare('INSERT INTO migrations VALUES(1,?,?)').run(plan.sourceDigest, new Date().toISOString())
    if (digest(readLegacySnapshot(db)) !== plan.sourceDigest) throw new Error('Content verification failed')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key verification failed')
    db.exec('COMMIT')
    db.close(); db = null
    chmodSync(staging, 0o600)
    // Retain byte-for-byte input. Never overwrite an existing backup or target.
    writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 })
    // Windows refuses fsync on a read-only handle and on a directory handle, so
    // the POSIX durability barrier is applied only where the platform allows it.
    if (process.platform !== 'win32') {
      for (const file of [staging, backup]) {
        const fd = openSync(file, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
      }
      linkSync(staging, destinationPath)
      const directory = openSync(path.dirname(destinationPath), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    } else {
      linkSync(staging, destinationPath)
    }
    return { ...plan.report, applied: true, backup, database: destinationPath }
  } finally {
    if (db) db.close()
    if (ownedStaging) unlinkSync(staging)
  }
}
