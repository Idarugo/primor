// Chilean RUT helpers: clean, validate the check digit (módulo 11) and format.

export const cleanRut = (v: string) => v.replace(/[^0-9kK]/g, '').toUpperCase();

export function rutDv(body: string) {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv);
}

export function isValidRut(v: string) {
  const c = cleanRut(v);
  if (c.length < 8 || c.length > 9) return false;
  const body = c.slice(0, -1);
  return /^\d+$/.test(body) && rutDv(body) === c.slice(-1);
}

export function formatRut(v: string) {
  const c = cleanRut(v);
  if (c.length < 2) return c;
  const body = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${c.slice(-1)}`;
}
