import { fastCASSession, identityDisabled } from './account-store.mjs';

export function sessionSource(payload) {
  return payload?.source || 'key';
}

/** Old Key JWTs have no source and are not revocable FastCAS sessions. */
export function classifyMember(payload, db, now = Date.now()) {
  if (!payload || payload.role !== 'member' || !payload.keyId) return null;
  if (payload.exp && payload.exp * 1000 < now) return null;
  const source = sessionSource(payload);
  if (source === 'fastcas') {
    if (!db) return null;
    const row = fastCASSession(db, payload.jti);
    if (!row || row.account_id !== payload.accountId) return null;
    if (identityDisabled(db, payload.subject || row.subject)) return null;
  }
  return {
    role: 'member',
    keyId: payload.keyId,
    person: payload.person,
    accountId: payload.accountId,
    source,
    subject: payload.subject || '',
    sid: payload.sid || '',
    jti: payload.jti || '',
    expiresAt: payload.exp ? payload.exp * 1000 : 0,
  };
}

export function memberClaims(record, extra = {}) {
  const source = extra.source || 'key';
  return {
    role: 'member',
    keyId: record.id,
    person: record.person,
    accountId: record.accountId,
    source,
    subject: source === 'fastcas' ? (extra.subject || '') : '',
    sid: source === 'fastcas' ? (extra.sid || '') : '',
    jti: extra.jti,
  };
}

export function safeReturnPath(value) {
  const next = String(value ?? '');
  if (!next) return '';
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\r\n]/.test(next)) return null;
  return next;
}