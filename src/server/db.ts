// Database access. libSQL speaks SQLite: locally it's a file (no setup), on Vercel
// it's a Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
import { createClient, type Client, type InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let client: Client | null = null;
let ready: Promise<void> | null = null;

function connect() {
  const url = import.meta.env.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? 'file:./data/primor.db';
  const authToken = import.meta.env.TURSO_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
  if (import.meta.env.PROD && url.startsWith('file:') && process.env.VERCEL) {
    throw new Error('TURSO_DATABASE_URL no está configurada en Vercel.');
  }
  // a local file database needs its folder before the client opens it
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true });
  return createClient({ url, authToken });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS team (
    email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','dev')),
    password_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1,
    totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, last_active INTEGER NOT NULL, ip TEXT, ua TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_tickets (
    ticket_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, enrolling_secret TEXT)`,
  `CREATE TABLE IF NOT EXISTS customers (
    email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', promos INTEGER NOT NULL DEFAULT 0,
    billing TEXT NOT NULL DEFAULT '{}', addresses TEXT NOT NULL DEFAULT '[]', default_address TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS customer_sessions (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, last_active INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, signup TEXT)`,
  `CREATE TABLE IF NOT EXISTS orders (
    number TEXT PRIMARY KEY, email TEXT NOT NULL, first_name TEXT NOT NULL, created_at INTEGER NOT NULL,
    lines TEXT NOT NULL, subtotal INTEGER NOT NULL, delivery TEXT NOT NULL, comuna TEXT, street TEXT, notes TEXT, phone TEXT,
    payment TEXT NOT NULL, document TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'recibido', access_hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS orders_email ON orders(email)`,
  `CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
    ticket TEXT PRIMARY KEY, topic TEXT NOT NULL, name TEXT, email TEXT NOT NULL, phone TEXT, comuna TEXT, business TEXT,
    volume TEXT, message TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'nuevo')`,
  `CREATE TABLE IF NOT EXISTS product_overrides (
    id INTEGER PRIMARY KEY, price INTEGER, in_stock INTEGER, hidden INTEGER, low_stock INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, who TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, ip TEXT)`,
  `CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits(key, at)`,
];

export async function db(): Promise<Client> {
  client ??= connect();
  ready ??= (async () => {
    await client!.batch(SCHEMA, 'write');
  })();
  await ready;
  return client;
}

export type Row = Record<string, unknown>;

export async function all<T = Row>(sql: string, args: InValue[] = []) {
  return (await (await db()).execute({ sql, args })).rows as unknown as T[];
}
export async function one<T = Row>(sql: string, args: InValue[] = []) {
  return (await all<T>(sql, args))[0] ?? null;
}
export async function run(sql: string, args: InValue[] = []) {
  return (await db()).execute({ sql, args });
}

/* ---------- settings + change counter (drives live updates everywhere) ---------- */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await one<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
/** Bumped on every change visitors should see (prices, stock, announcement, order status). */
export async function bumpVersion() {
  await run(
    `INSERT INTO settings(key, value) VALUES ('version', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
  );
}
export const getVersion = () => getSetting<number>('version', 0);
