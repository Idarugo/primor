// Admin API. Every handler re-checks the session and the role on the server.
import type { APIContext } from 'astro';
import QRCode from 'qrcode';
import { all, bumpVersion, getSetting, one, run, setSetting } from '../db';
import { DUMMY_HASH, hashPassword, newTotpSecret, passwordProblem, sha256, token, totpUri, verifyPassword, verifyTotp } from '../crypto';
import { assertSameOrigin, audit, body, clearLimit, email, endAdminSession, HttpError, int, ip, isProd, json, limit, recentActivity, requireAdmin, startAdminSession, str } from '../http';
import { mailConfigured } from '../mail';
import { byId, overrides } from '../shop';
import { orderOut, STATUS_ORDER } from './public';

const env = (k: string) => (import.meta.env[k] as string | undefined) ?? process.env[k];
const ROLE_LABEL = { owner: 'Dueño', dev: 'Informático' } as const;
const STATUS_LABEL: Record<string, string> = { recibido: 'Recibido', preparacion: 'En preparación', listo: 'Listo para retiro', despacho: 'En despacho', entregado: 'Entregado', cancelado: 'Cancelado' };

/* ---------------- first run: create the first developer ---------------- */
export async function setupStatus() {
  const n = await one<{ n: number }>('SELECT COUNT(*) AS n FROM team');
  return json({ needed: Number(n?.n ?? 0) === 0, tokenConfigured: !!env('ADMIN_SETUP_TOKEN') });
}

export async function setup(ctx: APIContext) {
  assertSameOrigin(ctx);
  await limit(`setup:${ip(ctx)}`, 5, 15 * 60_000);
  const b = await body(ctx);
  const expected = env('ADMIN_SETUP_TOKEN');
  const n = await one<{ n: number }>('SELECT COUNT(*) AS n FROM team');
  if (Number(n?.n ?? 0) > 0) throw new HttpError(409, 'El panel ya fue configurado.');
  if (!expected || expected.length < 24 || str(b.token, 200) !== expected) throw new HttpError(403, 'El código de instalación no es válido.');
  const mail = email(b.email);
  const name = str(b.name, 60);
  const pw = typeof b.password === 'string' ? b.password : '';
  const problem = passwordProblem(pw, mail);
  if (!mail || name.length < 2) throw new HttpError(400, 'Escribe tu nombre y correo.');
  if (problem) throw new HttpError(400, problem);
  await run('INSERT INTO team(email, name, role, password_hash, must_change, created_at) VALUES (?, ?, ?, ?, 0, ?)', [mail, name, 'dev', await hashPassword(pw), Date.now()]);
  await audit(ctx, { name, role: 'dev' }, 'Configuró el panel por primera vez');
  return json({ ok: true });
}

/* ---------------- login: password, then TOTP (enroll on first login) ---------------- */
export async function login(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx);
  const mail = email(b.email);
  const pw = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  await limit(`login-ip:${ip(ctx)}`, 20, 15 * 60_000);
  await limit(`login:${mail || 'x'}`, 5, 15 * 60_000);
  const m = await one<{ email: string; password_hash: string; totp_enabled: number; disabled: number }>('SELECT email, password_hash, totp_enabled, disabled FROM team WHERE email = ?', [mail]);
  // always run the hash, so a missing account takes as long as a wrong password
  const ok = await verifyPassword(pw, m?.password_hash ?? DUMMY_HASH);
  if (!m || m.disabled || !ok) throw new HttpError(401, 'Correo o contraseña incorrectos.');
  const ticket = token();
  const enrolling = !m.totp_enabled;
  const secret = enrolling ? newTotpSecret() : null;
  await run('DELETE FROM login_tickets WHERE email = ? OR expires < ?', [mail, Date.now()]);
  await run('INSERT INTO login_tickets(ticket_hash, email, expires, enrolling_secret) VALUES (?, ?, ?, ?)', [sha256(ticket), mail, Date.now() + 5 * 60_000, secret]);
  if (!enrolling) return json({ step: 'totp', ticket });
  const uri = totpUri(secret!, mail);
  return json({ step: 'enroll', ticket, secret, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200, color: { dark: '#131209', light: '#ffffff' } }) });
}

