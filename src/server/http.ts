// Request/response helpers shared by every API route: JSON, CSRF, rate limits,
// cookies and sessions. Every security decision is made here, on the server.
import type { APIContext, AstroCookieSetOptions } from 'astro';
import { all, one, run } from './db';
import { sha256, token } from './crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-type': 'application/json; charset=utf-8' };
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...NO_STORE, ...headers } });

export const isProd = () => import.meta.env.PROD && process.env.NODE_ENV !== 'test';
export const ip = (ctx: APIContext) => (ctx.request.headers.get('x-forwarded-for')?.split(',')[0].trim() || (() => {
  try {
    return ctx.clientAddress;
  } catch {
    return 'local';
  }
})());

/**
 * CSRF: state-changing requests must come from our own pages. A custom header can't be
 * added by a cross-site form, and a cross-site fetch with it needs a preflight we never allow.
 * The Origin check covers older browsers. Cookies are SameSite=Strict on top of this.
 */
export function assertSameOrigin(ctx: APIContext) {
  const m = ctx.request.method;
  if (m === 'GET' || m === 'HEAD') return;
  if (ctx.request.headers.get('x-primor') !== '1') throw new HttpError(403, 'Solicitud no permitida.');
  const origin = ctx.request.headers.get('origin');
  if (origin && origin !== ctx.url.origin) throw new HttpError(403, 'Solicitud no permitida.');
}

