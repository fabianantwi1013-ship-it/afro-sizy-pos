import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, SERVICES, DEFAULT_SETTINGS } from './seed.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.POS_DATA_DIR || join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = join(DATA_DIR, 'pos.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL,
  price        INTEGER NOT NULL,            -- pesewas
  duration_min INTEGER NOT NULL DEFAULT 60,
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_services_cat ON services(category_id);

CREATE TABLE IF NOT EXISTS staff (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT,
  role            TEXT,
  commission_rate REAL NOT NULL DEFAULT 0,  -- percent of service revenue
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE,
  notes      TEXT,
  points     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY,
  customer_id    INTEGER REFERENCES customers(id),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  staff_id       INTEGER REFERENCES staff(id),
  start_at       TEXT NOT NULL,             -- 'YYYY-MM-DD HH:MM' local time
  duration_min   INTEGER NOT NULL DEFAULT 60,
  status         TEXT NOT NULL DEFAULT 'booked',
  note           TEXT,
  sale_id        INTEGER,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);

CREATE TABLE IF NOT EXISTS appointment_items (
  id             INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     INTEGER,
  name           TEXT NOT NULL,
  price          INTEGER NOT NULL,
  duration_min   INTEGER NOT NULL DEFAULT 60
);
CREATE INDEX IF NOT EXISTS idx_appt_items ON appointment_items(appointment_id);

CREATE TABLE IF NOT EXISTS sales (
  id              INTEGER PRIMARY KEY,
  receipt_no      TEXT NOT NULL UNIQUE,
  customer_id     INTEGER REFERENCES customers(id),
  customer_name   TEXT,
  subtotal        INTEGER NOT NULL,
  discount        INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  points_discount INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  change_due      INTEGER NOT NULL DEFAULT 0,
  points_earned   INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'completed',   -- completed | voided
  void_reason     TEXT,
  voided_at       TEXT,
  appointment_id  INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id                INTEGER PRIMARY KEY,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  service_id        INTEGER,
  name              TEXT NOT NULL,
  category          TEXT,
  unit_price        INTEGER NOT NULL,
  qty               INTEGER NOT NULL DEFAULT 1,
  line_total        INTEGER NOT NULL,
  staff_id          INTEGER,
  staff_name        TEXT,
  commission_rate   REAL NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_staff ON sale_items(staff_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id        INTEGER PRIMARY KEY,
  sale_id   INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method    TEXT NOT NULL,                  -- cash | momo | card | bank | other
  amount    INTEGER NOT NULL,
  reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
`;

db.exec(SCHEMA);

/* ---------------------------------------------------------------- helpers */

// node:sqlite only accepts null / number / bigint / string / Uint8Array.
function norm(params) {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

export const all = (sql, ...p) => db.prepare(sql).all(...norm(p));
export const get = (sql, ...p) => db.prepare(sql).get(...norm(p));
export const run = (sql, ...p) => {
  const r = db.prepare(sql).run(...norm(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};

let txDepth = 0;
export function tx(fn) {
  if (txDepth++ > 0) {
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** Local wall-clock timestamp: 'YYYY-MM-DD HH:MM:SS'. */
export function nowLocal() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export const todayLocal = () => nowLocal().slice(0, 10);

/* ---------------------------------------------------------------- settings */

export function readSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of all('SELECT key, value FROM settings')) out[row.key] = row.value;
  return out;
}

export function writeSetting(key, value) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value ?? ''),
  );
}

/* ------------------------------------------------------------------- seed */

function seedIfEmpty() {
  const { n } = get('SELECT COUNT(*) AS n FROM settings');
  if (n === 0) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) writeSetting(k, v);
  }

  const cats = get('SELECT COUNT(*) AS n FROM categories');
  if (cats.n > 0) return;

  tx(() => {
    const byName = new Map();
    CATEGORIES.forEach((name, i) => {
      const { id } = run('INSERT INTO categories (name, sort) VALUES (?, ?)', name, i);
      byName.set(name, id);
    });
    SERVICES.forEach(([cat, name, cedis, duration], i) => {
      run(
        'INSERT INTO services (category_id, name, price, duration_min, sort) VALUES (?, ?, ?, ?, ?)',
        byName.get(cat),
        name,
        Math.round(cedis * 100),
        duration,
        i,
      );
    });
  });
}

seedIfEmpty();
