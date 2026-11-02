// Admin data layer, backed by the API. The panel renders from the last
// /api/admin/bootstrap snapshot; every change goes to the server (which checks the
// session and role again) and then the snapshot is reloaded.

import { api, ApiError } from './api';
import type { Order } from './cart';
import { pingPublicPages } from './overrides';

export type Role = 'owner' | 'dev';
export type Permission = 'dashboard' | 'orders' | 'products' | 'customers' | 'messages' | 'content' | 'team' | 'activity' | 'system';

export const ROLE_LABEL: Record<Role, string> = { owner: 'Dueño', dev: 'Informático' };

/** Mirrors the server's rules; the server is what actually enforces them. */
export const PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['dashboard', 'orders', 'products', 'customers', 'messages', 'content'],
  dev: ['dashboard', 'orders', 'products', 'customers', 'messages', 'content', 'team', 'activity', 'system'],
};

export type OrderStatus = 'recibido' | 'preparacion' | 'listo' | 'despacho' | 'entregado' | 'cancelado';
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: 'neutral' | 'warning' | 'good' | 'critical' }> = {
  recibido: { label: 'Recibido', tone: 'neutral' },
  preparacion: { label: 'En preparación', tone: 'warning' },
  listo: { label: 'Listo para retiro', tone: 'good' },
  despacho: { label: 'En despacho', tone: 'warning' },
  entregado: { label: 'Entregado', tone: 'good' },
  cancelado: { label: 'Cancelado', tone: 'critical' },
};

export type ProductOverride = { price?: number; inStock?: boolean; hidden?: boolean; lowStock?: number | null };
export type Message = { ticket: string; topic: string; name?: string; email: string; phone?: string; comuna?: string; business?: string; volume?: string; message?: string; at: string; status?: 'nuevo' | 'respondido' | 'archivado' };
export type Announcement = { text: string; href: string; active: boolean };
export type AdminOrder = Order & { status: OrderStatus; street?: string; phone?: string; notes?: string };
export type Member = { email: string; name: string; role: Role; addedAt: string; totpEnabled: boolean; mustChange: boolean };
export type LogEntry = { at: string; who: string; role: Role; action: string; ip?: string };
type Me = { email: string; name: string; role: Role; mustChange: boolean };

type Snapshot = {
  me: Me;
  version: number;
  orders: AdminOrder[];
  customers: { email: string; name: string; phone: string; createdAt: string; billing?: { type: string; rut: string; razon: string } }[];
  messages: Message[];
  overrides: Record<string, ProductOverride>;
  announcement: Announcement;
  team?: { email: string; name: string; role: Role; totp_enabled: number; must_change: number; disabled: number; created_at: number }[];
  activity?: { at: number; who: string; role: Role; action: string; ip: string }[];
  system?: { database: string; email: string; production: boolean; counts: Record<string, number> };
};

let snap: Snapshot | null = null;
const emit = () => document.dispatchEvent(new CustomEvent('admin:change'));

/** Loads the panel data. Returns false when there's no valid session (the server said 401). */
export async function load(): Promise<boolean> {
  try {
    snap = await api<Snapshot>('admin/bootstrap');
    emit();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      snap = null;
      return false;
    }
    throw e;
  }
}

/** Every mutation: send, reload the snapshot, nudge open shop tabs. Errors bubble up to show. */
async function mutate(path: string, body: unknown, method = 'POST') {
  await api(path, { method, body });
  pingPublicPages();
  await load();
}

export const session = {
  get current() {
    return snap?.me ?? null;
  },
  can(p: Permission) {
    return !!snap && PERMISSIONS[snap.me.role].includes(p);
  },
  async signOut() {
    await api('admin/logout', { body: {} }).catch(() => {});
    snap = null;
  },
};

export const auth = {
  setupStatus: () => api<{ needed: boolean; tokenConfigured: boolean }>('admin/setup'),
  setup: (data: { token: string; name: string; email: string; password: string }) => api('admin/setup', { body: data }),
  login: (email: string, password: string) => api<{ step: 'totp' | 'enroll'; ticket: string; secret?: string; qr?: string }>('admin/login', { body: { email, password } }),
  totp: (ticket: string, code: string) => api('admin/login/totp', { body: { ticket, code } }),
  changePassword: (current: string, next: string) => api('admin/password', { body: { current, next } }),
};

export const orders = {
  list: () => snap?.orders ?? [],
  statusOf: (number: string): OrderStatus => snap?.orders.find((o) => o.number === number)?.status ?? 'recibido',
  setStatus: (number: string, status: OrderStatus) => mutate('admin/orders/status', { number, status }),
};

export const products = {
  overrides: () => snap?.overrides ?? {},
  set: (id: number, patch: ProductOverride) => mutate('admin/products', { id, ...patch }),
  reset: (id: number) => mutate('admin/products', { id, reset: true }),
};

export const customers = { list: () => snap?.customers ?? [] };

export const messages = {
  list: () => snap?.messages ?? [],
  setStatus: (ticket: string, status: NonNullable<Message['status']>) => mutate('admin/messages/status', { ticket, status }),
};

export const content = {
  announcement: (): Announcement => snap?.announcement ?? { text: '', href: '', active: false },
  setAnnouncement: (a: Announcement) => mutate('admin/announcement', a),
};

export const team = {
  list: (): Member[] =>
    (snap?.team ?? []).map((m) => ({ email: m.email, name: m.name, role: m.role, addedAt: new Date(Number(m.created_at)).toISOString(), totpEnabled: !!m.totp_enabled, mustChange: !!m.must_change })),
  /** Returns the one-time password to hand to the new person. */
  async add(name: string, email: string, role: Role) {
    const r = await api<{ tempPassword: string }>('admin/team', { body: { name, email, role } });
    await load();
    return r.tempPassword;
  },
  update: (email: string, action: 'role' | 'remove' | 'reset2fa' | 'signout', role?: Role) => mutate('admin/team', { email, action, role }, 'PATCH'),
};

export const activity = {
  list: (): LogEntry[] => (snap?.activity ?? []).map((l) => ({ at: new Date(Number(l.at)).toISOString(), who: l.who, role: l.role, action: l.action, ip: l.ip })),
};

export const system = {
  info: () => snap?.system ?? null,
  /** Downloads the JSON backup the server builds (developer only). */
  async exportAll() {
    const res = await fetch('/api/admin/export', { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar el respaldo.');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `primor-respaldo-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
    await load();
  },
};

export const seedDemo = () => mutate('admin/seed', {});
