import type { Evaluation } from '@loadmap/core'
import type { Scene } from '@loadmap/layout'
import type { DslSymbol } from './compile'

/** A version of the diagram as drawn: its scene and its numbers. */
export interface Drawn {
  scene: Scene
  ev: Evaluation
}

/** Where an edit changed the text, in the new text's offsets. */
export interface Range {
  from: number
  to: number
}

/**
 * The boxes a new version of the text changed on the board, from what was drawn before (`was`) to what is drawn now:
 * those whose lines the edit touched (a box, its stages, its component, a flow's route) or that a changed line names
 * (an edge), every box that is new or another size, and both ends of an edge that came or went. When none of that
 * finds one (a parameter's default), the boxes whose component changed state. Boxes that only moved to make room are
 * not changed.
 */
export function changedBoxes(
  was: Drawn,
  now: Drawn,
  text: string,
  edits: readonly Range[],
  symbols: readonly DslSymbol[],
): string[] {
  const { scene, ev } = now
  const ids = new Set(scene.nodes.map((n) => n.id))
  const out = new Set<string>()
  const add = (id: string | undefined) => id != null && ids.has(id) && out.add(id)
  const component = (n: Scene['nodes'][number], e: Evaluation) =>
    n.stages.map((s) => e.stages[s]?.component).find(Boolean) ?? n.component
  const touches = (s: { from: number; to: number }) => edits.some((r) => r.from <= s.to && r.to >= s.from)
  for (const s of symbols) {
    if (!touches(s.decl)) continue
    if (s.kind === 'node') add(s.id)
    else if (s.kind === 'stage') add(s.detail)
    else if (s.kind === 'component') {
      for (const n of scene.nodes) if (component(n, ev) === s.id) add(n.id)
    } else if (s.kind === 'flow') {
      add(scene.flowFrom[s.id])
      for (const st of ev.routes[s.id] ?? []) add(scene.stageNode[st])
    }
  }
  // the lines an edit is on: the boxes and stages they name (an edge, a route)
  for (const r of edits) {
    const from = text.lastIndexOf('\n', r.from - 1) + 1
    // lines typed in whole end where the next begins: that one is not the edit's
    const end = text.indexOf('\n', r.to > r.from && text[r.to - 1] === '\n' ? r.to - 1 : r.to)
    for (const w of text.slice(from, end < 0 ? text.length : end).match(/[A-Za-z_]\w*/g) ?? []) {
      add(w)
      add(scene.stageNode[w])
    }
  }
  const before = new Map(was.scene.nodes.map((n) => [n.id, n]))
  for (const n of scene.nodes) {
    const b = before.get(n.id)
    if (!b || Math.abs(b.w - n.w) > 0.5 || Math.abs(b.h - n.h) > 0.5) add(n.id)
  }
  const edgesWas = new Set(was.scene.edges.map((e) => e.id))
  const edgesNow = new Set(scene.edges.map((e) => e.id))
  for (const e of [...was.scene.edges, ...scene.edges])
    if (edgesWas.has(e.id) !== edgesNow.has(e.id)) {
      add(e.from)
      add(e.to)
    }
  if (!out.size)
    for (const n of scene.nodes) {
      const c = component(n, ev)
      if (c && was.ev.components[c]?.state !== ev.components[c]?.state) add(n.id)
    }
  return scene.nodes.filter((n) => out.has(n.id)).map((n) => n.id)
}