export async function loginTotp(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx);
  const h = sha256(str(b.ticket, 100));
  const t = await one<{ email: string; expires: number; tries: number; enrolling_secret: string | null }>('SELECT * FROM login_tickets WHERE ticket_hash = ?', [h]);
  if (!t || Date.now() > Number(t.expires)) throw new HttpError(410, 'El paso de verificación venció. Vuelve a ingresar tu contraseña.');
  const m = await one<{ email: string; name: string; role: 'owner' | 'dev'; totp_secret: string | null }>('SELECT email, name, role, totp_secret FROM team WHERE email = ?', [t.email]);
  const secret = t.enrolling_secret ?? m?.totp_secret;
  if (!m || !secret || !verifyTotp(secret, str(b.code, 6))) {
    const tries = Number(t.tries) + 1;
    if (tries >= 5) await run('DELETE FROM login_tickets WHERE ticket_hash = ?', [h]);
    else await run('UPDATE login_tickets SET tries = ? WHERE ticket_hash = ?', [tries, h]);
    throw new HttpError(401, tries >= 5 ? 'Demasiados códigos incorrectos. Vuelve a ingresar tu contraseña.' : 'Código incorrecto. Revisa la hora del teléfono y prueba de nuevo.');
  }
  await run('DELETE FROM login_tickets WHERE ticket_hash = ?', [h]);
  if (t.enrolling_secret) {
    await run('UPDATE team SET totp_secret = ?, totp_enabled = 1 WHERE email = ?', [t.enrolling_secret, m.email]);
    await audit(ctx, m, 'Activó la verificación en dos pasos');
  }
  await clearLimit(`login:${m.email}`);
  await startAdminSession(ctx, m.email);
  await audit(ctx, m, 'Inició sesión en el panel');
  return json({ ok: true });
}

export async function logoutAdmin(ctx: APIContext) {
  assertSameOrigin(ctx);
  try {
    const me = await requireAdmin(ctx);
    await audit(ctx, me, 'Cerró sesión');
  } catch {
    /* already out */
  }
  await endAdminSession(ctx);
  return json({ ok: true });
}

export async function changePassword(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx);
  const b = await body(ctx);
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM team WHERE email = ?', [me.email]);
  if (!row || !(await verifyPassword(String(b.current ?? ''), row.password_hash))) throw new HttpError(401, 'La contraseña actual no es correcta.');
  const next = typeof b.next === 'string' ? b.next : '';
  const problem = passwordProblem(next, me.email);
  if (problem) throw new HttpError(400, problem);
  await run('UPDATE team SET password_hash = ?, must_change = 0 WHERE email = ?', [await hashPassword(next), me.email]);
  // sign out every other device
  await run('DELETE FROM admin_sessions WHERE email = ? AND token_hash != ?', [me.email, me.sessionHash]);
  await audit(ctx, me, 'Cambió su contraseña');
  return json({ ok: true });
}

