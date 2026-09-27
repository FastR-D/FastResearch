import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openAccountStore(file) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      key_id TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      jti TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      source TEXT NOT NULL,
      subject TEXT,
      sid TEXT,
      expires_at INTEGER NOT NULL,
      checked_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS identity_status (
      subject TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fastcas_transactions (
      state TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_auth (
      state TEXT PRIMARY KEY,
      account_id TEXT,
      session_id TEXT,
      purpose TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS replay (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

export function assignAccountIds(keys, db, createId) {
  let changed = false;
  const find = db.prepare('SELECT id FROM accounts WHERE key_id = ?');
  const upsert = db.prepare(`INSERT INTO accounts(id, key_id, created_at) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET key_id = excluded.key_id`);
  for (const record of keys) {
    const existing = record.id ? find.get(record.id) : undefined;
    if (!record.accountId) {
      record.accountId = existing?.id ?? createId();
      changed = true;
    }
    upsert.run(record.accountId, record.id, new Date().toISOString());
  }
  return changed;
}

export function saveLink(db, link) {
  const current = db.prepare('SELECT id, version, state FROM links WHERE id = ?').get(link.id);
  if (current && link.version < current.version) return current;
  db.prepare(`INSERT INTO links(id, account_id, subject, state, version, verified_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id,
      subject = excluded.subject,
      state = excluded.state,
      version = excluded.version,
      verified_at = excluded.verified_at`).run(
    link.id,
    link.local_account_ref,
    link.subject,
    link.state,
    link.version,
    link.verified_at ?? '',
  );
  return db.prepare('SELECT * FROM links WHERE id = ?').get(link.id);
}

export function activeLinkBySubject(db, subject) {
  return db.prepare(`SELECT * FROM links WHERE subject = ? AND state = 'active' ORDER BY version DESC LIMIT 1`).get(subject);
}

export function activeLinkByAccount(db, accountId) {
  return db.prepare(`SELECT * FROM links WHERE account_id = ? AND state = 'active' ORDER BY version DESC LIMIT 1`).get(accountId);
}

export function saveFastCASSession(db, session) {
  db.prepare(`INSERT INTO sessions(jti, account_id, source, subject, sid, expires_at, checked_at)
    VALUES(?, ?, 'fastcas', ?, ?, ?, ?)
    ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at, sid = excluded.sid`).run(
    session.jti,
    session.accountId,
    session.subject ?? '',
    session.sid ?? '',
    session.expiresAt,
    session.checkedAt ?? Date.now(),
  );
}

export function fastCASSession(db, jti) {
  if (!jti) return undefined;
  const row = db.prepare(`SELECT * FROM sessions WHERE jti = ? AND source = 'fastcas'`).get(jti);
  if (!row || row.expires_at <= Date.now()) return undefined;
  return row;
}

export function revokeFastCASSessions(db, { subject, sid, jti } = {}) {
  if (jti) {
    db.prepare(`DELETE FROM sessions WHERE source = 'fastcas' AND jti = ?`).run(jti);
    return;
  }
  if (sid) {
    db.prepare(`DELETE FROM sessions WHERE source = 'fastcas' AND subject = ? AND sid = ?`).run(subject, sid);
    return;
  }
  if (subject) db.prepare(`DELETE FROM sessions WHERE source = 'fastcas' AND subject = ?`).run(subject);
}

export function rememberPending(db, pending) {
  db.prepare(`INSERT INTO pending_auth(state, account_id, session_id, purpose, expires_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(state) DO UPDATE SET account_id = excluded.account_id, session_id = excluded.session_id, purpose = excluded.purpose, expires_at = excluded.expires_at`).run(
    pending.state,
    pending.accountId ?? '',
    pending.sessionId ?? '',
    pending.purpose,
    pending.expiresAt,
  );
}

export function readPending(db, state) {
  const row = db.prepare('SELECT * FROM pending_auth WHERE state = ?').get(state);
  if (!row || row.expires_at <= Date.now()) return undefined;
  return row;
}

export function applyNotification(db, event) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const seen = db.prepare('SELECT id FROM replay WHERE id = ?').get(event.id);
    if (seen) {
      db.exec('COMMIT');
      return { duplicate: true };
    }
    db.prepare('INSERT INTO replay(id, expires_at) VALUES(?, ?)').run(event.id, Date.now() + 24 * 60 * 60 * 1000);
    if (event.type === 'account_link.revoked') {
      const link = event.link ?? {};
      const current = db.prepare('SELECT * FROM links WHERE id = ?').get(link.id);
      if (current && link.version >= current.version && current.subject === link.subject && current.account_id === link.local_account_ref) {
        db.prepare(`UPDATE links SET state = 'revoked', version = ? WHERE id = ?`).run(link.version, current.id);
        db.prepare(`DELETE FROM sessions WHERE source = 'fastcas' AND subject = ?`).run(link.subject);
      }
    } else if (event.type === 'identity.status_changed') {
      const current = db.prepare('SELECT version FROM identity_status WHERE subject = ?').get(event.subject);
      if (!current || event.version > current.version) {
        db.prepare(`INSERT INTO identity_status(subject, status, version) VALUES(?, ?, ?)
          ON CONFLICT(subject) DO UPDATE SET status = excluded.status, version = excluded.version`).run(event.subject, event.status, event.version);
        if (event.status === 'disabled') {
          db.prepare(`DELETE FROM sessions WHERE source = 'fastcas' AND subject = ?`).run(event.subject);
        }
      }
    } else {
      throw Object.assign(new Error('unsupported event'), { status: 401 });
    }
    db.exec('COMMIT');
    return { duplicate: false };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function identityDisabled(db, subject) {
  if (!subject) return false;
  const row = db.prepare('SELECT status FROM identity_status WHERE subject = ?').get(subject);
  return row?.status === 'disabled';
}
