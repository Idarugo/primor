// Customer account, backed by the API. The session is an HttpOnly cookie the page
// can't read; this module only keeps a copy of the profile to render from.

import { api } from './api';
import type { Order } from './cart';

export type Address = { id: string; label: string; street: string; comuna: string; notes: string };
export type Billing = { type: 'boleta' | 'factura'; rut: string; razon: string; giro: string; direccion: string };
export type Profile = {
  email: string;
  name: string;
  phone: string;
  addresses: Address[];
  defaultAddress: string | null;
  billing: Billing;
  promos: boolean;
  createdAt: string;
};
export type AccountOrder = Order & { status: string };
type Me = { user: Profile | null; orders?: AccountOrder[] };

let me: Me = { user: null, orders: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<(u: Profile | null) => void>();
const emit = () => listeners.forEach((fn) => fn(me.user));

async function fetchMe() {
  try {
    me = await api<Me>('account/me');
  } catch {
    /* offline: keep what we had */
  }
  me.orders ??= [];
  emit();
}

let polling = false;
function poll() {
  if (polling) return;
  polling = true;
  // order statuses change from the admin panel: refresh while a signed in page is open
  setInterval(() => me.user && document.visibilityState === 'visible' && fetchMe(), 15_000);
  document.addEventListener('visibilitychange', () => me.user && document.visibilityState === 'visible' && fetchMe());
}

export const account = {
  get user() {
    return me.user;
  },
  get orders() {
    return me.orders ?? [];
  },
  /** The address checkout should use first. */
  get mainAddress(): Address | null {
    const u = me.user;
    return u ? (u.addresses.find((a) => a.id === u.defaultAddress) ?? u.addresses[0] ?? null) : null;
  },
  load() {
    loaded ??= fetchMe();
    return loaded;
  },
  refresh: fetchMe,

  /** Step 1: ask for a code. In local development the response includes it (`devCode`). */
  requestCode(email: string, mode: 'ingresar' | 'registro', signUp?: { first: string; last: string; phone: string; promos: boolean; terms: boolean }) {
    return api<{ ok: true; devCode?: string }>('account/code', { body: { email, mode, ...signUp } });
  },
  async verify(email: string, code: string) {
    await api('account/verify', { body: { email, code } });
    await fetchMe();
  },

  async update(patch: Partial<Pick<Profile, 'name' | 'phone' | 'promos' | 'billing'>> & { addresses?: Address[]; defaultAddress?: string | null }) {
    me = await api<Me>('account/me', { method: 'PATCH', body: patch });
    me.orders ??= [];
    emit();
  },
  saveAddress(a: Omit<Address, 'id'> & { id?: string }, makeDefault = false) {
    const u = me.user;
    if (!u) return Promise.resolve();
    const id = a.id || `a${Date.now().toString(36)}`;
    const next = { ...a, id };
    const addresses = u.addresses.some((x) => x.id === id) ? u.addresses.map((x) => (x.id === id ? next : x)) : [...u.addresses, next];
    return this.update({ addresses, defaultAddress: makeDefault || !u.defaultAddress ? id : u.defaultAddress });
  },
  removeAddress(id: string) {
    const u = me.user;
    if (!u) return Promise.resolve();
    const addresses = u.addresses.filter((a) => a.id !== id);
    return this.update({ addresses, defaultAddress: u.defaultAddress === id ? (addresses[0]?.id ?? null) : u.defaultAddress });
  },
  async signOut() {
    await api('account/logout', { body: {} }).catch(() => {});
    me = { user: null, orders: [] };
    emit();
  },
  onChange(fn: (u: Profile | null) => void) {
    listeners.add(fn);
    poll();
    this.load();
  },
};
