// Data for "Arma tu caja": single bags you can drop in the box, and the promo
// boxes whose contents map 1:1 to those bags (so savings are real arithmetic).
import { products, shortName, formatLabel } from './catalog';

export const BOX_CAPACITY = 12;

export const builderItems = products
  .filter((p) => p.pack === 1 && !p.isBox)
  .map((p) => ({
    id: p.id,
    slug: p.slug,
    name: shortName(p),
    format: formatLabel(p),
    price: p.price,
    inStock: p.inStock,
    img: `/box/${p.id}.webp`,
    family: p.family,
  }))
  .sort((a, b) => Number(b.inStock) - Number(a.inStock));

// Lines in the promo boxes' "Contiene:" lists → single product ids.
const CONTENT_MAP: [RegExp, number][] = [
  [/Papas fritas 230/i, 68],
  [/Hilo 200/i, 118],
  [/Sin Sal 120/i, 70],
  [/Suflé Queso 200/i, 72],
  [/Suflé Tutifruti 250/i, 78],
  [/Suflé Papa 200/i, 76],
  [/Ramita Salada 270/i, 80],
  [/Ramita Queso 270/i, 82],
  [/Ramita Jamon Serrano 270/i, 84],
  [/Maní Salado 150/i, 88],
];

export const promoBoxes = products
  .filter((p) => p.family === 'cajas' && p.inStock)
  .map((p) => {
    const items: Record<number, number> = {};
    for (const line of p.contents) {
      const id = CONTENT_MAP.find(([re]) => re.test(line))?.[1];
      if (!id) return null; // contains packs we cannot build bag by bag
      items[id] = (items[id] ?? 0) + Number(line.split(' ')[0]);
    }
    const single = Object.entries(items).reduce((n, [id, q]) => n + q * (products.find((x) => x.id === Number(id))?.price ?? 0), 0);
    return { id: p.id, slug: p.slug, name: shortName(p).replace(/^Caja\s+/, ''), cartName: shortName(p), format: formatLabel(p), price: p.price, img: '', items, single };
  })
  .filter((b): b is NonNullable<typeof b> => !!b && b.single > b.price);
