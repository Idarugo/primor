import { api } from './api';

// Client side cart for the simulated store. Lives in localStorage and broadcasts
// a `cart:change` event so every widget (nav badge, drawer, checkout) stays in sync.

export type CartLine = { id: number; slug: string; name: string; format: string; price: number; img: string; qty: number; max: number };

const KEY = 'primor.cart.v1';
const MAX_QTY = 99;

const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the cart still works for this page view */
  }
};

let lines: CartLine[] = read<CartLine[]>(KEY, []);

const emit = () => {
  write(KEY, lines);
  document.dispatchEvent(new CustomEvent('cart:change', { detail: { lines } }));
};

export const cart = {
  get lines() {
    return lines;
  },
  get count() {
    return lines.reduce((n, l) => n + l.qty, 0);
  },
  get subtotal() {
    return lines.reduce((n, l) => n + l.qty * l.price, 0);
  },
  add(item: Omit<CartLine, 'qty'>, qty = 1) {
    const found = lines.find((l) => l.id === item.id);
    const max = Math.min(MAX_QTY, item.max);
    if (found) found.qty = Math.min(max, found.qty + qty);
    else lines = [...lines, { ...item, qty: Math.min(max, qty) }];
    emit();
  },
  setQty(id: number, qty: number) {
    lines = qty <= 0 ? lines.filter((l) => l.id !== id) : lines.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, l.max ?? MAX_QTY, qty) } : l));
    emit();
  },
  remove(id: number) {
    this.setQty(id, 0);
  },
  clear() {
    lines = [];
    emit();
  },
  onChange(fn: (lines: CartLine[]) => void) {
    document.addEventListener('cart:change', () => fn(lines));
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      lines = read<CartLine[]>(KEY, []);
      fn(lines);
    });
    fn(lines);
  },
};

export type Order = {
  number: string;
  createdAt: string;
  lines: CartLine[];
  subtotal: number;
  delivery: 'retiro' | 'despacho';
  payment: string;
  firstName: string;
  email?: string;
  comuna?: string;
  /** "Boleta" or "Factura a 76.123.456-0" */
  document?: string;
};

export type CreatedOrder = { ok: true; number: string; access: string; subtotal: number; lines: CartLine[] };

/** Orders live on the server: it re-prices every line, so the browser only sends ids and quantities. */
export const orders = {
  create(data: Record<string, unknown>) {
    return api<CreatedOrder>('orders', { body: { ...data, lines: lines.map(({ id, qty, img }) => ({ id, qty, img })) } });
  },
  /** `t` is the private token from the confirmation link; signed in customers don't need it. */
  find(number: string, t = '') {
    return api<Order & { status: string }>(`orders/${encodeURIComponent(number)}${t ? `?t=${encodeURIComponent(t)}` : ''}`);
  },
};

export const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
