// Single entry point for the API. Runs on demand (a Vercel function), never prerendered.
import type { APIContext, APIRoute } from 'astro';
import { HttpError, json } from '../../server/http';
import * as pub from '../../server/routes/public';
import * as adm from '../../server/routes/admin';

export const prerender = false;

type Handler = (ctx: APIContext, ...params: string[]) => Promise<Response> | Response;
const routes: [string, RegExp, Handler][] = [
  ['GET', /^state$/, pub.state],
  ['POST', /^contact$/, pub.contact],
  ['POST', /^orders$/, pub.createOrder],
  ['GET', /^orders\/([A-Z0-9-]{4,20})$/, pub.getOrder],
  ['POST', /^account\/code$/, pub.requestCode],
  ['POST', /^account\/verify$/, pub.verifyCode],
  ['GET', /^account\/me$/, pub.me],
  ['PATCH', /^account\/me$/, pub.updateMe],
  ['POST', /^account\/logout$/, pub.logout],

  ['GET', /^admin\/setup$/, adm.setupStatus],
  ['POST', /^admin\/setup$/, adm.setup],
  ['POST', /^admin\/login$/, adm.login],
  ['POST', /^admin\/login\/totp$/, adm.loginTotp],
  ['POST', /^admin\/logout$/, adm.logoutAdmin],
  ['POST', /^admin\/password$/, adm.changePassword],
  ['GET', /^admin\/bootstrap$/, adm.bootstrap],
  ['POST', /^admin\/orders\/status$/, adm.setOrderStatus],
  ['POST', /^admin\/products$/, adm.setProduct],
  ['POST', /^admin\/messages\/status$/, adm.setMessageStatus],
  ['POST', /^admin\/announcement$/, adm.setAnnouncement],
  ['POST', /^admin\/team$/, adm.addMember],
  ['PATCH', /^admin\/team$/, adm.updateMember],
  ['GET', /^admin\/export$/, adm.exportAll],
  ['POST', /^admin\/seed$/, adm.seed],
];

export const ALL: APIRoute = async (ctx) => {
  const path = (ctx.params.path ?? '').replace(/\/+$/, '');
  const method = ctx.request.method;
  const matches = routes.filter(([, re]) => re.test(path));
  if (!matches.length) return json({ error: 'No encontrado.' }, 404);
  const hit = matches.find(([m]) => m === method);
  if (!hit) return json({ error: 'Método no permitido.' }, 405, { allow: matches.map(([m]) => m).join(', ') });
  try {
    const params = path.match(hit[1])!.slice(1);
    return await hit[2](ctx, ...params);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status, e.status === 429 ? { 'retry-after': String(e.extra.retryAfter ?? 60) } : {});
    console.error('[api]', method, path, e);
    // never leak internals to the browser
    return json({ error: 'Ocurrió un error en el servidor. Intenta de nuevo.' }, 500);
  }
};
