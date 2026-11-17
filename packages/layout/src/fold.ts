import type { Arrangement, Room, Sized } from './direction'
import type { Box, Direction, Frame, foldKit, Laid, LayoutOptions, SceneTier } from './layout'
import type { TextMeasure } from './text'
import type { View } from './view'

// Nothing here is imported from the layout but types: a page loads this file with the first diagram that is folded,
// and a chunk that reached back into the layout's would split that one in two for every page. What the fold needs of
// it comes as `Kit`.
type Kit = typeof foldKit

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
/** How far past a cut an edge may stray and still belong to the row it comes back to: the room between two layers. */
const STRAY = 64

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
  // where a row that starts with layer i starts, and where the frame ends
  const at = (i: number) => {
    if (i === 0) return 0
    if (i === layers.length) return l.width
    const [a, b] = [layers[i - 1]!, layers[i]!]
    return b.from - a.to > 2 * CUT ? b.from - CUT : (a.to + b.from) / 2
  }
  const held = (i: number) => (inside(layers[i - 1]!.ids, layers[i]!.ids) ? 1 : 0)
  // the shortest longest row for the layers from i on in k rows with h cuts inside a tier, and its first cut: each
  // found once, so a long diagram in many rows is no slower than a short one in few
  type Best = { longest: number; next: number; h: number } | null
  const memo = new Map<string, Best>()
  const best = (i: number, k: number, h: number): Best => {
    if (k === 1) return h === 0 ? { longest: at(layers.length) - at(i), next: -1, h: 0 } : null
    const key = `${i} ${k} ${h}`
    if (memo.has(key)) return memo.get(key)!
    let found: Best = null
    for (let j = i + 1; j <= layers.length - (k - 1); j++) {
      const rest = h - held(j) < 0 ? null : best(j, k - 1, h - held(j))
      if (!rest) continue
      const longest = Math.max(at(j) - at(i), rest.longest)
      if (!found || longest < found.longest - 1e-6) found = { longest, next: j, h: h - held(j) }
    }
    memo.set(key, found)
    return found
  }
  let pick: { cost: number; h: number } | null = null
  for (let h = 0; h <= n; h++) {
    const b = best(0, n + 1, h)
    if (b && (!pick || b.longest * INSIDE ** h < pick.cost - 1e-6)) pick = { cost: b.longest * INSIDE ** h, h }
  }
  const cuts: number[] = []
  for (let [i, k, h] = [0, n + 1, pick?.h ?? 0]; k > 1; k--) {
    const b = best(i, k, h)
    if (!b) break
    cuts.push(at(b.next))
    i = b.next
    h = b.h
  }
  return cuts
}

/**
 * The frame cut at `cuts` and its rows put one under the other, each with `before` clear above its contents and
 * `after` below (the room at the board's edge too). An edge that crosses a cut leaves its row at the end, goes round
 * under it and comes into the next row from its start: the edges of one fold nest, each on a track of its own, so none
 * of them cross on the way round. `lead` is the room before every row that those edges come down in.
 */
function folded(
  l: Laid,
  cuts: number[],
  before: number,
  after: number,
): { l: Laid; rows: Row[]; rowOf: Map<string, number>; lead: number } {
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
    // an edge that only turns just past a cut and comes back (a way back into a row's first layer) stays in its row:
    // it is not sent round the fold and back
    for (let i = 1; i < out.length - 1; i++) {
      const [a, mid, b] = [out[i - 1]!, out[i]!, out[i + 1]!]
      const c = mid.points[0]![0]
      if (a.row !== b.row || mid.points.some(([x]) => Math.abs(x - c) > STRAY)) continue
      a.points.push(...mid.points.slice(1, -1), ...b.points.slice(1))
      out.splice(i, 2)
      i--
    }
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
  for (const r of rounds) r.sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.i - b.i))
  const most = Math.max(0, ...rounds.map((r) => r.length))

  // an edge that strays past its row's start (see above) still stands on the board
  const stray = Math.max(
    0,
    ...[...pieces.values()].flatMap((ps) => ps.flatMap((p) => p.points.map(([x]) => bounds[p.row]! - x))),
  )
  const lead = Math.max(TRACK * most, Math.ceil(stray))
  // and one that strays past its row's end has room there, before the edges that go round
  const past = Array.from({ length: count }, (_, k) =>
    Math.max(
      0,
      ...[...pieces.values()].flatMap((ps) =>
        ps.flatMap((p) => (p.row === k && k < count - 1 ? p.points.map(([x]) => x - bounds[k + 1]!) : [])),
      ),
    ),
  )
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
      const right = out[0] + past[upper.row]! + TRACK * (t + 1)
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
  // a row that ends at a cut ends with the room its edges turn in and the board's edge; the last ends as the frame did
  const width = Math.max(
    ...rows.map((r, k) => r.dx + r.to + (k < count - 1 ? past[k]! + TRACK * (rounds[k]?.length ?? 0) + after : 0)),
  )
  return { l: { width: Math.ceil(width), height: Math.ceil(rows.at(-1)!.bottom), slots, routes }, rows, rowOf, lead }
}

