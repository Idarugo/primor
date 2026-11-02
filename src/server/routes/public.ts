// Public API: live state, contact form, orders and customer accounts.
import type { APIContext } from 'astro';
import { all, getSetting, getVersion, one, run } from '../db';
import { randomDigits, safeEqual, sha256, token } from '../crypto';
import { assertSameOrigin, body, customerEmail, email, endCustomerSession, HttpError, int, ip, json, limit, phoneCl, startCustomerSession, str } from '../http';
import { sendMail, showDevCodes } from '../mail';
import { overrides, priceLines } from '../shop';

const safeImg = (v: unknown) => (typeof v === 'string' && /^\/(_astro|box|img)\/[\w.\-]+$/.test(v) ? v : '');

/* ---------- live state every page polls ---------- */
export async function state() {
  const [version, ov, announcement] = await Promise.all([getVersion(), overrides(), getSetting('announcement', { text: '', href: '', active: false })]);
  return json({ version, overrides: ov, announcement });
}

/* ---------- contact ---------- */
const TOPICS = ['personal', 'negocio', 'foodservice', 'comuna'];
export async function contact(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx);
  if (str(b.website)) return json({ ok: true }); // honeypot: pretend success
  const mail = email(b.email);
  const topic = TOPICS.includes(str(b.topic)) ? str(b.topic) : 'personal';
  const name = str(b.name, 80);
  const message = str(b.message, 800);
  const phone = phoneCl(b.phone);
  if (name.length < 2 || !mail || message.length < 10 || phone === null) throw new HttpError(400, 'Revisa los datos del formulario.');
  await limit(`contact:${ip(ctx)}`, 5, 10 * 60_000);
  await limit(`contact:${mail}`, 3, 10 * 60_000);
  const ticket = `CT-${sha256(token()).slice(0, 8).toUpperCase()}`;
  await run('INSERT INTO messages(ticket, topic, name, email, phone, comuna, business, volume, message, at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
    ticket, topic, name, mail, phone || null, str(b.comuna, 60) || null, str(b.business, 80) || null, str(b.volume, 40) || null, message, Date.now(),
  ]);
  return json({ ok: true, ticket });
}

/* ---------- orders ---------- */
const STATUS_ORDER = ['recibido', 'preparacion', 'listo', 'despacho', 'entregado', 'cancelado'];
const orderOut = (o: Record<string, unknown>) => ({
  number: o.number,
  createdAt: new Date(Number(o.created_at)).toISOString(),
  lines: JSON.parse(String(o.lines)),
  subtotal: Number(o.subtotal),
  delivery: o.delivery,
  comuna: o.comuna ?? undefined,
  payment: o.payment,
  document: o.document,
  firstName: o.first_name,
  email: o.email,
  status: o.status,
});

