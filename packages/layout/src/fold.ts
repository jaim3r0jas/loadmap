import type { Box, Frame, Laid, SceneTier } from './layout'
import type { TextMeasure } from './text'
import type { View } from './view'

// Nothing here is imported from the layout but types: a page loads this file with the first diagram that is folded,
// and a chunk that reached back into the layout's would split that one in two for every page. What the fold needs of
// it comes as `Kit`.
export interface Kit {
  PADDING: number
  HEAD: number
  HEAD_LINE: number
  TIER_PAD: number
  wrap(name: string, room: number, measure: TextMeasure): string[]
  lane(
    view: View,
    tier: string,
    id: string,
    a: number,
    b: number,
    lines: string[],
    head: number,
    down: boolean,
    top: number,
    bottom: number,
  ): SceneTier
}

// Folding is written for a flow that runs right: rows of layers, one under the other. A frame that runs down is turned
// on its diagonal first and turned back after, so its rows are columns side by side.

/** How far before a row's first layer the row starts: past every bend, on the straight run into the boxes. */
const CUT = 8
/** The room between two edges that go round a fold side by side. */
const TRACK = 12
/** The room between a row and the edges that go round under it. */
const GUTTER = 16
/** How much longer a row may be for a cut to fall between two tiers rather than inside one. */
const INSIDE = 1.3

type P = [number, number]

interface Row {
  /** The row's span along the flow, in the frame as ELK laid it out. */
  from: number
  to: number
  /** How far the row's contents move, and its band across the flow, on the folded board. */
  dx: number
  dy: number
  top: number
  bottom: number
}

/** The frame turned on its diagonal: what runs down runs right, and back. */
function turned(l: Laid): Laid {
  const box = (b: Box): Box => ({ x: b.y, y: b.x, w: b.h, h: b.w })
  return {
    width: l.height,
    height: l.width,
    slots: new Map([...l.slots].map(([id, b]) => [id, box(b)])),
    routes: new Map(
      [...l.routes].map(([id, r]) => [
        id,
        { points: r.points.map(([x, y]): P => [y, x]), label: r.label && box(r.label) },
      ]),
    ),
  }
}

/** The layers as ELK drew them: the boxes whose spans along the flow overlap stand in one. */
function layersOf(l: Laid): { from: number; to: number; ids: string[] }[] {
  const layers: { from: number; to: number; ids: string[] }[] = []
  for (const [id, b] of [...l.slots].sort((a, b) => a[1].x - b[1].x || (a[0] < b[0] ? -1 : 1))) {
    const last = layers.at(-1)
    if (last && b.x < last.to - 1) {
      last.to = Math.max(last.to, b.x + b.w)
      last.ids.push(id)
    } else layers.push({ from: b.x, to: b.x + b.w, ids: [id] })
  }
  return layers
}

/**
 * Where to cut the frame into `rows` rows: between layers, so that the longest row is as short as can be, and between
 * two tiers rather than inside one unless that makes the longest row clearly longer. Fewer cuts than asked where the
 * frame has fewer layers. A cut stands just before its next layer, so the room between the layers, with the labels of
 * the edges that cross it, ends the row before.
 */
function cutsFor(l: Laid, rows: number, inside: (before: string[], after: string[]) => boolean): number[] {
  const layers = layersOf(l)
  const n = Math.min(rows, layers.length) - 1
  if (n < 1) return []
  const at = (i: number) => {
    const [a, b] = [layers[i - 1]!, layers[i]!]
    return b.from - a.to > 2 * CUT ? b.from - CUT : (a.to + b.from) / 2
  }
  let best: { cost: number; cuts: number[] } | null = null
  const pick = (from: number, picked: number[]) => {
    if (picked.length === n) {
      const bounds = [0, ...picked.map(at), l.width]
      const longest = Math.max(...bounds.slice(1).map((b, i) => b - bounds[i]!))
      const held = picked.filter((i) => inside(layers[i - 1]!.ids, layers[i]!.ids)).length
      const cost = longest * INSIDE ** held
      if (!best || cost < best.cost - 1e-6) best = { cost, cuts: picked.map(at) }
      return
    }
    for (let i = from; i <= layers.length - (n - picked.length); i++) pick(i + 1, [...picked, i])
  }
  pick(1, [])
  return (best as { cuts: number[] } | null)?.cuts ?? []
}

/**
 * The frame cut at `cuts` and its rows put one under the other, each with `before` clear above its contents and
 * `after` below (the room at the board's edge too). An edge that crosses a cut leaves its row at the end, goes round under it and comes into the next row
 * from its start: the edges of one fold nest, each on a track of its own, so none of them cross on the way round.
 */