/** Where the first layer at or after `x` starts. */
function layerStart(l: Laid, x: number): number {
  return Math.min(...[...l.slots.values()].map((b) => b.x).filter((v) => v >= x))
}

/**
 * A laid-out frame folded into `rows` rows (columns, running down), with each row's lanes: a tier's band in every row
 * that holds its boxes, each with its own header, clear of the edges that come round into the row. What `lanes` gives
 * for one row, for several.
 */
export function foldLanes(
  laid: Laid,
  frame: Frame,
  view: View,
  measure: TextMeasure,
  rows: number,
  kit: Kit,
): { l: Laid; tiers: SceneTier[] } {
  // nothing to fold
  if (!laid.slots.size) return { l: laid, tiers: [] }
  const down = frame.direction === 'DOWN'
  const flat = down ? turned(laid) : laid
  const tierOf = (id: string) => frame.order?.[id]
  const tiered = !!frame.tiers?.length
  const cuts = cutsFor(
    flat,
    rows,
    (a, b) => tiered && a.some((x) => tierOf(x) != null && b.some((y) => tierOf(x) === tierOf(y))),
  )
  const rowAt = (x: number) => cuts.filter((c) => x >= c).length
  const bounds = [0, ...cuts, flat.width]

  // each tier's part in each row, named as wide as its band there
  const parts = bounds.slice(1).flatMap((to, row) => {
    const from = bounds[row]!
    const span = (id: string) => {
      const b = flat.slots.get(id)!
      return rowAt(b.x) === row ? ([b.x, b.x + b.w] as const) : null
    }
    return kit.tierParts(view, frame, span, from, to, measure).map((part) => ({ ...part, row, from, to }))
  })
  const head = parts.length ? kit.headOf(parts) : 0
  const out = folded(flat, cuts, kit.PADDING + head, kit.PADDING)
  const seen = new Set<string>()
  const tiers = parts.map(({ id, row, a, b, lines, from, to }) => {
    const r = out.rows[row]!
    // a tier in a second row is a lane of its own
    const part = seen.has(id) ? `${id}/${row + 1}` : id
    seen.add(id)
    return kit.lane(view, {
      tier: id,
      id: part,
      // a row's first lane starts past the edges that come round into it, its last ends with the board
      along: [a === from ? out.lead : a + r.dx, b === to ? out.l.width : b + r.dx],
      across: [r.top, r.bottom],
      lines,
      head,
      down,
    })
  })
  return { l: down ? turned(out.l) : out.l, tiers }
}

type Size = { width: number; height: number }
const extents = new WeakMap<TextMeasure, WeakMap<View, Map<string, Promise<Size>>>>()

/** `extent` in layout.ts: once per view and arrangement (a resize asks again at every pixel), ELK once per direction. */
export function extent(kit: Kit, view: View, direction: Direction, o: Omit<LayoutOptions, 'direction'>): Promise<Size> {
  const measure = o.measure ?? kit.estimateText
  const rows = kit.rowsOf(o)
  const byView = extents.get(measure) ?? new WeakMap<View, Map<string, Promise<Size>>>()
  extents.set(measure, byView)
  const sizes = byView.get(view) ?? new Map<string, Promise<Size>>()
  byView.set(view, sizes)
  const key = `${direction} ${rows}`
  let size = sizes.get(key)
  if (!size) {
    size = (async () => {
      const frame = kit.ordered(view, kit.reserve(view, direction, measure), measure)
      const laid = await kit.laidOut(view, frame, o.elk)
      const { l } = rows > 1 ? foldLanes(laid, frame, view, measure, rows, kit) : kit.lanes(laid, frame, view, measure)
      return { width: l.width, height: l.height }
    })()
    // one that fails is let go, so the next call tries again
    size.catch(() => sizes.delete(key))
    sizes.set(key, size)
  }
  return size
}

