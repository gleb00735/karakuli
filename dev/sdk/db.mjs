// Локальная замена `sdk/db` для разработки: сырые запросы идут в node:sqlite,
// а DSL схемы превращается в CREATE TABLE / CREATE INDEX.
import { DatabaseSync } from 'node:sqlite';

const conn = new DatabaseSync(process.env.KARAKULI_DB || ':memory:');

const isWrite = (q) => !/^\s*(select|with)\b/i.test(q) || /\breturning\b/i.test(q);
const norm = (rows) => rows.map((r) => ({ ...r }));

export async function run(query, params = {}) {
  const st = conn.prepare(query);
  if (/\breturning\b/i.test(query)) {
    const rows = norm(st.all(params));
    return { rowsAffected: rows.length, lastInsertRowid: 0, rows };
  }
  const r = st.run(params);
  return { rowsAffected: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid), rows: [] };
}
export async function all(query, params = {}) { return norm(conn.prepare(query).all(params)); }
export async function get(query, params = {}) { const r = conn.prepare(query).get(params); return r ? { ...r } : null; }

class Col {
  constructor(name, type) { this.name = name; this.type = type; this.mods = []; }
  primaryKey(o = {}) { this.mods.push('PRIMARY KEY' + (o.autoIncrement ? ' AUTOINCREMENT' : '')); return this; }
  notNull() { this.mods.push('NOT NULL'); return this; }
  unique() { this.mods.push('UNIQUE'); return this; }
  default(v) { this.mods.push('DEFAULT ' + (typeof v === 'string' ? `'${v}'` : v)); return this; }
  ddl() { return [this.name, this.type, ...this.mods].join(' '); }
}
const col = (type) => (name) => new Col(name, type);
export const text = col('TEXT');
export const integer = col('INTEGER');
export const real = col('REAL');
export const blob = col('BLOB');
const idx = (uniq) => (name) => ({ on: (...cols) => ({ name, uniq, cols }) });
export const index = idx(false);
export const uniqueIndex = idx(true);

export function table(name, cols, extras) {
  for (const k in cols) if (!cols[k].name) cols[k].name = k;
  return { __table: true, name, cols, extras: extras ? extras(cols) : {} };
}

export function applySchema(mod) {
  for (const t of Object.values(mod)) {
    if (!t || !t.__table) continue;
    conn.exec(`CREATE TABLE IF NOT EXISTS ${t.name} (${Object.values(t.cols).map((c) => c.ddl()).join(', ')})`);
    for (const ix of Object.values(t.extras)) {
      conn.exec(`CREATE ${ix.uniq ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${ix.name} ON ${t.name} (${ix.cols.map((c) => c.name).join(', ')})`);
    }
  }
}

export const db = { run, all, get };
export default db;
