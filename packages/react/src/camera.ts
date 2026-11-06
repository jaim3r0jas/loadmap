import type { Evaluation, Model, StoryStep, Values } from '@loadmap/core'
import { fmt, pct } from '@loadmap/core/format'
import type { Scene, SceneNode } from '@loadmap/layout'

/** A part of the scene the board shows, in scene units. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Each box's shape by id and the edges drawn, as `shapesOf` gives them: what a change of values reshapes. */
export interface Shapes {
  nodes: Record<string, string>
  edges: { id: string; from: string; to: string }[]
}

/**
 * The shots of a story played, in seconds: the whole diagram first, then for each step a flight in to what it changes,
 * a moment close, the change held close, a flight out, and the whole diagram for the step's own seconds. `back` is the
 * flight out when the reader pauses.
 */
export const SHOTS = { establish: 1.2, in: 1, close: 0.5, out: 1, back: 0.4 } as const

/** The change is held close until the structure has moved and settled. */
export const changeSeconds = (transition: number) => Math.max(1.6, transition + 0.7)

/** A step played, from the flight in to the end of its hold on the whole diagram. */
export const stepSeconds = (st: { seconds: number }, transition: number) =>
  SHOTS.in + SHOTS.close + changeSeconds(transition) + SHOTS.out + st.seconds

/** The whole story played, from the first shot of the whole diagram. */
export const storySeconds = (story: readonly { seconds: number }[], transition: number) =>
  story.reduce((t: number, st) => t + stepSeconds(st, transition), SHOTS.establish)

export const whole = (s: { width: number; height: number }): Rect => ({ x: 0, y: 0, w: s.width, h: s.height })

/** The component a box stands for: its stages' component, or its own. */
export function boxComponent(ev: Evaluation, n: SceneNode): string | undefined {
  return n.stages.map((s) => ev.stages[s]?.component).find(Boolean) ?? n.component ?? undefined
}

/**
 * The boxes a step's change is about, from the values before (`a`) to the step's (`b`): the box it points at and any box
 * the change reshapes; else the boxes it reshapes or an edge that comes or goes ends at; else those whose component
 * changes state; else the first limit after it.
 */
export function targets(
  scene: Scene,
  a: Evaluation,
  b: Evaluation,
  shapes: { a: Shapes; b: Shapes },
  focus?: string | null,
): string[] {
  const ids = new Set(scene.nodes.map((n) => n.id))
  const reshaped = new Set<string>()
  for (const id of ids) if (shapes.a.nodes[id] !== shapes.b.nodes[id]) reshaped.add(id)
  const edgesA = new Set(shapes.a.edges.map((e) => e.id))
  const edgesB = new Set(shapes.b.edges.map((e) => e.id))
  for (const e of [...shapes.a.edges, ...shapes.b.edges])
    if (edgesA.has(e.id) !== edgesB.has(e.id)) for (const end of [e.from, e.to]) if (ids.has(end)) reshaped.add(end)
  const of = (c: string | undefined) => scene.nodes.filter((n) => c && boxComponent(b, n) === c).map((n) => n.id)
  const order = (s: Set<string>) => scene.nodes.filter((n) => s.has(n.id)).map((n) => n.id)
  if (focus) return order(new Set([...of(focus), ...reshaped]))
  if (reshaped.size) return order(reshaped)
  const turned = scene.nodes.filter((n) => {
    const c = boxComponent(b, n)
    return c && a.components[c]?.state !== b.components[c]?.state
  })
  if (turned.length) return turned.map((n) => n.id)
  return of(b.firstLimit?.id)
}

/** Room around the boxes framed, in scene units: the first limit's tag sits above its box. */
const PAD = 30
/** The closest the camera comes: the boxes framed never fill more than this share of the board's width. */
const MAX_ZOOM = 2.5
/** Boxes that take more than this share of the board's width are shown on the whole diagram. */
const WIDE = 0.8