/** `arrange` in layout.ts. */
export async function arrange(
  kit: Kit,
  view: View,
  ways: readonly Arrangement[],
  room: Room,
  keep: Arrangement,
  o: Omit<LayoutOptions, 'direction' | 'rows'>,
): Promise<Arrangement> {
  const sized = (among: readonly Arrangement[]) =>
    Promise.all(among.map(async (w) => ({ ...w, ...(await extent(kit, view, w.direction, { ...o, rows: w.rows })) })))
  const rows = Math.min(...ways.map((w) => w.rows))
  const flat = await sized(ways.filter((w) => w.rows === rows))
  const plain = plainOf(flat, room, keep)
  // the folds are sized only where one row is hard to read: most diagrams never lay one out
  const more = plain && !reads(plain, room, keep) ? await sized(ways.filter((w) => w.rows !== rows)) : []
  return arrangementFor([...flat, ...more], room, keep)
}

/** How much better another arrangement must fit before the diagram changes: a drag near the edge changes nothing. */
const TURN = 1.15
/** The scale under which a box's title is no longer read with ease: 10 px of its 13. Only then is a diagram folded. */
const LEGIBLE = 10 / 13

/**
 * How a diagram is arranged in a room, among the arrangements it may take (`sizes`: one direction or both, one row
 * count or several). It stays as it stands (`keep`: as it is now, or as its shape runs) unless another fits the room
 * clearly larger, and no scale past full size counts: a diagram that reads well does not change to be drawn larger
 * still. It is folded only where its titles would be hard to read in one row, and then into the fewest rows that fit
 * about as large as the best.
 */
export function arrangementFor(sizes: readonly Sized[], room: Room, keep: Arrangement): Arrangement {
  const fit = (s: Sized) => fitIn(room, s)
  const out = ({ direction, rows }: Arrangement): Arrangement => ({ direction, rows })
  const plain = plainOf(sizes, room, keep)
  if (!plain) return out(keep)
  if (reads(plain, room, keep)) return out(plain)
  const stands = sizes.find((s) => s.direction === keep.direction && s.rows === keep.rows) ?? plain
  // the fewest rows first, then the way it runs, then the larger
  const turned = (s: Sized) => (s.direction === stands.direction ? 0 : 1)
  const fewest = (among: Sized[]) =>
    among.reduce((b, s) => ((s.rows - b.rows || turned(s) - turned(b) || fit(b) - fit(s)) < 0 ? s : b))
  const best = sizes.reduce((b, s) => (fit(s) > fit(b) ? s : b), stands)
  // as it stands unless another fits clearly larger; in fewer rows where those fit as large (a room that grew)
  if (fit(best) <= fit(stands) * TURN)
    return out(fewest(sizes.filter((s) => s.rows <= stands.rows && fit(s) >= fit(stands))))
  return out(fewest(sizes.filter((s) => fit(s) * TURN >= fit(best))))
}

const fitIn = (room: Room, s: Sized) => Math.min(room.w / s.width, room.h / s.height, 1)

/** The arrangement in the fewest rows given: the way the diagram runs unless the other fits clearly larger. */
function plainOf(sizes: readonly Sized[], room: Room, keep: Arrangement): Sized | undefined {
  const rows = Math.min(...sizes.map((s) => s.rows))
  const flat = sizes.filter((s) => s.rows === rows)
  const first = flat.find((s) => s.direction === keep.direction) ?? flat[0]
  return first && flat.reduce((b, s) => (fitIn(room, s) > fitIn(room, b) * TURN ? s : b), first)
}

/** Whether the diagram's titles read with ease in `plain`; one that is folded unfolds only past that by a margin. */
const reads = (plain: Sized, room: Room, keep: Arrangement) =>
  fitIn(room, plain) >= LEGIBLE * (keep.rows > plain.rows ? TURN : 1)