export async function body<T = Record<string, unknown>>(ctx: APIContext, maxBytes = 32_000): Promise<T> {
  const type = ctx.request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Formato no soportado.');
  const text = await ctx.request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'La solicitud es demasiado grande.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

/* ---------------- input validation ---------------- */
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const int = (v: unknown, min = 0, max = 1_000_000_000) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const EMAIL = /^[^\s@<>()[\]\\,;:"?&=#]+@[^\s@<>()[\]\\,;:"?&=#]+\.[^\s@<>()[\]\\,;:"?&=#]{2,}$/;
export const email = (v: unknown) => {
  const e = str(v, 254).toLowerCase();
  return EMAIL.test(e) ? e : '';
};
export const phoneCl = (v: unknown) => {
  const p = str(v, 30);
  if (!p) return '';
  return /^(56)?9\d{8}$/.test(p.replace(/\D/g, '')) ? p : null;
};

/* ---------------- rate limiting (stored in the DB, so it holds across serverless instances) ---------------- */
export async function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  await run('DELETE FROM rate_hits WHERE at < ?', [now - 24 * 3_600_000]);
  const r = await one<{ n: number; first: number }>('SELECT COUNT(*) AS n, MIN(at) AS first FROM rate_hits WHERE key = ? AND at > ?', [key, now - windowMs]);
  const n = Number(r?.n ?? 0);
  if (n >= max) {
    const retry = Math.ceil((Number(r!.first) + windowMs - now) / 1000);
    throw new HttpError(429, `Demasiados intentos. Espera ${Math.max(1, Math.ceil(retry / 60))} min y vuelve a probar.`, { retryAfter: retry });
  }
  await run('INSERT INTO rate_hits(key, at) VALUES (?, ?)', [key, now]);
}
export const clearLimit = (key: string) => run('DELETE FROM rate_hits WHERE key = ?', [key]);

/* ---------------- cookies ---------------- */
// __Host- prefix: the browser only accepts it with Secure, Path=/ and no Domain (no subdomain can set or read it).
export const ADMIN_COOKIE = '__Host-primor_admin';
export const CUSTOMER_COOKIE = '__Host-primor_session';
const cookieOpts = (maxAgeSec: number): AstroCookieSetOptions => ({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: maxAgeSec });

export const ADMIN_IDLE = 30 * 60_000;
export const ADMIN_MAX = 8 * 3_600_000;
const CUSTOMER_MAX = 30 * 24 * 3_600_000;

export async function startAdminSession(ctx: APIContext, mail: string) {
  const t = token();
  const now = Date.now();
  await run('INSERT INTO admin_sessions(token_hash, email, created_at, last_active, ip, ua) VALUES (?, ?, ?, ?, ?, ?)', [sha256(t), mail, now, now, ip(ctx), str(ctx.request.headers.get('user-agent'), 200)]);
  ctx.cookies.set(ADMIN_COOKIE, t, cookieOpts(ADMIN_MAX / 1000));
}

export type TeamMember = { email: string; name: string; role: 'owner' | 'dev'; must_change: number; totp_enabled: number };

/** Returns the signed in team member or throws 401. Idle and absolute timeouts are enforced here. */
export async function requireAdmin(ctx: APIContext, role?: 'dev'): Promise<TeamMember & { sessionHash: string }> {
  const t = ctx.cookies.get(ADMIN_COOKIE)?.value;
  if (!t) throw new HttpError(401, 'Inicia sesión.');
  const h = sha256(t);
  const s = await one<{ email: string; created_at: number; last_active: number }>('SELECT email, created_at, last_active FROM admin_sessions WHERE token_hash = ?', [h]);
  const now = Date.now();
  if (!s || now - Number(s.last_active) > ADMIN_IDLE || now - Number(s.created_at) > ADMIN_MAX) {
    if (s) await run('DELETE FROM admin_sessions WHERE token_hash = ?', [h]);
    ctx.cookies.delete(ADMIN_COOKIE, { path: '/' });
    throw new HttpError(401, 'Tu sesión se cerró por seguridad. Vuelve a entrar.');
  }
  const m = await one<TeamMember & { disabled: number }>('SELECT email, name, role, must_change, totp_enabled, disabled FROM team WHERE email = ?', [s.email]);
  if (!m || m.disabled) {
    await run('DELETE FROM admin_sessions WHERE email = ?', [s.email]);
    throw new HttpError(401, 'Tu acceso fue retirado.');
  }
  if (role === 'dev' && m.role !== 'dev') throw new HttpError(403, 'No tienes permiso para esta acción.');
  if (now - Number(s.last_active) > 60_000) await run('UPDATE admin_sessions SET last_active = ? WHERE token_hash = ?', [now, h]);
  return { ...m, sessionHash: h };
}

export async function endAdminSession(ctx: APIContext) {
  const t = ctx.cookies.get(ADMIN_COOKIE)?.value;
  if (t) await run('DELETE FROM admin_sessions WHERE token_hash = ?', [sha256(t)]);
  ctx.cookies.delete(ADMIN_COOKIE, { path: '/' });
}

export async function startCustomerSession(ctx: APIContext, mail: string) {
  const t = token();
  const now = Date.now();
  await run('INSERT INTO customer_sessions(token_hash, email, created_at, last_active) VALUES (?, ?, ?, ?)', [sha256(t), mail, now, now]);
  ctx.cookies.set(CUSTOMER_COOKIE, t, cookieOpts(CUSTOMER_MAX / 1000));
}
export async function customerEmail(ctx: APIContext): Promise<string | null> {
  const t = ctx.cookies.get(CUSTOMER_COOKIE)?.value;
  if (!t) return null;
  const s = await one<{ email: string; created_at: number }>('SELECT email, created_at FROM customer_sessions WHERE token_hash = ?', [sha256(t)]);
  if (!s || Date.now() - Number(s.created_at) > CUSTOMER_MAX) {
    ctx.cookies.delete(CUSTOMER_COOKIE, { path: '/' });
    return null;
  }
  return s.email;
}
export async function endCustomerSession(ctx: APIContext) {
  const t = ctx.cookies.get(CUSTOMER_COOKIE)?.value;
  if (t) await run('DELETE FROM customer_sessions WHERE token_hash = ?', [sha256(t)]);
  ctx.cookies.delete(CUSTOMER_COOKIE, { path: '/' });
}

/* ---------------- audit log ---------------- */
export async function audit(ctx: APIContext, who: { name: string; role: string }, action: string) {
  await run('INSERT INTO activity(at, who, role, action, ip) VALUES (?, ?, ?, ?, ?)', [Date.now(), who.name, who.role, action.slice(0, 300), ip(ctx)]);
}

export const recentActivity = () => all('SELECT at, who, role, action, ip FROM activity ORDER BY id DESC LIMIT 300');