export async function createOrder(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx, 64_000);
  const sessionMail = await customerEmail(ctx);
  const mail = sessionMail ?? email(b.email);
  const name = str(b.name, 80);
  const phone = phoneCl(b.phone);
  const delivery = b.delivery === 'despacho' ? 'despacho' : 'retiro';
  const street = str(b.street, 120);
  const comuna = str(b.comuna, 60);
  const doc = b.doc === 'factura' ? 'factura' : 'boleta';
  const payment = b.payment === 'Transferencia' ? 'Transferencia' : 'Webpay';
  if (!mail || name.split(/\s+/).length < 2 || !phone) throw new HttpError(400, 'Revisa tus datos de contacto.');
  if (delivery === 'despacho' && (street.length < 5 || comuna.length < 3)) throw new HttpError(400, 'Falta la dirección de despacho.');
  let document = 'Boleta';
  if (doc === 'factura') {
    const rut = str(b.rut, 20);
    if (!validRut(rut) || str(b.razon, 120).length < 3 || str(b.giro, 120).length < 3) throw new HttpError(400, 'Revisa los datos de la factura.');
    document = `Factura a ${formatRut(rut)}`;
  }
  await limit(`order:${ip(ctx)}`, 10, 10 * 60_000);

  const imgs = new Map<number, string>();
  if (Array.isArray(b.lines)) for (const l of b.lines as { id?: unknown; img?: unknown }[]) imgs.set(Number(l?.id), safeImg(l?.img));
  const { lines, subtotal } = await priceLines(b.lines, (id) => imgs.get(id) ?? '');

  const number = `PR-${sha256(token()).slice(0, 8).toUpperCase()}`;
  const access = token(24);
  await run(
    `INSERT INTO orders(number, email, first_name, created_at, lines, subtotal, delivery, comuna, street, notes, phone, payment, document, access_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [number, mail, name.split(/\s+/)[0], Date.now(), JSON.stringify(lines), subtotal, delivery, delivery === 'despacho' ? comuna : null, delivery === 'despacho' ? street : null, str(b.notes, 200) || null, phone, payment, document, sha256(access)],
  );
  return json({ ok: true, number, access, subtotal, lines });
}

export async function getOrder(ctx: APIContext, number: string) {
  const o = await one('SELECT * FROM orders WHERE number = ?', [str(number, 20)]);
  const t = ctx.url.searchParams.get('t') ?? '';
  const mine = (await customerEmail(ctx)) === o?.email;
  // a guest needs the private link token; we answer the same way for "missing" and "not yours"
  if (!o || !(mine || (t && safeEqual(sha256(t), String(o.access_hash))))) throw new HttpError(404, 'No encontramos ese pedido.');
  return json(orderOut(o));
}

/* ---------- customer accounts (passwordless, email code) ---------- */
export async function requestCode(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx);
  const mail = email(b.email);
  if (!mail) throw new HttpError(400, 'Revisa el correo.');
  const mode = b.mode === 'registro' ? 'registro' : 'ingresar';
  await limit(`code-ip:${ip(ctx)}`, 10, 10 * 60_000);
  await limit(`code:${mail}`, 3, 10 * 60_000);
  const exists = !!(await one('SELECT 1 FROM customers WHERE email = ?', [mail]));
  if (mode === 'ingresar' && !exists) throw new HttpError(404, 'No encontramos una cuenta con ese correo. Crea una en la otra pestaña.');
  if (mode === 'registro' && exists) throw new HttpError(409, 'Ya existe una cuenta con ese correo. Ingresa desde la otra pestaña.');
  let signup: string | null = null;
  if (mode === 'registro') {
    const name = `${str(b.first, 40)} ${str(b.last, 40)}`.trim();
    const phone = phoneCl(b.phone);
    if (name.length < 4 || phone === null || b.terms !== true) throw new HttpError(400, 'Revisa los datos del registro.');
    signup = JSON.stringify({ name, phone, promos: b.promos === true });
  }
  const code = randomDigits(6);
  await run(
    `INSERT INTO login_codes(email, code_hash, expires, tries, signup) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, tries = 0, signup = excluded.signup`,
    [mail, sha256(`${mail}:${code}`), Date.now() + 10 * 60_000, signup],
  );
  await sendMail(mail, `Tu código Primor: ${code}`, `Tu código para entrar a Primor es ${code}.\nVence en 10 minutos. Si no lo pediste, ignora este correo.`);
  return json({ ok: true, ...(showDevCodes() ? { devCode: code } : {}) });
}

export async function verifyCode(ctx: APIContext) {
  assertSameOrigin(ctx);
  const b = await body(ctx);
  const mail = email(b.email);
  const code = str(b.code, 6);
  const row = await one<{ code_hash: string; expires: number; tries: number; signup: string | null }>('SELECT * FROM login_codes WHERE email = ?', [mail]);
  if (!row || Date.now() > Number(row.expires)) throw new HttpError(410, 'El código venció. Vuelve atrás y pide uno nuevo.');
  if (!safeEqual(sha256(`${mail}:${code}`), row.code_hash)) {
    const tries = Number(row.tries) + 1;
    if (tries >= 5) {
      await run('DELETE FROM login_codes WHERE email = ?', [mail]);
      throw new HttpError(423, 'Demasiados intentos con ese código. Por seguridad lo anulamos: vuelve atrás y pide uno nuevo.');
    }
    await run('UPDATE login_codes SET tries = ? WHERE email = ?', [tries, mail]);
    throw new HttpError(401, 'Ese código no coincide. Revisa los 6 dígitos.');
  }
  await run('DELETE FROM login_codes WHERE email = ?', [mail]);
  if (row.signup) {
    const s = JSON.parse(row.signup) as { name: string; phone: string; promos: boolean };
    await run('INSERT OR IGNORE INTO customers(email, name, phone, promos, created_at) VALUES (?, ?, ?, ?, ?)', [mail, s.name, s.phone, s.promos ? 1 : 0, Date.now()]);
  }
  await startCustomerSession(ctx, mail);
  return json({ ok: true });
}

export async function me(ctx: APIContext) {
  const mail = await customerEmail(ctx);
  if (!mail) return json({ user: null });
  const c = await one<Record<string, unknown>>('SELECT * FROM customers WHERE email = ?', [mail]);
  if (!c) return json({ user: null });
  const orders = (await all<Record<string, unknown>>('SELECT * FROM orders WHERE email = ? ORDER BY created_at DESC LIMIT 100', [mail])).map(orderOut);
  return json({
    user: {
      email: mail,
      name: c.name,
      phone: c.phone,
      promos: !!c.promos,
      billing: { type: 'boleta', rut: '', razon: '', giro: '', direccion: '', ...JSON.parse(String(c.billing)) },
      addresses: JSON.parse(String(c.addresses)),
      defaultAddress: c.default_address ?? null,
      createdAt: new Date(Number(c.created_at)).toISOString(),
    },
    orders,
  });
}

export async function updateMe(ctx: APIContext) {
  assertSameOrigin(ctx);
  const mail = await customerEmail(ctx);
  if (!mail) throw new HttpError(401, 'Inicia sesión.');
  const b = await body(ctx);
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if ('name' in b) sets.push('name = ?'), args.push(str(b.name, 80));
  if ('phone' in b) {
    const p = phoneCl(b.phone);
    if (p === null) throw new HttpError(400, 'Usa un celular chileno, por ejemplo +56 9 1234 5678.');
    sets.push('phone = ?'), args.push(p);
  }
  if ('promos' in b) sets.push('promos = ?'), args.push(b.promos === true ? 1 : 0);
  if ('billing' in b) {
    const bl = (b.billing ?? {}) as Record<string, unknown>;
    const type = bl.type === 'factura' ? 'factura' : 'boleta';
    if (type === 'factura' && (!validRut(str(bl.rut, 20)) || str(bl.razon, 120).length < 3)) throw new HttpError(400, 'Revisa el RUT y la razón social.');
    sets.push('billing = ?'), args.push(JSON.stringify({ type, rut: type === 'factura' ? formatRut(str(bl.rut, 20)) : '', razon: str(bl.razon, 120), giro: str(bl.giro, 120), direccion: str(bl.direccion, 160) }));
  }
  if ('addresses' in b) {
    if (!Array.isArray(b.addresses) || b.addresses.length > 10) throw new HttpError(400, 'Máximo 10 direcciones.');
    const list = (b.addresses as Record<string, unknown>[]).map((a) => ({ id: str(a.id, 20) || token(6), label: str(a.label, 40) || 'Dirección', street: str(a.street, 120), comuna: str(a.comuna, 60), notes: str(a.notes, 200) }));
    if (list.some((a) => a.street.length < 5 || a.comuna.length < 3)) throw new HttpError(400, 'Cada dirección necesita calle y comuna.');
    sets.push('addresses = ?'), args.push(JSON.stringify(list));
    const def = str(b.defaultAddress, 20);
    sets.push('default_address = ?'), args.push(list.some((a) => a.id === def) ? def : (list[0]?.id ?? null));
  }
  if (sets.length) await run(`UPDATE customers SET ${sets.join(', ')} WHERE email = ?`, [...args, mail]);
  return me(ctx);
}

export async function logout(ctx: APIContext) {
  assertSameOrigin(ctx);
  await endCustomerSession(ctx);
  return json({ ok: true });
}

/* ---------- RUT (same rules as the browser, enforced again here) ---------- */
function validRut(v: string) {
  const c = v.replace(/[^0-9kK]/g, '').toUpperCase();
  if (c.length < 8 || c.length > 9) return false;
  const bodyDigits = c.slice(0, -1);
  let sum = 0, mul = 2;
  for (let i = bodyDigits.length - 1; i >= 0; i--) {
    sum += Number(bodyDigits[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const dv = 11 - (sum % 11);
  return (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)) === c.slice(-1);
}
function formatRut(v: string) {
  const c = v.replace(/[^0-9kK]/g, '').toUpperCase();
  return `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.slice(-1)}`;
}

export { STATUS_ORDER, orderOut, int };
