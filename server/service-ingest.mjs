function scopesOf(claims) {
  return new Set(String(claims?.scope ?? '').split(' ').filter(Boolean));
}

/** Service tokens name a local account. A display name is not a receiver. */
export function assessService(claims, body, scope) {
  if (claims?.token_use && claims.token_use !== 'access') return { status: 401, error: 'API access token required' };
  if (!scopesOf(claims).has(scope)) return { status: 403, error: 'Required permission missing' };
  const ref = String(body?.receiver_ref ?? '').trim();
  if (!ref) return { status: 400, error: 'receiver_ref required' };
  if (!claims?.sub) return { status: 401, error: 'subject required' };
  return { accountId: ref, subject: claims.sub };
}

export function assessInsight(claims, body) {
  return assessService(claims, body, 'insight:publish');
}

export function assessRead(claims) {
  if (claims?.token_use && claims.token_use !== 'access') return { status: 401, error: 'API access token required' };
  if (!scopesOf(claims).has('research:read')) return { status: 403, error: 'Required permission missing' };
  if (!claims?.sub) return { status: 401, error: 'subject required' };
  return { subject: claims.sub };
}

/** Legacy ingest keys still match a display name. An empty name reaches every active record. */
export function legacyPersonTargets(records, person, isActive = () => true) {
  const requested = String(person ?? '').trim().toLocaleLowerCase();
  return (records ?? []).filter((record) => isActive(record) && (!requested || String(record.person ?? '').toLocaleLowerCase() === requested));
}

export function accountTargets(receiverRef, accountDb) {
  // 简化版：直接返回 receiver_ref 作为 accountId
  return [{ accountId: receiverRef }];
}

/** CAS workflow delivery must name an account that the caller explicitly allowed. */
export function serviceWorkflowTargets(records, decision, allowed, isActive = () => true) {
  if (!decision || decision.status) return decision;
  const names = Array.isArray(allowed?.targets) ? allowed.targets.map((item) => String(item)) : [];
  if (!names.includes(String(decision.accountId))) {
    return { status: 403, error: 'receiver_ref is outside allowed targets' };
  }
  return accountTargets(records, decision, isActive);
}
