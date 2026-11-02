// Pulls the live catalog from the current WooCommerce store (primor.cl) into
// src/data/catalog.json and downloads product photos into src/assets/shop/.
// Run again whenever prices or stock change:  node scripts/import-catalog.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const API = 'https://primor.cl/wp-json/wc/store/v1';
const ASSETS = 'src/assets/shop';
const MAX_IMAGES = 4;

const decode = (s = '') =>
  s
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8230;/g, '…')
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&#171;|&#187;|&laquo;|&raquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const toLines = (html = '') =>
  decode(html.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

// Boilerplate the old store repeats on every product; the new store says it once.
const NOISE = [/^Precio exclusivo/i, /^Cobertura de despacho/i, /^Si buscas el complemento/i, /^También disponible en nuestra sala/i];
// Sentences injected into the old store that are not product copy (site spam).
const JUNK = [/\s*La prosa revela[^.]*\./gi];
// Corrections where the old store's copy contradicts the product name.
const OVERRIDES = {
  4650: { copy: ['Maní seleccionado y salado, en bolsa de 25 grs.'] },
};

const FAMILY = {
  promociones: 'cajas',
  ph: 'papas',
  coctel: 'papas',
  'papas-fritas': 'papas',
  ramitas: 'ramitas',
  rj: 'ramitas',
  rs: 'ramitas',
  sufles: 'sufles',
  sp: 'sufles',
  sq: 'sufles',
  sd: 'sufles',
  mani: 'mani',
};

const res = await fetch(`${API}/products?per_page=100`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`Catalog request failed: ${res.status}`);
const raw = await res.json();

await mkdir(ASSETS, { recursive: true });

const products = [];
for (const p of raw) {
  const lines = [...toLines(p.short_description), ...toLines(p.description)].filter((l) => !NOISE.some((re) => re.test(l)));
  const ingIdx = lines.findIndex((l) => /^Ingredientes$/i.test(l));
  const ingredients = ingIdx >= 0 ? lines.slice(ingIdx + 1).join(' ') : '';
  const body = (ingIdx >= 0 ? lines.slice(0, ingIdx) : lines).filter((l) => l !== decode(p.name));
  const contentsIdx = body.findIndex((l) => /^Contiene:?$/i.test(l));
  const after = contentsIdx >= 0 ? body.slice(contentsIdx + 1) : [];
  const contents = after.filter((l) => /^\d+\s/.test(l));
  const copy = [...new Set([...(contentsIdx >= 0 ? body.slice(0, contentsIdx) : body), ...after.filter((l) => !/^\d+\s/.test(l))])]
    .map((l) => JUNK.reduce((t, re) => t.replace(re, ''), l).trim())
    .filter((l) => l && !l.startsWith(decode(p.name).replace(/\s+–\s+Primor$/, '')));
  const cats = p.categories.map((c) => c.slug);
  const name = decode(p.name).replace(/\s+–\s+Primor$/, '');
  const pack = /pack\s+(de\s+)?10\s+unidades|10 unidades/i.test(`${name} ${copy.join(' ')}`) ? 10 : /20 unidades/i.test(name) ? 20 : 1;

  const images = [];
  for (const [i, img] of p.images.slice(0, MAX_IMAGES).entries()) {
    const ext = extname(new URL(img.src).pathname).toLowerCase() || '.jpg';
    const file = `${p.id}-${i}${ext}`;
    if (!existsSync(join(ASSETS, file))) {
      const r = await fetch(img.src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      await writeFile(join(ASSETS, file), Buffer.from(await r.arrayBuffer()));
    }
    images.push(file);
  }

  products.push({
    id: p.id,
    slug: p.slug.replace(/-copia$/, '-ketchup'),
    name,
    family: FAMILY[cats.find((c) => FAMILY[c])] ?? 'papas',
    isBox: cats.includes('promociones') || /^Caja/i.test(name),
    price: Number(p.prices.price),
    regularPrice: Number(p.prices.regular_price),
    onSale: p.on_sale,
    inStock: p.is_in_stock,
    lowStock: p.low_stock_remaining ?? null,
    pack,
    copy: OVERRIDES[p.id]?.copy ?? copy.filter((l) => !/^Venta por pack/i.test(l)),
    contents,
    ingredients,
    images,
    source: p.permalink,
  });
}

await writeFile('src/data/catalog.json', JSON.stringify({ fetchedAt: new Date().toISOString(), products }, null, 2));
console.log(`Imported ${products.length} products, ${products.reduce((n, p) => n + p.images.length, 0)} images`);
