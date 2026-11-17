import type { Decl, Stmt } from './ast'
import { BOXES, STAGES } from './schema'

/**
 * The box that runs a stage: its own id, or the id of a stage written inside it. A module of its own: the quick fixes
 * and the catalog picker both read it, and neither may pull the other into a first load.
 */
export function boxOf(body: readonly Stmt[], stage: string): Decl | undefined {
  for (const s of body) {
    if (s.kind !== 'decl' || !(BOXES as readonly string[]).includes(s.keyword.name)) continue
    const id = s.args[0]
    const inner = (s.body ?? []).filter(
      (c): c is Decl => c.kind === 'decl' && (STAGES as readonly string[]).includes(c.keyword.name),
    )
    if (inner.some((c) => c.args[0]?.t === 'id' && (c.args[0] as { name: string }).name === stage)) return s
    if (id?.t === 'id' && id.name === stage && inner.length) return s
  }
  return undefined
}
