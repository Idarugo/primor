// Password hashing, tokens and TOTP (RFC 6238) with node:crypto only.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const randomDigits = (n = 6) => {
  const max = 10 ** n;
  // rejection sampling to avoid modulo bias
  let v: number;
  do v = randomBytes(4).readUInt32BE(0);
  while (v >= Math.floor(0x1_0000_0000 / max) * max);
  return String(v % max).padStart(n, '0');
};

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const got = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64url'), 64, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(got, Buffer.from(hash, 'base64url'));
}
/** A hash to compare against when the account doesn't exist, so timing doesn't reveal which emails are real. */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

/** Minimum bar for team passwords. Returns an error message or ''. */
export function passwordProblem(pw: string, email = '') {
  if (pw.length < 12) return 'La contraseña debe tener al menos 12 caracteres.';
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds < 3) return 'Combina al menos tres de: minúsculas, mayúsculas, números y símbolos.';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'La contraseña no puede contener tu correo.';
  if (/^(.)\1+$/.test(pw) || /(password|contraseña|primor|123456|qwerty)/i.test(pw)) return 'Esa contraseña es demasiado fácil de adivinar.';
  return '';
}

/* ---------------- TOTP ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));

function hotp(secret: string, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
/** Accepts the current 30 s window and one on each side for clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  return [-1, 0, 1].some((d) => safeEqual(hotp(secret, step + d), code));
}
export const totpUri = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`Primor:${email}`)}?secret=${secret}&issuer=Primor&algorithm=SHA1&digits=6&period=30`;
