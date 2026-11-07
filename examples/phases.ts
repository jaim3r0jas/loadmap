// The phases a reader moves a model through: in a stable layout none of them moves a box, in a compact one the load
// never does and each phase is laid out the same whatever came before.
import type { Model, Values } from '@loadmap/core'
import { collisions, type Direction, layout, type Scene, type View } from '@loadmap/layout'
import { expect } from 'vitest'

/** The defaults, every scenario, story step and declared preset, and each control's every option on its own. */
export function phases(model: Model): [string, Partial<Values<any>>][] {
  const out: [string, Partial<Values<any>>][] = [['defaults', {}]]
  for (const s of model.scenarios) out.push([`scenario ${s.label}`, s.values])
  for (const [i, s] of model.story.entries()) out.push([`step ${i + 1}`, s.values])
  for (const [label, v] of Object.entries(model.def.presets ?? {}))
    out.push([`preset ${label}`, v as Partial<Values<any>>])
  for (const { id, def } of model.params)
    if (def.kind === 'select') for (const o of def.options) out.push([`${id}: ${o}`, { [id]: o }])
    else if (def.kind === 'switch') for (const o of [false, true]) out.push([`${id}: ${o}`, { [id]: o }])
  return out
}

const centre = (b: { x: number; y: number; w: number; h: number }) =>
  [b.x + b.w / 2, b.y + b.h / 2].map((x) => Math.round(x * 100) / 100)

/** Every edge starts on the side of its box the flow runs to and ends on the other. */
export function expectEdgesOnBoxes(scene: Scene) {
  const at = new Map(scene.nodes.map((n) => [n.id, n]))
  const down = scene.direction === 'DOWN'
  for (const e of scene.edges) {
    const a = at.get(e.from)!
    const b = at.get(e.to)!
    const [first, last] = [e.points[0]!, e.points.at(-1)!]
    const msg = `${e.id} ${e.from} → ${e.to}`
    if (down) {
      expect(first[1], msg).toBeCloseTo(a.y + a.h)
      expect(first[0], msg).toBeGreaterThan(a.x)
      expect(first[0], msg).toBeLessThan(a.x + a.w)
      expect(last[1], msg).toBeCloseTo(b.y)
      expect(last[0], msg).toBeGreaterThan(b.x)
      expect(last[0], msg).toBeLessThan(b.x + b.w)
    } else {
      expect(first[0], msg).toBeCloseTo(a.x + a.w)
      expect(first[1], msg).toBeGreaterThan(a.y)
      expect(first[1], msg).toBeLessThan(a.y + a.h)
      expect(last[0], msg).toBeCloseTo(b.x)
      expect(last[1], msg).toBeGreaterThan(b.y)
      expect(last[1], msg).toBeLessThan(b.y + b.h)
    }
    // still at right angles
    for (let i = 1; i < e.points.length; i++) {
      const [p, q] = [e.points[i - 1]!, e.points[i]!]
      expect(Math.min(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])), msg).toBeLessThan(0.01)
    }
  }
}

/** The view laid out stable, or compact: a copy of its own, with caches of its own. */
export function laidOut<V extends View>(view: V, layout: 'compact' | 'stable'): V {
  return { ...view, def: { ...view.def, layout } }
}

/** In a stable layout, no phase moves a box, resizes the board or lets a label overlap anything. */
export async function expectSteady(compact: View, model: Model, direction: Direction) {
  const view = laidOut(compact, 'stable')
  const first = await layout(view, model.evaluate(), { direction })
  for (const [label, values] of phases(model)) {
    const scene = await layout(view, model.evaluate(values), { direction })
    expect([scene.width, scene.height], label).toEqual([first.width, first.height])
    for (const n of scene.nodes)
      expect(centre(n), `${label}: ${n.id}`).toEqual(centre(first.nodes.find((m) => m.id === n.id)!))
    expect(collisions(scene), label).toEqual([])
    expectEdgesOnBoxes(scene)
  }
}

/** The loads a test moves a phase through: both ends of the slider, its default and a few between. */
function someLoads(model: Model): number[] {
  const { min, max, step, default: at } = model.load
  const snap = (x: number) => Math.min(max, min + Math.round((x - min) / step) * step)
  return [...new Set([min, snap(min + (max - min) / 3), at, snap(min + ((max - min) * 2) / 3), max])]
}

const placed = (s: Scene) => ({
  size: [s.width, s.height],
  nodes: Object.fromEntries(s.nodes.map((n) => [n.id, centre(n)])),
})

/**
 * In a compact layout, no load moves a box or resizes the board in any phase, no label overlaps anything, and each
 * phase is laid out the same whatever came before it: laid out again in the other order, on a fresh copy of the view,
 * every scene is the same.
 */
export async function expectCompact(view: View, model: Model, direction: Direction) {
  const all = phases(model)
  const scenes = new Map<string, Scene>()
  for (const [label, values] of all) {
    const scene = await layout(view, model.evaluate(values), { direction })
    scenes.set(label, scene)
    expect(collisions(scene), label).toEqual([])
    expectEdgesOnBoxes(scene)
    for (const load of someLoads(model)) {
      const at = await layout(view, model.evaluate({ ...values, load }), { direction })
      expect(placed(at), `${label} at ${load}×`).toEqual(placed(scene))
      expect(collisions(at), `${label} at ${load}×`).toEqual([])
    }
  }
  const fresh = laidOut(view, 'compact')
  for (const [label, values] of [...all].reverse())
    expect(await layout(fresh, model.evaluate(values), { direction }), label).toEqual(scenes.get(label))
}
