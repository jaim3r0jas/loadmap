// Each reader's model settings, kept by the Worker for "Remember it for my account": the provider and model chosen,
// and the keys. One sealed row per entry in a D1 database, filed under GitHub's id of the reader and
// sealed with SEAL_KEY, bound to its reader and slot: a copy of the table opens nothing, and a row moved to another
// reader or slot fails to open. The Worker reads and writes them only for a request signed by the browser its session
// is bound to, under 8 hours after its last refresh. A key leaves only for the one question that needs it.
import { seal, unseal } from './seal'

/** The few calls of D1 this uses (its binding's type, without Cloudflare's type package). */
export interface Db {
  prepare(sql: string): Stmt
  batch(stmts: Stmt[]): Promise<unknown>
}
export interface Stmt {
  bind(...values: unknown[]): Stmt
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

/** A slot: the reader's choice of provider and model, or a provider's key. */
export type Slot = 'default' | `key:${string}`
const SLOT = /^(default|key:[a-z0-9-]{1,32})$/
export const isSlot = (s: unknown): s is Slot => typeof s === 'string' && SLOT.test(s)

/** Entries one reader may keep, and writes a day. */
export const LIMITS = { rows: 120, writes: 200, value: 2048 }

const bind = (user: number, slot: Slot) => `${user}:${slot}`

/** The two tables, made on first use: a new database needs no step of its own. */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS settings (user INTEGER NOT NULL, slot TEXT NOT NULL, box TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user, slot)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS quota (user INTEGER NOT NULL, day INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user, day)) WITHOUT ROWID',
]
const made = new WeakSet<Db>()

export async function ready(db: Db): Promise<void> {
  if (made.has(db)) return
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
  made.add(db)
}

export async function readOne<T>(db: Db, secret: Uint8Array, user: number, slot: Slot): Promise<T | undefined> {
  const r = await db
    .prepare('SELECT box FROM settings WHERE user = ? AND slot = ?')
    .bind(user, slot)
    .first<{ box: string }>()
  return r ? unseal<T>(secret, 'settings', r.box, bind(user, slot)) : undefined
}

/** Why a write was refused, or undefined when it was done. */
export async function write(
  db: Db,
  secret: Uint8Array,
  user: number,
  slot: Slot,
  value: unknown,
  now: number,
): Promise<'too_large' | 'too_many' | 'busy' | undefined> {
  if (JSON.stringify(value).length > LIMITS.value) return 'too_large'
  const day = Math.floor(now / 86_400_000)
  const q = await db.prepare('SELECT n FROM quota WHERE user = ? AND day = ?').bind(user, day).first<{ n: number }>()
  if ((q?.n ?? 0) >= LIMITS.writes) return 'busy'
  const had = await db
    .prepare('SELECT COUNT(*) AS n, SUM(slot = ?) AS here FROM settings WHERE user = ?')
    .bind(slot, user)
    .first<{ n: number; here: number }>()
  if (!had?.here && (had?.n ?? 0) >= LIMITS.rows) return 'too_many'
  const box = await seal(secret, 'settings', value, bind(user, slot))
  await db.batch([
    db
      .prepare(
        'INSERT INTO settings (user, slot, box, updated) VALUES (?, ?, ?, ?) ON CONFLICT (user, slot) DO UPDATE SET box = excluded.box, updated = excluded.updated',
      )
      .bind(user, slot, box, now),
    db
      .prepare('INSERT INTO quota (user, day, n) VALUES (?, ?, 1) ON CONFLICT (user, day) DO UPDATE SET n = n + 1')
      .bind(user, day),
    // yesterday's counts are no one's business
    db.prepare('DELETE FROM quota WHERE day < ?').bind(day),
  ])
  return undefined
}

/** One entry, or every one of the reader's. The day's count of writes stays: removing never buys more. */
export async function remove(db: Db, user: number, slot?: Slot): Promise<void> {
  if (slot) await db.prepare('DELETE FROM settings WHERE user = ? AND slot = ?').bind(user, slot).run()
  else await db.prepare('DELETE FROM settings WHERE user = ?').bind(user).run()
}

/** The reader's slots, nothing opened: which keys are kept is all a read needs of them. */
export async function slots(db: Db, user: number): Promise<Slot[]> {
  const { results } = await db.prepare('SELECT slot FROM settings WHERE user = ?').bind(user).all<{ slot: string }>()
  return results.map((r) => r.slot).filter(isSlot)
}
