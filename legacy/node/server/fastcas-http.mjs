import { randomBytes } from 'node:crypto';
import { activeLinkByAccount, fastCASSession, readPending, rememberPending, revokeFastCASSessions } from './account-store.mjs';
import { acceptCallback, acceptEvent, acceptLogout, fastCASConfigured, loadFastCAS, shouldRevalidate } from './fastcas-service.mjs';

const BINDING = 'fr_fastcas_binding';

export function clientEnvironment(publicUrl = '') {
  const origin = String(publicUrl || '').replace(/\/$/, '');
  const explicit = process.env.FASTRESEARCH_FASTCAS_REDIRECT_URI;
  const redirect = explicit == null ? (origin ? origin + '/api/auth/fastcas/callback' : '') : explicit;
  return {
    ...process.env,
    FASTRESEARCH_FASTCAS_REDIRECT_URI: redirect,
  };
}

function clientEnv(ctx) {
  return clientEnvironment(ctx?.publicUrl || '');
}

function configured(ctx) {
  return fastCASConfigured(clientEnv(ctx));
}

async function clientFor(ctx) {
  if (!process.env.FASTRESEARCH_FASTCAS_ISSUER) return null;
  return loadFastCAS(clientEnv(ctx), ctx.transactions);
}

function bindingValue(ctx) {
  const current = ctx.cookies()[BINDING];
  if (current && current.length >= 32) return current;
  return randomBytes(32).toString('base64url');
}

function callbackUrl(ctx) {
  const redirect = new URL(clientEnv(ctx).FASTRESEARCH_FASTCAS_REDIRECT_URI);
  redirect.search = ctx.url.search;
  return redirect;
}

async function begin(ctx, request, response, purpose) {
  const cas = await clientFor(ctx);
  if (!cas) {
    ctx.sendError(response, 404, 'FastCAS 未配置');
    return;
  }
  if (purpose === 'link') {
    const member = await ctx.requireKeyMember(request, response);
    if (!member) return;
    const body = await ctx.readBody(request);
    if (member.source !== 'key' || !ctx.keyMatches(member.record, body.key)) {
      ctx.sendError(response, 401, '需要最近一次个人 Key 证明');
      return;
    }
    ctx.assertSameOrigin(request);
    const binding = bindingValue(ctx);
    const accountId = member.record.accountId;
    const sessionId = ctx.localSessionId(member);
    const url = await cas.beginLink({ browserBinding: binding, localAccountRef: accountId, localSessionId: sessionId, returnTo: '/account' });
    const state = new URL(url).searchParams.get('state');
    rememberPending(ctx.db, { state, accountId, sessionId, purpose, expiresAt: Date.now() + 300_000 });
    const headers = ctx.cookieHeader(BINDING, binding, 600);
    if (ctx.wantsFormRedirect(request)) {
      response.writeHead(303, { Location: url.toString(), 'Cache-Control': 'no-store', ...ctx.cors(request), ...headers });
      response.end();
      return;
    }
    ctx.sendJson(response, 200, { url: url.toString() }, headers);
    return;
  }
  const binding = bindingValue(ctx);
  const requested = ctx.url.searchParams.get('return_to') || '/';
  if (ctx.safeReturnPath(requested) === null) {
    ctx.sendError(response, 400, '返回路径无效');
    return;
  }
  const returnTo = ctx.safeReturnPath(requested) || '/';
  const url = await cas.beginLogin({ browserBinding: binding, returnTo });
  const state = new URL(url).searchParams.get('state');
  rememberPending(ctx.db, { state, accountId: '', sessionId: '', purpose: 'login', expiresAt: Date.now() + 300_000 });
  response.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store', ...ctx.cors(request), ...ctx.cookieHeader(BINDING, binding, 600) });
  response.end();
}

export async function handleFastCAS(request, response, ctx) {
  const { route } = ctx;
  if (request.method === 'GET' && route === '/api/auth/fastcas/available') {
    ctx.sendJson(response, 200, { available: configured(ctx) });
    return true;
  }
  if (!route.startsWith('/api/auth/fastcas') && route !== '/api/auth/me') return false;
  try {
    if (request.method === 'GET' && route === '/api/auth/me') {
      const member = ctx.currentMember(request);
      if (!member) {
        ctx.sendError(response, 401, '成员登录已失效');
        return true;
      }
      ctx.sendJson(response, 200, {
        user_id: member.record.accountId,
        source: member.source,
        person: member.record.person,
        subject: member.subject || '',
        keyId: member.record.id,
      });
      return true;
    }
    if (request.method === 'GET' && route === '/api/auth/fastcas/status') {
      const member = ctx.currentMember(request);
      if (!member) {
        ctx.sendError(response, 401, '成员登录已失效');
        return true;
      }
      const link = activeLinkByAccount(ctx.db, member.record.accountId);
      ctx.sendJson(response, 200, { linked: Boolean(link), subject: link?.subject || '' });
      return true;
    }
    if (request.method === 'GET' && route === '/api/auth/fastcas/login') {
      await begin(ctx, request, response, 'login');
      return true;
    }
    if (request.method === 'POST' && route === '/api/auth/fastcas/link') {
      await begin(ctx, request, response, 'link');
      return true;
    }
    if (request.method === 'GET' && route === '/api/auth/fastcas/callback') {
      await finish(ctx, request, response);
      return true;
    }
    if (request.method === 'POST' && route === '/api/auth/fastcas/unlink') {
      await unlink(ctx, request, response);
      return true;
    }
    if (request.method === 'POST' && route === '/api/auth/fastcas/events') {
      await events(ctx, request, response);
      return true;
    }
    if (request.method === 'POST' && route === '/api/auth/fastcas/backchannel-logout') {
      await logout(ctx, request, response);
      return true;
    }
  } catch (error) {
    if (response.headersSent) return true;
    const status = Number(error?.status) || 400;
    const safe = [400, 401, 403, 404, 409, 503].includes(status) ? status : 400;
    ctx.sendError(response, safe, error?.message || 'FastCAS 请求失败');
    return true;
  }
  return false;
}