/* ---------------- data for the panel (filtered by role) ---------------- */
export async function bootstrap(ctx: APIContext) {
  const me = await requireAdmin(ctx);
  const isDev = me.role === 'dev';
  const [orders, customers, messages, ov, announcement, version] = await Promise.all([
    all<Record<string, unknown>>('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500'),
    all<Record<string, unknown>>('SELECT email, name, phone, billing, created_at FROM customers ORDER BY created_at DESC LIMIT 1000'),
    all<Record<string, unknown>>('SELECT * FROM messages ORDER BY at DESC LIMIT 500'),
    overrides(),
    getSetting('announcement', { text: '', href: '', active: false }),
    getSetting<number>('version', 0),
  ]);
  const extra = isDev
    ? {
        team: await all('SELECT email, name, role, totp_enabled, must_change, disabled, created_at FROM team ORDER BY created_at'),
        activity: await recentActivity(),
        system: {
          database: (env('TURSO_DATABASE_URL') ?? 'file:./data/primor.db').replace(/\/\/.*@/, '//***@').split('?')[0],
          email: mailConfigured() ? 'Resend' : 'Sin configurar (consola)',
          production: isProd(),
          counts: Object.fromEntries(
            await Promise.all(['orders', 'customers', 'messages', 'activity', 'admin_sessions', 'customer_sessions'].map(async (t) => [t, Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0)])),
          ),
        },
      }
    : {};
  return json({
    me: { email: me.email, name: me.name, role: me.role, mustChange: !!me.must_change },
    version,
    orders: orders.map((o) => ({ ...orderOut(o), street: o.street ?? undefined, phone: o.phone ?? undefined, notes: o.notes ?? undefined })),
    customers: customers.map((c) => ({ email: c.email, name: c.name, phone: c.phone, billing: JSON.parse(String(c.billing)), createdAt: new Date(Number(c.created_at)).toISOString() })),
    messages: messages.map((m) => ({ ...m, at: new Date(Number(m.at)).toISOString() })),
    overrides: ov,
    announcement,
    ...extra,
  });
}

/* ---------------- business actions (owner + dev) ---------------- */
export async function setOrderStatus(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx);
  const b = await body(ctx);
  const number = str(b.number, 20);
  const status = str(b.status, 20);
  if (!STATUS_ORDER.includes(status)) throw new HttpError(400, 'Estado inválido.');
  const r = await run('UPDATE orders SET status = ? WHERE number = ?', [status, number]);
  if (!r.rowsAffected) throw new HttpError(404, 'Pedido no encontrado.');
  await bumpVersion();
  await audit(ctx, me, `Cambió el pedido ${number} a "${STATUS_LABEL[status]}"`);
  return json({ ok: true });
}

export async function setProduct(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx);
  const b = await body(ctx);
  const id = int(b.id, 1);
  const p = id ? byId.get(id) : undefined;
  if (!p) throw new HttpError(404, 'Producto no encontrado.');
  if (b.reset === true) {
    await run('DELETE FROM product_overrides WHERE id = ?', [id]);
    await bumpVersion();
    await audit(ctx, me, `Restauró ${p.name} a los valores de la tienda`);
    return json({ ok: true });
  }
  const cur = (await overrides())[id!] ?? {};
  const next = { ...cur };
  const changes: string[] = [];
  if ('price' in b) {
    const price = int(b.price, 0, 10_000_000);
    if (price === null) throw new HttpError(400, 'Precio inválido.');
    next.price = price;
    changes.push(`precio a $${price.toLocaleString('es-CL')}`);
  }
  if ('inStock' in b) (next.inStock = b.inStock === true), changes.push(next.inStock ? 'disponible' : 'agotado');
  if ('hidden' in b) (next.hidden = b.hidden === true), changes.push(next.hidden ? 'oculto' : 'visible');
  if ('lowStock' in b) {
    const ls = b.lowStock === null ? null : int(b.lowStock, 0, 100_000);
    if (b.lowStock !== null && ls === null) throw new HttpError(400, 'Stock inválido.');
    next.lowStock = ls;
    changes.push(`stock ${ls ?? 'sin límite'}`);
  }
  await run(
    `INSERT INTO product_overrides(id, price, in_stock, hidden, low_stock, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET price = excluded.price, in_stock = excluded.in_stock, hidden = excluded.hidden, low_stock = excluded.low_stock, updated_at = excluded.updated_at`,
    [id, next.price ?? null, next.inStock === undefined ? null : next.inStock ? 1 : 0, next.hidden === undefined ? null : next.hidden ? 1 : 0, next.lowStock ?? null, Date.now()],
  );
  await bumpVersion();
  await audit(ctx, me, `${p.name}: ${changes.join(', ')}`);
  return json({ ok: true });
}

