import type { ImageMetadata } from 'astro';
import raw from './catalog.json';

export type Family = 'cajas' | 'papas' | 'ramitas' | 'sufles' | 'mani';

export type CatalogProduct = (typeof raw.products)[number] & { family: Family };

export const families: { id: Family | 'todo'; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'cajas', label: 'Cajas y promos' },
  { id: 'papas', label: 'Papas fritas' },
  { id: 'ramitas', label: 'Ramitas' },
  { id: 'sufles', label: 'Suflés' },
  { id: 'mani', label: 'Maní' },
];

const files = import.meta.glob<{ default: ImageMetadata }>('../assets/shop/*', { eager: true });
export const imageFor = (file: string) => files[`../assets/shop/${file}`]?.default;

// Promo boxes first, then the classics people search for, then everything else.
const FEATURED = [4694, 4692, 4691, 68, 118, 215, 70, 6732];
const rank = (p: CatalogProduct) => {
  const i = FEATURED.indexOf(p.id);
  return i === -1 ? FEATURED.length + (p.inStock ? 0 : 100) : i;
};

export const products = (raw.products as CatalogProduct[]).slice().sort((a, b) => rank(a) - rank(b));
export const fetchedAt = raw.fetchedAt;
export const bySlug = (slug: string) => products.find((p) => p.slug === slug);

export const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export function formatLabel(p: CatalogProduct) {
  const grams = p.name.match(/(\d+)\s*grs?/i)?.[1];
  const g = grams ? `${grams} g` : '';
  if (p.family === 'cajas') return `Caja de ${p.contents.length} productos`;
  if (p.isBox) return `Caja ${p.pack} u. de ${g}`;
  if (p.pack > 1) return `Pack ${p.pack} u. de ${g}`;
  return g;
}

/** Display name without the brand noise ("Primor", pack notes) that the badges already show. */
export function shortName(p: CatalogProduct) {
  return p.name
    .replace(/\s*\(10 unidades\)/i, '')
    .replace(/\s+\d+\s*unidades/i, '')
    .replace(/(\d+)\s*grs?\b/i, '$1 g')
    .replace(/\s+Primor\b/i, '')
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .trim();
}

export const stockLabel = (n: number) => (n === 1 ? 'Queda 1' : `Quedan ${n}`);

export const unitPrice = (p: CatalogProduct) => (p.pack > 1 ? p.price / p.pack : null);
export const discount = (p: CatalogProduct) => (p.regularPrice > p.price ? Math.round((1 - p.price / p.regularPrice) * 100) : 0);

export const related = (p: CatalogProduct, n = 4) =>
  products.filter((q) => q.id !== p.id && q.inStock && (q.family === p.family || q.family === 'cajas')).slice(0, n);
