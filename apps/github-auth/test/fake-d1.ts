// D1 as the settings store uses it, in memory: the statements store.ts sends, read by their shape. A statement it
// does not know fails the test.
import type { Db, Stmt } from '../store'

export function fakeD1() {
  const settings = new Map<string, { user: number; slot: string; box: string; updated: number }>()
  const quota = new Map<string, { user: number; day: number; n: number }>()
  const run = (sql: string, v: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.startsWith('CREATE TABLE IF NOT EXISTS')) return { rows: [] }
    if (s === 'SELECT slot, box FROM settings WHERE user = ?')
      return { rows: [...settings.values()].filter((r) => r.user === v[0]).map(({ slot, box }) => ({ slot, box })) }
    if (s === 'SELECT slot FROM settings WHERE user = ?')
      return { rows: [...settings.values()].filter((r) => r.user === v[0]).map(({ slot }) => ({ slot })) }
    if (s === 'SELECT box FROM settings WHERE user = ? AND slot = ?') {
      const r = settings.get(`${v[0]}:${v[1]}`)
      return { rows: r ? [{ box: r.box }] : [] }
    }
    if (s === 'SELECT n FROM quota WHERE user = ? AND day = ?') {
      const q = quota.get(`${v[0]}:${v[1]}`)
      return { rows: q ? [{ n: q.n }] : [] }
    }
    if (s === 'SELECT COUNT(*) AS n, SUM(slot = ?) AS here FROM settings WHERE user = ?') {
      const mine = [...settings.values()].filter((r) => r.user === v[1])
      return { rows: [{ n: mine.length, here: mine.filter((r) => r.slot === v[0]).length }] }
    }
    if (s.startsWith('INSERT INTO settings')) {
      const [user, slot, box, updated] = v as [number, string, string, number]
      settings.set(`${user}:${slot}`, { user, slot, box, updated })
      return { rows: [] }
    }
    if (s.startsWith('INSERT INTO quota')) {
      const [user, day] = v as [number, number]
      const k = `${user}:${day}`
      quota.set(k, { user, day, n: (quota.get(k)?.n ?? 0) + 1 })
      return { rows: [] }
    }
    if (s === 'DELETE FROM quota WHERE day < ?') {
      for (const [k, q] of quota) if (q.day < (v[0] as number)) quota.delete(k)
      return { rows: [] }
    }
    if (s === 'DELETE FROM settings WHERE user = ? AND slot = ?') {
      settings.delete(`${v[0]}:${v[1]}`)
      return { rows: [] }
    }
    if (s === 'DELETE FROM settings WHERE user = ?') {
      for (const [k, r] of settings) if (r.user === v[0]) settings.delete(k)
      return { rows: [] }
    }
    if (s === 'DELETE FROM quota WHERE user = ?') {
      for (const [k, q] of quota) if (q.user === v[0]) quota.delete(k)
      return { rows: [] }
    }
    throw new Error(`fake D1 does not know: ${s}`)
  }
  const stmt = (sql: string, v: unknown[] = []): Stmt => ({
    bind: (...values) => stmt(sql, values),
    first: async <T>() => (run(sql, v).rows[0] as T | undefined) ?? null,
    all: async <T>() => ({ results: run(sql, v).rows as T[] }),
    run: async () => run(sql, v),
  })
  const db: Db = {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      for (const s of list) await s.run()
      return []
    },
  }
  return { db, settings, quota }
}