export async function setMessageStatus(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx);
  const b = await body(ctx);
  const status = str(b.status, 20);
  if (!['nuevo', 'respondido', 'archivado'].includes(status)) throw new HttpError(400, 'Estado inválido.');
  await run('UPDATE messages SET status = ? WHERE ticket = ?', [status, str(b.ticket, 20)]);
  await audit(ctx, me, `Marcó el mensaje ${str(b.ticket, 20)} como ${status}`);
  return json({ ok: true });
}

export async function setAnnouncement(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx);
  const b = await body(ctx);
  const text = str(b.text, 110);
  const href = str(b.href, 300);
  const safe = (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) || /^https:\/\/[^\s]+$/.test(href) ? href : '';
  const a = { text, href: safe, active: b.active === true && !!text };
  await setSetting('announcement', a);
  await bumpVersion();
  await audit(ctx, me, a.active ? `Publicó el aviso "${text}"` : 'Desactivó el aviso del sitio');
  return json({ ok: true });
}

/* ---------------- developer only ---------------- */
export async function addMember(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx, 'dev');
  const b = await body(ctx);
  const mail = email(b.email);
  const name = str(b.name, 60);
  const role = b.role === 'dev' ? 'dev' : 'owner';
  if (!mail || name.length < 2) throw new HttpError(400, 'Escribe nombre y correo.');
  if (await one('SELECT 1 FROM team WHERE email = ?', [mail])) throw new HttpError(409, 'Esa persona ya tiene acceso.');
  // a strong one-time password shown once; the person must change it and set up 2FA on first login
  const temp = `${token(9)}-${token(6)}`;
  await run('INSERT INTO team(email, name, role, password_hash, must_change, created_at) VALUES (?, ?, ?, ?, 1, ?)', [mail, name, role, await hashPassword(temp), Date.now()]);
  await audit(ctx, me, `Dio acceso a ${name} como ${ROLE_LABEL[role]}`);
  return json({ ok: true, tempPassword: temp });
}

async function devCount() {
  return Number((await one<{ n: number }>("SELECT COUNT(*) AS n FROM team WHERE role = 'dev' AND disabled = 0"))?.n ?? 0);
}

export async function updateMember(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx, 'dev');
  const b = await body(ctx);
  const mail = email(b.email);
  const m = await one<{ name: string; role: 'owner' | 'dev' }>('SELECT name, role FROM team WHERE email = ?', [mail]);
  if (!m) throw new HttpError(404, 'Persona no encontrada.');
  const lastDev = m.role === 'dev' && (await devCount()) <= 1;
  if (b.action === 'remove') {
    if (mail === me.email) throw new HttpError(400, 'No puedes quitarte el acceso a ti mismo.');
    if (lastDev) throw new HttpError(400, 'Debe quedar al menos un informático.');
    await run('DELETE FROM team WHERE email = ?', [mail]);
    await run('DELETE FROM admin_sessions WHERE email = ?', [mail]);
    await audit(ctx, me, `Quitó el acceso de ${m.name}`);
  } else if (b.action === 'role') {
    const role = b.role === 'dev' ? 'dev' : 'owner';
    if (lastDev && role !== 'dev') throw new HttpError(400, 'Debe quedar al menos un informático.');
    await run('UPDATE team SET role = ? WHERE email = ?', [role, mail]);
    await audit(ctx, me, `Cambió el rol de ${m.name} a ${ROLE_LABEL[role]}`);
  } else if (b.action === 'reset2fa') {
    await run('UPDATE team SET totp_enabled = 0, totp_secret = NULL WHERE email = ?', [mail]);
    await run('DELETE FROM admin_sessions WHERE email = ?', [mail]);
    await audit(ctx, me, `Reinició la verificación en dos pasos de ${m.name}`);
  } else if (b.action === 'signout') {
    await run('DELETE FROM admin_sessions WHERE email = ?', [mail]);
    await audit(ctx, me, `Cerró todas las sesiones de ${m.name}`);
  } else throw new HttpError(400, 'Acción inválida.');
  return json({ ok: true });
}