function folded(
  l: Laid,
  cuts: number[],
  before: number,
  after: number,
): { l: Laid; rows: Row[]; rowOf: Map<string, number> } {
  const bounds = [0, ...cuts, l.width]
  const count = bounds.length - 1
  const rowAt = (x: number) => cuts.filter((c) => x >= c).length
  const rowOf = new Map([...l.slots].map(([id, b]) => [id, rowAt(b.x)]))

  // each route in pieces, one per row it passes through, in its own order
  const pieces = new Map<string, { row: number; points: P[] }[]>()
  for (const [id, r] of l.routes) {
    const out: { row: number; points: P[] }[] = []
    r.points.forEach((q, i) => {
      const p = r.points[i - 1]
      const row = rowAt(q[0])
      if (!p) {
        out.push({ row, points: [q] })
        return
      }
      let now = out.at(-1)!
      // a run along the flow that passes a cut ends its piece there and starts the next
      const step = row > now.row ? 1 : -1
      while (now.row !== row) {
        const c = step > 0 ? cuts[now.row]! : cuts[now.row - 1]!
        const y = q[0] === p[0] ? q[1] : p[1] + ((q[1] - p[1]) * (c - p[0])) / (q[0] - p[0])
        now.points.push([c, y])
        now = { row: now.row + step, points: [[c, y]] }
        out.push(now)
      }
      now.points.push(q)
    })
    pieces.set(id, out)
  }

  // what each row holds across the flow
  const spans = Array.from({ length: count }, () => ({ min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }))
  const reach = (row: number, a: number, b: number) => {
    const s = spans[row]!
    s.min = Math.min(s.min, a)
    s.max = Math.max(s.max, b)
  }
  for (const [id, b] of l.slots) reach(rowOf.get(id)!, b.y, b.y + b.h)
  const labelRow = (b: Box) => rowAt(b.x + b.w / 2)
  for (const [id, r] of l.routes) {
    for (const piece of pieces.get(id)!) for (const [, y] of piece.points) reach(piece.row, y, y)
    if (r.label) reach(labelRow(r.label), r.label.y, r.label.y + r.label.h)
  }

  // the edges that go round each fold, the one that leaves nearest the fold first: it turns first and comes in last
  const rounds = Array.from({ length: cuts.length }, () => [] as { id: string; i: number; y: number }[])
  for (const [id, ps] of pieces)
    ps.forEach((piece, i) => {
      const next = ps[i + 1]
      if (!next) return
      const upper = piece.row < next.row ? piece : next
      const y = (upper === piece ? piece.points.at(-1)! : next.points[0]!)[1]
      rounds[upper.row]!.push({ id, i, y })
    })
  for (const r of rounds) r.sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : 1) || a.i - b.i)
  const most = Math.max(0, ...rounds.map((r) => r.length))

  const lead = TRACK * most
  const rows: Row[] = []
  let top = 0
  for (let k = 0; k < count; k++) {
    const s = spans[k]!
    const bottom = top + before + (s.max - s.min) + after
    // every row's first boxes stand under the first row's
    const dx = lead - bounds[k]! + (k > 0 ? after - (layerStart(l, bounds[k]!) - bounds[k]!) : 0)
    rows.push({ from: bounds[k]!, to: bounds[k + 1]!, dx, dy: top + before - s.min, top, bottom })
    const round = rounds[k]?.length ?? 0
    top = bottom + (k < count - 1 ? (round ? 2 * GUTTER + (round - 1) * TRACK : GUTTER) : 0)
  }

  const move = (row: number, [x, y]: P): P => [x + rows[row]!.dx, y + rows[row]!.dy]
  const routes: Laid['routes'] = new Map()
  for (const [id, r] of l.routes) {
    const ps = pieces.get(id)!
    const points: P[] = []
    ps.forEach((piece, i) => {
      const moved = piece.points.map((p) => move(piece.row, p))
      const prev = ps[i - 1]
      // the piece's end at a cut is on a straight run: the way round starts and ends on it
      points.push(...(prev ? moved.slice(1) : moved).slice(0, ps[i + 1] ? -1 : undefined))
      const next = ps[i + 1]
      if (!next) return
      const down = next.row > piece.row
      const [upper, lower] = down ? [piece, next] : [next, piece]
      const round = rounds[upper.row]!
      const t = round.findIndex((x) => x.id === id && x.i === i)
      const out = move(upper.row, down ? piece.points.at(-1)! : next.points[0]!)
      const into = move(lower.row, down ? next.points[0]! : piece.points.at(-1)!)
      const right = out[0] + TRACK * (t + 1)
      const left = into[0] - TRACK * (round.length - t)
      const under = rows[upper.row]!.bottom + GUTTER + t * TRACK
      const way: P[] = [
        [right, out[1]],
        [right, under],
        [left, under],
        [left, into[1]],
      ]
      points.push(...(down ? way : way.reverse()))
    })
    const label =
      r.label &&
      (() => {
        const [x, y] = move(labelRow(r.label), [r.label.x, r.label.y])
        return { ...r.label, x, y }
      })()
    routes.set(id, { points, label })
  }
  const slots = new Map(
    [...l.slots].map(([id, b]): [string, Box] => {
      const [x, y] = move(rowOf.get(id)!, [b.x, b.y])
      return [id, { ...b, x, y }]
    }),
  )
  // a row that edges leave ends with the room they turn in; the last ends as the frame did
  const width = Math.max(
    ...rows.map((r, k) => r.dx + r.to + (rounds[k]?.length ? TRACK * rounds[k]!.length + after : 0)),
  )
  return { l: { width: Math.ceil(width), height: Math.ceil(rows.at(-1)!.bottom), slots, routes }, rows, rowOf }
}

