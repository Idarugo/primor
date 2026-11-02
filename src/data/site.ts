// Everything here comes from primor.cl and @papasprimor. Do not add prices or claims
// that are not published there.

export const STORE_URL = '/tienda';
export const INSTAGRAM_URL = 'https://www.instagram.com/papasprimor/';
export const FACEBOOK_URL = 'https://www.facebook.com/PapasPrimor/';
export const MAPS_URL = 'https://goo.gl/maps/V6h5KAw4dS5SzrCV6';
export const CONTACT_URL = '/contacto';
// No public WhatsApp or phone appears on primor.cl or @papasprimor. Fill these in
// (e.g. '56912345678' and '+56 9 1234 5678') and the contact page shows them.
export const WHATSAPP = '';
export const PHONE = '';

export const FOUNDED = 1973;
export const FOLLOWERS = '115 mil';

export const address = {
  street: 'Germán Ibarra 1188',
  city: 'Rancagua',
  hours: 'Lunes a sábado, de 10:00 a 20:00',
  /** Opening hours as data, for the "open now" badge (Chile time). 0 = Sunday. */
  schedule: { days: [1, 2, 3, 4, 5, 6], open: 10, close: 20 },
};

export type Product = {
  id: string;
  name: string;
  format: string;
  copy: string;
  img: string;
  alt: string;
  bg: string;
  fg: string;
  wide?: boolean;
  href: string;
};

export const products: Product[] = [
  {
    id: 'caseras',
    href: '/tienda/papas-fritas-230-grs',
    name: 'Papas fritas caseras',
    format: '230 g',
    copy: 'La clásica que abrió todo. Dorada, crujiente y lista para la mesa familiar.',
    img: '/img/bag-230.webp',
    alt: 'Bolsa de Papitas Fritas Caseras Primor de 230 gramos',
    bg: 'bg-yellow',
    fg: 'text-ink',
  },
  {
    id: 'hilo',
    href: '/tienda/papas-fritas-hilo-primor',
    name: 'Papas hilo',
    format: '200 g',
    copy: 'Finas como hilo. Para el completo, la ensalada o directo desde la bolsa.',
    img: '/img/bag-hilo.webp',
    alt: 'Bolsa de Papitas Fritas Hilo Primor de 200 gramos',
    bg: 'bg-blue',
    fg: 'text-cream',
  },
  {
    id: 'familiar',
    href: '/tienda/papas-fritas-primor-500-grs',
    name: 'Papas fritas',
    format: '500 g',
    copy: 'El formato grande para cumpleaños, asados y tardes largas con amigos.',
    img: '/img/bag-500.webp',
    alt: 'Bolsa transparente de Papitas Fritas Primor de 500 gramos',
    bg: 'bg-red',
    fg: 'text-cream',
  },
  {
    id: 'sinsal',
    href: '/tienda/papas-fritas-sin-sal',
    name: 'Papas sin sal',
    format: '120 g',
    copy: 'Todo el sabor de la papa, sin sal agregada.',
    img: '/img/bag-sinsal.webp',
    alt: 'Bolsa de Papas Fritas Primor Sin Sal de 120 gramos',
    bg: 'bg-green',
    fg: 'text-cream',
  },
  {
    id: 'ramitas',
    href: '/tienda?c=ramitas',
    name: 'Ramitas',
    format: '270 g',
    copy: 'Saladas, de queso y un especial sabor a jamón serrano. Disfrútalas, compártelas y llévalas contigo.',
    img: '/img/ramitas.webp',
    alt: 'Tres bolsas de Ramitas Primor: queso, saladas y jamón serrano',
    bg: 'bg-orange',
    fg: 'text-ink',
    wide: true,
  },
  {
    id: 'sufles',
    href: '/tienda?c=sufles',
    name: 'Suflés',
    format: '250 g',
    copy: 'Sabor a queso, papa y tutifruti. Livianos, crujientes y extremadamente sabrosos.',
    img: '/img/sufles.webp',
    alt: 'Tres bolsas de Suflés Primor: queso, papa y tutifruti',
    bg: 'bg-purple',
    fg: 'text-cream',
    wide: true,
  },
  {
    id: 'mani',
    href: '/tienda?c=mani',
    name: 'Maní Primores',
    format: 'Con sal y sin sal',
    copy: 'Granos especialmente seleccionados, para acompañar cualquier momento y lugar.',
    img: '/img/mani.webp',
    alt: 'Bolsas de Maní salado Primores',
    bg: 'bg-navy',
    fg: 'text-cream',
  },
];

export const retailers = ['Jumbo', 'Líder', 'Tu Market', 'Super Ramírez', 'Super San Nicolás', 'Gamovi', 'Tu botillería de barrio'];

export const posts = [
  { img: '/img/ig03.webp', alt: 'Canasta de picnic con papas, suflés y ramitas Primor', w: 513, h: 640 },
  { img: '/img/ig06.webp', alt: 'Afiche Crunch desbloqueado con una papa frita como candado', w: 526, h: 640 },
  { img: '/img/ig09.webp', alt: 'Clienta sonriendo con una caja de papitas Primor y ketchup', w: 360, h: 640 },
  { img: '/img/ig11.webp', alt: 'Afiche rojo: para cada momento hay un snack', w: 520, h: 640 },
  { img: '/img/ig05.webp', alt: 'Reel grabado frente a un supermercado de Rancagua', w: 360, h: 640 },
  { img: '/img/ig08.webp', alt: 'Mono capuchino comiendo una papa frita: sí, te perdono', w: 512, h: 640 },
  { img: '/img/ig10.webp', alt: 'Reel de Primor en el reloj de flores de Viña del Mar', w: 360, h: 640 },
  { img: '/img/ig04.webp', alt: 'Clienta abriendo una bolsa de papas Primor', w: 361, h: 640 },
  { img: '/img/ig01.webp', alt: 'Reel en la plaza de Rancagua con dos bolsas Primor', w: 360, h: 640 },
];

export const faqs = [
  {
    q: '¿Dónde está la sala de venta?',
    a: `En ${address.street}, ${address.city}. Atendemos ${address.hours.toLowerCase()}.`,
  },
  {
    q: '¿Puedo comprar en línea?',
    a: 'Sí. En nuestra tienda online encuentras papas, ramitas, suflés, maní y cajas surtidas, con retiro en la sala de venta o despacho.',
  },
  {
    q: '¿En qué supermercados encuentro Primor?',
    a: 'En Jumbo, Líder, Tu Market, Super Ramírez, Super San Nicolás, Gamovi y botillerías de barrio.',
  },
  {
    q: '¿Qué sabores tienen las ramitas?',
    a: 'Saladas, de queso y sabor a jamón serrano, en formato de 270 g.',
  },
  {
    q: '¿Hay papas sin sal?',
    a: 'Sí. Tenemos papas fritas sin sal agregada en bolsa de 120 g, y maní Primores con sal y sin sal.',
  },
  {
    q: '¿Venden cajas para eventos?',
    a: 'Sí, hay cajas de papas fritas, papas hilo y una caja surtida con lo más vendido. Revisa formatos y disponibilidad en la tienda online.',
  },
];
