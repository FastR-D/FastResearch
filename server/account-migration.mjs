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
  const accounts = source.keys.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id || seen.has(record.id)) throw new Error('Missing or duplicate legacy Key ID; migration stopped')
    if (typeof record.keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(record.keyHash)) throw new Error('Invalid legacy credential; migration stopped')
    seen.add(record.id)
    // Identity depends on the stable non-secret record ID, never its name/email/Key.
    const id = 'account_' + createHash('sha256').update('FastResearch:legacy:' + record.id).digest('hex').slice(0,32)
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

export const ACCOUNT_SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE accounts(id TEXT PRIMARY KEY,legacy_key_id TEXT NOT NULL UNIQUE,content TEXT NOT NULL);
CREATE TABLE credentials(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),legacy_key_id TEXT NOT NULL UNIQUE,credential TEXT NOT NULL);
CREATE TABLE migrations(version INTEGER PRIMARY KEY,source_digest TEXT NOT NULL,created_at TEXT NOT NULL);
`;

export function readLegacySnapshot(db) {
  const metadata = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='legacy-root'").get().value)
  const records = db.prepare('SELECT a.content,c.credential FROM accounts a JOIN credentials c ON c.account_id=a.id ORDER BY c.rowid').all()
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
    for (const file of [staging, backup]) {
      const fd = openSync(file, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
    }
    linkSync(staging, destinationPath)
    const directory = openSync(path.dirname(destinationPath), 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
    return { ...plan.report, applied: true, backup, database: destinationPath }
  } finally {
    if (db) db.close()
    if (ownedStaging) unlinkSync(staging)
  }
}