/** Where the first layer at or after `x` starts. */
function layerStart(l: Laid, x: number): number {
  return Math.min(...[...l.slots.values()].map((b) => b.x).filter((v) => v >= x))
}

/**
 * A laid-out frame folded into `rows` rows (columns, running down), with each row's lanes: a tier's band in every row
 * that holds its boxes, each with its own header. What `lanes` gives for one row, for several.
 */
export function foldLanes(
  laid: Laid,
  frame: Frame,
  view: View,
  measure: TextMeasure,
  rows: number,
  kit: Kit,
): { l: Laid; tiers: SceneTier[] } {
  const down = frame.direction === 'DOWN'
  const flat = down ? turned(laid) : laid
  const ids = frame.tiers ?? []
  const tierOf = (id: string) => frame.order?.[id]
  const cuts = cutsFor(flat, rows, (a, b) => ids.length > 0 && a.some((x) => b.some((y) => tierOf(x) === tierOf(y))))
  const rowAt = (x: number) => cuts.filter((c) => x >= c).length
  const bounds = [0, ...cuts, flat.width]

  // each tier's part in each row, named as wide as its band there
  const parts = bounds.slice(1).flatMap((_, row) => {
    const spans = ids.map((_, i) => {
      const mine = frame.nodes
        .filter((n) => tierOf(n.id) === i && rowAt(flat.slots.get(n.id)!.x) === row)
        .map((n) => flat.slots.get(n.id)!)
      return mine.length
        ? ([Math.min(...mine.map((b) => b.x)), Math.max(...mine.map((b) => b.x + b.w))] as const)
        : null
    })
    return ids.flatMap((id, i) => {
      const span = spans[i]
      if (!span) return []
      const beforeIt = spans.slice(0, i).findLast((x) => x != null)
      const afterIt = spans.slice(i + 1).find((x) => x != null)
      const a = beforeIt ? (beforeIt[1] + span[0]) / 2 : null
      const b = afterIt ? (span[1] + afterIt[0]) / 2 : null
      const room = (b ?? bounds[row + 1]!) - (a ?? bounds[row]!) - 2 * kit.TIER_PAD
      return [{ id, row, a, b, lines: kit.wrap((view.def.tiers?.[id]?.label ?? id).toUpperCase(), room, measure) }]
    })
  })
  const head = parts.length ? kit.HEAD + (Math.max(...parts.map((p) => p.lines.length)) - 1) * kit.HEAD_LINE : 0
  const out = folded(flat, cuts, kit.PADDING + head, kit.PADDING)
  const seen = new Set<string>()
  const tiers = parts.map(({ id, row, a, b, lines }) => {
    const r = out.rows[row]!
    // a tier in a second row is a lane of its own
    const part = seen.has(id) ? `${id}/${row + 1}` : id
    seen.add(id)
    return kit.lane(
      view,
      id,
      part,
      a == null ? 0 : a + r.dx,
      b == null ? out.l.width : b + r.dx,
      lines,
      head,
      down,
      r.top,
      r.bottom,
    )
  })
  return { l: down ? turned(out.l) : out.l, tiers }
}
