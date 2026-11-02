// The server's view of the catalog: static data from catalog.json plus what the
// owner changed in the admin. Orders are always priced here, never from the browser.
import raw from '../data/catalog.json';
import { all } from './db';
import { HttpError, int } from './http';

type Base = (typeof raw.products)[number];
export type Override = { price?: number; inStock?: boolean; hidden?: boolean; lowStock?: number | null };

export async function overrides(): Promise<Record<number, Override>> {
  const rows = await all<{ id: number; price: number | null; in_stock: number | null; hidden: number | null; low_stock: number | null }>('SELECT * FROM product_overrides');
  return Object.fromEntries(
    rows.map((r) => [
      Number(r.id),
      {
        ...(r.price !== null ? { price: Number(r.price) } : {}),
        ...(r.in_stock !== null ? { inStock: !!r.in_stock } : {}),
        ...(r.hidden !== null ? { hidden: !!r.hidden } : {}),
        ...(r.low_stock !== null ? { lowStock: Number(r.low_stock) } : {}),
      },
    ]),
  );
}

export const products = raw.products as Base[];
export const byId = new Map(products.map((p) => [p.id, p]));

const shortName = (p: Base) =>
  p.name.replace(/\s*\(10 unidades\)/i, '').replace(/\s+\d+\s*unidades/i, '').replace(/(\d+)\s*grs?\b/i, '$1 g').replace(/\s+Primor\b/i, '').replace(/«/g, '“').replace(/»/g, '”').trim();
function formatLabel(p: Base) {
  const g = p.name.match(/(\d+)\s*grs?/i)?.[1];
  if (p.family === 'cajas') return `Caja de ${p.contents.length} productos`;
  if (p.isBox) return `Caja ${p.pack} u. de ${g} g`;
  if (p.pack > 1) return `Pack ${p.pack} u. de ${g} g`;
  return g ? `${g} g` : '';
}

export type PricedLine = { id: number; slug: string; name: string; format: string; price: number; qty: number; img: string; max: number };

/**
 * Turns what the browser sent ({id, qty}) into trusted order lines: unknown, hidden or
 * out-of-stock products are rejected, quantities are capped, prices come from the server.
 */
export async function priceLines(input: unknown, imgFor: (id: number) => string): Promise<{ lines: PricedLine[]; subtotal: number }> {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'El carrito está vacío.');
  if (input.length > 50) throw new HttpError(400, 'Demasiados productos en un pedido.');
  const ov = await overrides();
  const merged = new Map<number, number>();
  for (const it of input) {
    const id = int((it as { id?: unknown })?.id, 1);
    const qty = int((it as { qty?: unknown })?.qty, 1, 99);
    if (!id || !qty) throw new HttpError(400, 'Hay un producto inválido en el carrito.');
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  const lines: PricedLine[] = [];
  for (const [id, qty] of merged) {
    const p = byId.get(id);
    const o = ov[id] ?? {};
    if (!p || o.hidden) throw new HttpError(409, 'Un producto del carrito ya no está disponible.', { id });
    const inStock = o.inStock ?? p.inStock;
    if (!inStock) throw new HttpError(409, `${shortName(p)} se agotó. Quítalo del carrito para continuar.`, { id });
    const max = o.lowStock ?? p.lowStock ?? 99;
    if (qty > max) throw new HttpError(409, `Solo quedan ${max} de ${shortName(p)}.`, { id, max });
    lines.push({ id, slug: p.slug, name: shortName(p), format: formatLabel(p), price: o.price ?? p.price, qty, img: imgFor(id), max });
  }
  return { lines, subtotal: lines.reduce((n, l) => n + l.price * l.qty, 0) };
}
