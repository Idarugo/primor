// Public side of the admin panel: applies what the owner changed (price, stock,
// visibility, announcement) on top of the static pages, and keeps it live.
//
// Every page polls /api/state (a tiny JSON with a version number). When the owner
// saves anything, the version changes and every open page, on every device,
// re-applies within a few seconds. The last state is cached so pages paint
// correctly before the first response arrives.

import { api } from './api';

export type ProductOverride = { price?: number; inStock?: boolean; hidden?: boolean; lowStock?: number | null };
export type Announcement = { text: string; href: string; active: boolean };
type State = { version: number; overrides: Record<string, ProductOverride>; announcement: Announcement };

const CACHE = 'primor.state.v1';
const POLL_MS = 10_000;

let state: State = (() => {
  try {
    return (JSON.parse(localStorage.getItem(CACHE) ?? 'null') as State) ?? { version: -1, overrides: {}, announcement: { text: '', href: '', active: false } };
  } catch {
    return { version: -1, overrides: {}, announcement: { text: '', href: '', active: false } };
  }
})();

export const productOverrides = () => state.overrides;
export const announcement = () => state.announcement;

export const STATUS_LABEL: Record<string, string> = {
  recibido: 'Recibido',
  preparacion: 'En preparación',
  listo: 'Listo para retiro',
  despacho: 'En despacho',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const listeners = new Set<() => void>();
let polling = false;

async function refresh() {
  try {
    const next = await api<State>('state');
    if (next.version === state.version) return;
    state = next;
    try {
      localStorage.setItem(CACHE, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    listeners.forEach((fn) => fn());
  } catch {
    /* offline: keep the cached state */
  }
}

function startPolling() {
  if (polling) return;
  polling = true;
  refresh();
  setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  // the admin panel in another tab of this browser announces saves immediately
  addEventListener('storage', (e) => e.key === 'primor.admin.ping' && refresh());
}

/** Runs `fn` whenever anything the admin controls changes, here or on any other device. */
export function onAdminChange(fn: () => void) {
  listeners.add(fn);
  startPolling();
}

/** Called by the admin panel after a save so tabs in the same browser update at once. */
export const pingPublicPages = () => {
  try {
    localStorage.setItem('primor.admin.ping', String(Date.now()));
  } catch {
    /* ignore */
  }
};

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

/**
 * Updates every product on the page marked with [data-product-id]: price text,
 * sort data, add-to-cart payload, stock state and visibility. Safe to call again
 * at any time; the first run remembers the original values so a reset restores them.
 */
export function applyProductOverrides(root: ParentNode = document) {
  const ov = productOverrides();
  root.querySelectorAll<HTMLElement>('[data-product-id]').forEach((el) => {
    const payloads = [...el.querySelectorAll<HTMLElement>('[data-add-to-cart]')];
    const first = payloads[0] ? JSON.parse(payloads[0].dataset.addToCart!) : null;
    el.dataset.basePrice ??= el.dataset.price ?? String(first?.price ?? '');
    el.dataset.baseMax ??= String(first?.max ?? 99);
    el.dataset.baseStock ??= String(!(el.querySelector<HTMLElement>('[data-when-stock]')?.hidden ?? false));

    const o = ov[el.dataset.productId!] ?? {};
    const price = o.price ?? Number(el.dataset.basePrice);
    const inStock = o.inStock ?? el.dataset.baseStock === 'true';
    const max = o.lowStock === undefined ? Number(el.dataset.baseMax) : (o.lowStock ?? 99);

    el.toggleAttribute('data-admin-hidden', !!o.hidden);
    if (el.dataset.price) el.dataset.price = String(price);
    el.querySelectorAll<HTMLElement>('[data-price-text]').forEach((t) => (t.textContent = clp(price)));
    el.querySelectorAll<HTMLElement>('[data-unit-text]').forEach((t) => (t.textContent = `${clp(price / Number(t.dataset.unitText))} c/u`));
    payloads.forEach((a) => {
      const item = JSON.parse(a.dataset.addToCart!);
      a.dataset.addToCart = JSON.stringify({ ...item, price, max });
    });
    el.querySelectorAll<HTMLElement>('[data-when-stock]').forEach((n) => (n.hidden = !inStock));
    el.querySelectorAll<HTMLElement>('[data-when-out]').forEach((n) => (n.hidden = inStock));
  });
}