/**
 * The part of the scene that shows these boxes with room around them, at the scene's own shape (the board's), at most
 * 2.5× closer, inside the scene. The whole scene when there is nothing to frame or it would hardly be closer.
 */
export function framing(scene: Scene, ids: readonly string[]): Rect {
  const all = whole(scene)
  const ns = scene.nodes.filter((n) => ids.includes(n.id))
  if (!ns.length || !(scene.width > 0 && scene.height > 0)) return all
  const x0 = Math.min(...ns.map((n) => n.x))
  const y0 = Math.min(...ns.map((n) => n.y))
  const x1 = Math.max(...ns.map((n) => n.x + n.w))
  const y1 = Math.max(...ns.map((n) => n.y + n.h))
  const aspect = scene.width / scene.height
  let w = Math.max(x1 - x0 + 2 * PAD, (y1 - y0 + 2 * PAD) * aspect, scene.width / MAX_ZOOM)
  if (w > WIDE * scene.width) return all
  w = Math.min(w, scene.width)
  const h = w / aspect
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  return { x: clamp((x0 + x1 - w) / 2, scene.width - w), y: clamp((y0 + y1 - h) / 2, scene.height - h), w, h }
}

/** Cubic in and out. */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * The camera `t` of the way from `a` to `b` (eased): the centre moves evenly, the size changes by the same factor
 * each moment, so a zoom feels even whatever its depth.
 */
export function between(a: Rect, b: Rect, t: number): Rect {
  const k = ease(Math.max(0, Math.min(1, t)))
  const w = a.w * (b.w / a.w) ** k
  const h = a.h * (b.h / a.h) ** k
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - a.x - a.w / 2) * k
  const cy = a.y + a.h / 2 + (b.y + b.h / 2 - a.y - a.h / 2) * k
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** A label's first words: "Users, × today" says "Users". */
const short = (label: string) => label.split(',')[0]!.trim()

/** At most this many changed values in a title; the rest are counted. */
const TITLE_VALUES = 2

/**
 * The few words the diagram shows for a step: its own title, or what it changes ("Proposed: Gateway instances 1 → 2,
 * Worker pods 3 → 6"), numbered.
 */
export function stepTitle(model: Model, from: Values<any>, st: StoryStep, i: number): string {
  if (st.title) return `${i + 1} · ${st.title}`
  const say = (k: string, v: unknown) => {
    if (k === 'load') return `${fmt(v as number)}×`
    const def = model.params.find((x) => x.id === k)?.def
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    if (def && def.kind !== 'load' && 'format' in def && def.format) return def.format(v as never)
    return typeof v === 'number' ? fmt(v) : String(v)
  }
  const changed = Object.keys(st.values).filter((k) => (from as Record<string, unknown>)[k] !== st.values[k])
  const parts = changed.slice(0, TITLE_VALUES).map((k) => {
    const label = k === 'load' ? model.load.label : (model.params.find((x) => x.id === k)?.def.label ?? k)
    const to = (st.values as Record<string, unknown>)[k]
    const was = (from as Record<string, unknown>)[k]
    return typeof to === 'boolean' ? `${short(label)} ${say(k, to)}` : `${short(label)} ${say(k, was)} → ${say(k, to)}`
  })
  if (changed.length > TITLE_VALUES) parts.push(`${changed.length - TITLE_VALUES} more`)
  const what = parts.join(', ') || 'Nothing changes'
  return `${i + 1} · ${st.scenario && changed.length ? `${st.scenario}: ${what}` : what}`
}

/** What the framed components show: their utilization now, or before and after the change. */
export function stepDetail(a: Evaluation, b: Evaluation | null, components: readonly string[]): string {
  return components
    .slice(0, 2)
    .map((c) => {
      const was = a.components[c]
      const now = b?.components[c]
      if (!was) return ''
      const u = (x: number | null | undefined) => (x == null ? 'off' : pct(x))
      return now ? `${was.name} ${u(was.util)} → ${u(now.util)}` : `${was.name} ${u(was.util)}`
    })
    .filter(Boolean)
    .join(' · ')
}
