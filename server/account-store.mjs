import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync } from 'node:fs'
import { planAccounts, readLegacySnapshot } from './account-migration.mjs'

export class AccountStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename, { open: true })
    chmodSync(filename, 0o600)
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;')
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES('runtime-revision','0')").run()
  }
  close() { this.db.close() }
  load() {
    this.db.exec('BEGIN')
    try {
      const data = readLegacySnapshot(this.db)
      const revision = Number(this.db.prepare("SELECT value FROM metadata WHERE key='runtime-revision'").get().value)
      this.db.exec('COMMIT')
      return { data, revision }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  accountIdForKey(keyId) {
    return this.db.prepare('SELECT account_id FROM credentials WHERE legacy_key_id=?').get(keyId)?.account_id ?? null
  }
  save(data, expectedRevision) {
    const plan = planAccounts(data)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const revision = Number(this.db.prepare("SELECT value FROM metadata WHERE key='runtime-revision'").get().value)
      if (revision !== expectedRevision) throw new Error('账号资料已在另一进程更新，请刷新后重试')
      const ids = new Set(plan.accounts.map(account => account.id))
      if (this.db.prepare('SELECT id FROM accounts').all().some(row => !ids.has(row.id))) throw new Error('删除凭证不能删除本地账号，请使用撤销')
      for (const account of plan.accounts) {
        this.db.prepare('INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content').run(account.id, account.legacyKeyId, JSON.stringify(account.content))
        this.db.prepare('INSERT INTO credentials VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential').run('key_'+account.legacyKeyId, account.id, account.legacyKeyId, JSON.stringify(account.credential))
      }
      this.db.prepare("UPDATE metadata SET value=? WHERE key='legacy-root'").run(JSON.stringify(plan.metadata))
      this.db.prepare("UPDATE metadata SET value=? WHERE key='runtime-revision'").run(String(revision+1))
      this.db.exec('COMMIT')
      return revision+1
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

// Hashed opaque handles for both local sessions and single-use legacy SSO tickets.
// Metadata stays in SQLite; no raw bearer credential is persisted.
export class TokenStore {
  constructor(store, namespace) {
    this.db = store.db; this.namespace = namespace
    this.db.exec(`CREATE TABLE IF NOT EXISTS auth_handles(namespace TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,expires REAL NOT NULL,PRIMARY KEY(namespace,hash));
      CREATE TABLE IF NOT EXISTS auth_revocations(namespace TEXT NOT NULL,hash TEXT NOT NULL,expires REAL NOT NULL,PRIMARY KEY(namespace,hash));`)
  }
  hash(raw) { return createHash('sha256').update(raw).digest('hex') }
  set(raw, value) {
    this.db.prepare('INSERT INTO auth_handles VALUES(?,?,?,?)').run(this.namespace,this.hash(raw),JSON.stringify(value),value.expiresAt)
  }
  get(raw) {
    const row=this.db.prepare('SELECT payload FROM auth_handles WHERE namespace=? AND hash=? AND expires>?').get(this.namespace,this.hash(raw),Date.now())
    return row ? JSON.parse(row.payload) : undefined
  }
  take(raw) {
    // DELETE RETURNING makes consumption atomic across processes.
    const row=this.db.prepare('DELETE FROM auth_handles WHERE namespace=? AND hash=? RETURNING payload,expires').get(this.namespace,this.hash(raw))
    return row && row.expires>Date.now() ? JSON.parse(row.payload) : undefined
  }
  delete(raw) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row=this.db.prepare('DELETE FROM auth_handles WHERE namespace=? AND hash=? RETURNING expires').get(this.namespace,this.hash(raw))
      this.db.prepare('INSERT OR REPLACE INTO auth_revocations VALUES(?,?,?)').run(this.namespace,this.hash(raw),row?.expires ?? Date.now()+24*3600*1000)
      this.db.exec('COMMIT')
    } catch(error){this.db.exec('ROLLBACK');throw error}
  }
  revoked(raw) {
    return Boolean(this.db.prepare('SELECT 1 FROM auth_revocations WHERE namespace=? AND hash=? AND expires>?').get(this.namespace,this.hash(raw),Date.now()))
  }
  prune() {
    this.db.prepare('DELETE FROM auth_handles WHERE expires<=?').run(Date.now())
    this.db.prepare('DELETE FROM auth_revocations WHERE expires<=?').run(Date.now())
  }
}