async function finish(ctx, request, response) {
  const cas = await clientFor(ctx);
  if (!cas) {
    ctx.sendError(response, 404, 'FastCAS 未配置');
    return;
  }
  const binding = ctx.cookies()[BINDING];
  if (!binding) {
    ctx.sendError(response, 400, '浏览器绑定已失效');
    return;
  }
  const callback = callbackUrl(ctx);
  const state = callback.searchParams.get('state') || '';
  const pending = readPending(ctx.db, state);
  const options = { browserBinding: binding };
  if (pending?.purpose === 'link') {
    options.localAccountRef = pending.account_id;
    options.localSessionId = pending.session_id;
  }
  const result = await cas.finishLogin(callback, options);
  const accepted = await acceptCallback(cas, ctx.db, result);
  const next = spaReturn(result.transaction?.returnTo);
  if (accepted.kind === 'needs_link') {
    response.writeHead(302, { Location: '/?fastcas=needs_link', 'Cache-Control': 'no-store', ...ctx.cors(request) });
    response.end();
    return;
  }
  if (accepted.kind === 'rejected') {
    response.writeHead(302, { Location: '/?fastcas=disabled', 'Cache-Control': 'no-store', ...ctx.cors(request) });
    response.end();
    return;
  }
  if (accepted.kind === 'linked') {
    response.writeHead(302, { Location: '/?fastcas=linked', 'Cache-Control': 'no-store', ...ctx.cors(request) });
    response.end();
    return;
  }
  const record = ctx.findByAccount(accepted.link.local_account_ref || accepted.link.account_id);
  if (!record) {
    response.writeHead(302, { Location: missingAccountLocation(), 'Cache-Control': 'no-store', ...ctx.cors(request) });
    response.end();
    return;
  }
  const auth = ctx.issueSession(record, { source: 'fastcas', subject: accepted.link.subject, sid: result.identity.sessionId || '' });
  response.writeHead(302, {
    Location: next,
    'Cache-Control': 'no-store',
    ...ctx.cors(request),
    ...ctx.memberCookie(request, auth.session, auth.expiresAt),
  });
  response.end();
}

async function unlink(ctx, request, response) {
  const member = await ctx.requireKeyMember(request, response);
  if (!member) return;
  ctx.assertSameOrigin(request);
  const body = await ctx.readBody(request);
  if (member.source !== 'key' || !ctx.keyMatches(member.record, body.key)) {
    ctx.sendError(response, 401, '需要最近一次个人 Key 证明');
    return;
  }
  const link = activeLinkByAccount(ctx.db, member.record.accountId);
  if (!link) {
    ctx.sendJson(response, 200, { ok: true, linked: false });
    return;
  }
  const cas = await clientFor(ctx);
  if (cas) await cas.revokeLink({ id: link.id, version: link.version });
  const { saveLink } = await import('./account-store.mjs');
  saveLink(ctx.db, { id: link.id, local_account_ref: link.account_id, subject: link.subject, state: 'revoked', version: link.version + 1, verified_at: link.verified_at });
  revokeFastCASSessions(ctx.db, { subject: link.subject });
  ctx.sendJson(response, 200, { ok: true, linked: false });
}

async function events(ctx, request, response) {
  if (!process.env.FASTRESEARCH_FASTCAS_ISSUER) {
    ctx.sendError(response, 404, 'FastCAS 未配置');
    return;
  }
  const cas = await clientFor(ctx);
  if (!cas) {
    ctx.sendError(response, 503, 'FastCAS 暂时不可用');
    return;
  }
  const raw = await ctx.readRaw(request);
  const status = await acceptEvent(cas, ctx.db, raw);
  response.writeHead(status, { 'Cache-Control': 'no-store', ...ctx.cors(request) });
  response.end();
}

async function logout(ctx, request, response) {
  if (!process.env.FASTRESEARCH_FASTCAS_ISSUER) {
    ctx.sendError(response, 404, 'FastCAS 未配置');
    return;
  }
  const cas = await clientFor(ctx);
  if (!cas) {
    ctx.sendError(response, 503, 'FastCAS 暂时不可用');
    return;
  }
  const raw = await ctx.readRaw(request);
  const token = new URLSearchParams(raw).get('logout_token') || '';
  try {
    await acceptLogout(cas, ctx.db, token);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
  } catch (error) {
    ctx.sendError(response, error?.status === 401 ? 401 : 503, '退出通知失败');
  }
}

export async function claimsForService(token, audience, scopes, transactions, publicUrl = '') {
  const env = clientEnvironment(publicUrl);
  if (!fastCASConfigured(env)) return null;
  const cas = await loadFastCAS(env, transactions);
  if (!cas) return null;
  return cas.verifyAccessToken(token, audience, scopes);
}

export function missingAccountLocation() {
  return '/?fastcas=needs_link';
}

export { fastCASSession, shouldRevalidate };
function spaReturn(value) {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\r\n]/.test(next)) return '/?fastcas=1';
  const url = new URL(next, 'http://127.0.0.1');
  url.searchParams.set('fastcas', '1');
  return url.pathname + url.search;
}
