import { activeLinkBySubject, applyNotification, identityDisabled, revokeFastCASSessions, saveLink } from './account-store.mjs';
import { createReplayStore } from './fastcas-store.mjs';

export const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

export function shouldRevalidate(checkedAt, now, enabled) {
  if (!enabled) return false;
  return now - Number(checkedAt || 0) >= REVALIDATE_INTERVAL_MS;
}

/** Finish a callback without creating or merging an account by email or name. */
export async function acceptCallback(client, db, result) {
  const subject = result?.identity?.subject || '';
  if (db && identityDisabled(db, subject)) return { kind: 'rejected' };
  const purpose = result?.transaction?.purpose;
  if (purpose === 'register') return { kind: 'needs_link' };
  if (purpose === 'link') {
    const prepared = await client.prepareLink(result);
    saveLink(db, prepared);
    const active = await client.activateLink(prepared.id);
    saveLink(db, active);
    return { kind: 'linked', link: active };
  }
  let link;
  try {
    link = await client.resolveLink(result.identity.subject);
  } catch {
    return { kind: 'needs_link' };
  }
  if (!link || link.state !== 'active' || !link.local_account_ref) return { kind: 'needs_link' };
  const local = activeLinkBySubject(db, result.identity.subject);
  if (!local || local.account_id !== link.local_account_ref || local.state !== 'active') return { kind: 'needs_link' };
  return { kind: 'login', link: local };
}

export async function acceptEvent(client, db, raw) {
  try {
    await client.handleNotification(raw, async (event) => {
      applyNotification(db, event);
    });
    return 204;
  } catch (error) {
    return error?.status === 401 ? 401 : 503;
  }
}

export async function acceptLogout(client, db, raw) {
  const replay = createReplayStore(db);
  const result = await client.handleLogout(raw, replay);
  if (result.sessionId) revokeFastCASSessions(db, { subject: result.subject, sid: result.sessionId });
  else revokeFastCASSessions(db, { subject: result.subject });
  return result;
}

export async function revalidateFastCASSession(client, db, session) {
  if (session?.source !== 'fastcas') return { ok: true, skipped: true };
  if (!db || identityDisabled(db, session.subject)) {
    if (db && session?.jti) revokeFastCASSessions(db, { jti: session.jti });
    return { ok: false };
  }
  if (!client) return { ok: true, skipped: true };
  try {
    const link = await client.resolveLink(session.subject);
    if (!link || link.state !== 'active' || link.local_account_ref !== session.accountId) {
      revokeFastCASSessions(db, { jti: session.jti });
      return { ok: false };
    }
    db.prepare('UPDATE sessions SET checked_at = ? WHERE jti = ?').run(Date.now(), session.jti);
    return { ok: true };
  } catch {
    return { ok: true, unreachable: true };
  }
}

export function fastCASConfigured(env = process.env) {
  return Boolean(env.FASTRESEARCH_FASTCAS_ISSUER && env.FASTRESEARCH_FASTCAS_CLIENT_ID && env.FASTRESEARCH_FASTCAS_CLIENT_SECRET && env.FASTRESEARCH_FASTCAS_REDIRECT_URI);
}

let loaded;
export function loadFastCAS(env, transactions) {
  if (!env.FASTRESEARCH_FASTCAS_ISSUER) return Promise.resolve(null);
  if (!fastCASConfigured(env)) return Promise.resolve(null);
  if (!loaded) {
    const specifier = env.FASTCAS_SDK || new URL('../../FastCAS/sdk/typescript/dist/server.js', import.meta.url).href;
    loaded = import(specifier).then(({ FastCAS }) => new FastCAS({
      issuer: env.FASTRESEARCH_FASTCAS_ISSUER,
      clientId: env.FASTRESEARCH_FASTCAS_CLIENT_ID,
      clientSecret: env.FASTRESEARCH_FASTCAS_CLIENT_SECRET,
      redirectUri: env.FASTRESEARCH_FASTCAS_REDIRECT_URI,
      allowLoopbackHTTP: env.FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP === 'true',
    }, transactions));
  }
  return loaded;
}

export function resetFastCASForTests() {
  loaded = undefined;
}