export async function exportAll(ctx: APIContext) {
  const me = await requireAdmin(ctx, 'dev');
  const tables = ['orders', 'customers', 'messages', 'product_overrides', 'settings', 'activity'];
  const data = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await all(`SELECT * FROM ${t}`)])));
  await audit(ctx, me, 'Descargó un respaldo');
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="primor-respaldo-${new Date().toISOString().slice(0, 10)}.json"`, 'cache-control': 'no-store' },
  });
}

/** Sample orders/customers/messages for demos. Disabled in production. */
export async function seed(ctx: APIContext) {
  assertSameOrigin(ctx);
  const me = await requireAdmin(ctx, 'dev');
  if (isProd()) throw new HttpError(403, 'Los datos de ejemplo no se cargan en producción.');
  const names = ['Camila Rojas', 'Rosa Muñoz', 'Jorge Pérez', 'Valentina Soto', 'Matías González', 'Daniela Fuentes', 'Ignacio Vera'];
  const comunas = ['Rancagua', 'Machalí', 'Graneros', 'Rengo', 'San Fernando'];
  const statuses = ['entregado', 'entregado', 'listo', 'preparacion', 'recibido', 'despacho', 'entregado', 'cancelado'];
  const everyday = [...byId.values()].filter((p) => p.inStock && p.price <= 16_000);
  const now = Date.now();
  for (const [i, n] of names.entries()) {
    const mail = `${n.split(' ')[0].toLowerCase()}@ejemplo.cl`;
    await run('INSERT OR IGNORE INTO customers(email, name, phone, promos, created_at) VALUES (?, ?, ?, ?, ?)', [mail, n, `+56 9 ${5000 + i * 111} ${1000 + i * 37}`, i % 2, now - (60 - i * 7) * 86_400_000]);
  }
  for (let i = 0; i < 24; i++) {
    const lines = Array.from({ length: 1 + (i % 3) }, (_, j) => {
      const p = everyday[(i * 5 + j * 3) % everyday.length];
      return { id: p.id, slug: p.slug, name: p.name.replace(/\s+Primor\b/i, ''), format: '', price: p.price, qty: 1 + ((i + j) % 2), img: `/box/${p.id}.webp`, max: 99 };
    });
    const n = names[i % names.length];
    const ship = i % 3 === 1;
    await run(
      `INSERT OR IGNORE INTO orders(number, email, first_name, created_at, lines, subtotal, delivery, comuna, payment, document, status, access_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`PR-DEMO${String(i + 1).padStart(2, '0')}`, `${n.split(' ')[0].toLowerCase()}@ejemplo.cl`, n.split(' ')[0], now - (i % 14) * 86_400_000 - ((i * 37) % 9) * 3_600_000, JSON.stringify(lines), lines.reduce((s, l) => s + l.qty * l.price, 0), ship ? 'despacho' : 'retiro', ship ? comunas[i % comunas.length] : null, i % 4 === 3 ? 'Transferencia' : 'Webpay', i % 6 === 5 ? 'Factura a 76.123.456-0' : 'Boleta', statuses[i % statuses.length], sha256(token())],
    );
  }
  const msgs = [
    ['CT-DEMO1', 'negocio', 'Rosa Muñoz', 'rosa@ejemplo.cl', 'Rengo', 'Almacén Doña Rosa', 'Entre 5 y 20 cajas', 'Quiero vender papas hilo y ramitas en mi almacén. ¿Qué condiciones tienen?', 5],
    ['CT-DEMO2', 'comuna', 'Jorge Pérez', 'jorge@ejemplo.cl', 'Pichilemu', null, null, '¿Despachan a Pichilemu?', 24],
    ['CT-DEMO3', 'personal', 'Valentina Soto', 'valentina@ejemplo.cl', null, null, null, '¿Cuándo vuelven las ramitas de jamón serrano?', 72],
  ] as const;
  for (const m of msgs) await run('INSERT OR IGNORE INTO messages(ticket, topic, name, email, comuna, business, volume, message, at) VALUES (?,?,?,?,?,?,?,?,?)', [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], now - m[8] * 3_600_000]);
  await bumpVersion();
  await audit(ctx, me, 'Cargó datos de ejemplo');
  return json({ ok: true });
}
