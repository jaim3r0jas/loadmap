import { type CatalogComponent, type ConditionValue, type Published, published } from '@loadmap/core'
import type { Decl, Edge, Ident, Stmt } from './ast'
import { type CompileOptions, compile, declarations } from './compile'
import type { TextChange } from './edit'
import { boxOf } from './fixes'
import { parse } from './parser'
import { BOXES, STAGES } from './schema'
import { parseUnit, sizeScale } from './units'

/** A stage a catalog component can run: what the dots do in its box. */
export type CatalogStage = 'queue' | 'cache' | 'store' | 'pass'

/**
 * The box a catalog component is drawn as and the stages its kind runs, the first one by default: a queue lives only
 * in a cluster, every other stage in a node. A kind without a stage (a platform, a mesh) is a component only.
 */
export function catalogBox(c: Pick<CatalogComponent, 'kind'>): {
  box: 'node' | 'cluster'
  stages: readonly CatalogStage[]
} {
  switch (c.kind) {
    case 'stream':
    case 'queue':
      return { box: 'cluster', stages: ['queue'] }
    case 'cache':
      return { box: 'node', stages: ['cache'] }
    case 'database':
    case 'store':
    case 'analytics':
    case 'search':
      return { box: 'node', stages: ['store', 'pass'] }
    case 'proxy':
    case 'dns':
      return { box: 'node', stages: ['pass'] }
    default:
      return { box: 'node', stages: [] }
  }
}

/** Where a new box goes on a flow's route: at an index of it, 0 before its first stage, its length after its last. */
export interface CatalogRoute {
  flow: string
  at: number
}

/** How flows use a new box from the catalog. Without it, the box runs its kind's first stage and no flow passes it. */
export interface CatalogUse {
  /** The box's id and label: by default the component's id (made unique) and name. */
  id?: string
  label?: string
  /** One of its kind's stages (`catalogBox`); without one, a store where every route ends at it, else the first. */
  stage?: CatalogStage
  /** A cache's hit ratio, 0 to 1. */
  hit?: number
  /** A queue's partitions for each flow through it: 1 by default. */
  partitions?: number
  routes?: readonly CatalogRoute[]
  /** A connection rule of the component (`kafka/consumer-group`), on the hop from its queue to the stage after it. */
  rule?: string
  /**
   * For a figure in a unit that is neither units nor bytes a second (tpmC): what one unit a second reaching it is
   * worth, in that unit.
   */
  worth?: number
}

/** What the editor's catalog picker writes: a published figure, and the box that uses it. */
export interface CatalogPick {
  /** A component of an edition, as the catalog gives it. */
  component: Published
  conditions: Readonly<Record<string, ConditionValue>>
  version?: string
  figure?: string
  /** A new box drawn for it, or the id of a box whose capacity it becomes. */
  into: 'new' | { box: string }
  /** For a new box: its stage, and the flows routed through it. */
  use?: CatalogUse
}

export type AddResult = { source: string; changes: TextChange[]; id: string; box: string } | { error: string }

/** The members of a cluster, as its figure's run had them: brokers, nodes or members. */
const MEMBERS = ['brokers', 'nodes', 'members']

/** "1 KB", "100 B": a size a run used, as the language writes one (`1KB`, `0.1KB`). */
function sizeLiteral(v: ConditionValue): string | undefined {
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)\s*(B|kB|KB|MB|GB|TB)$/.exec(v.trim()) : null
  if (!m) return undefined
  const n = Number(m[1])
  return m[2] === 'B' ? `${n / 1000}KB` : `${n}${m[2]!.toUpperCase()}`
}

/** The demand line of a new box: in its figure's unit, never scaling the figure. */
function demandLines(stage: CatalogStage | undefined, id: string, unit: string, pick: CatalogPick): string[] {
  if (!stage) return [`# what reaches it, in ${unit || 'the unit of its capacity'}`, 'demand: 0']
  const rate = !unit || parseUnit(unit).time === -1
  if (rate && sizeScale(unit) !== undefined) {
    // bytes a second: what reaches it, each unit at the size its run was made with, so the two never disagree
    const size = Object.values(pick.conditions).map(sizeLiteral).find(Boolean)
    if (size) return [`# each unit at the size its published run used, as ${unit}`, `demand: at.${id} * ${size}`]
    return [`# what reaches it, in ${unit}`, 'demand: 0']
  }
  // units a second: what reaches its stage, which a component without a demand line handles; a queue's units only
  // wait in it, so its cluster says what it handles
  if (rate) return stage === 'queue' ? [`demand: at.${id}`] : []
  return [`# what one unit a second reaching it is worth, in ${unit}`, `demand: at.${id} * ${pick.use?.worth ?? 1}`]
}

/**
 * The text with a `published` statement added, and a new box that uses it or a box's capacity set to it: text only,
 * the smallest change, refused (with the reason) when the definition would gain an error. A new box is the generic
 * box its kind needs, running its stage (`catalogBox`), and may go on flows' routes, with the edges they need.
 */
export function addPublished(source: string, pick: CatalogPick, options?: CompileOptions): AddResult {
  const { doc, report } = parse(source)
  if (report.failed) return { error: 'the text has a syntax error' }
  const c = pick.component
  const taken = new Set(declarations(source, doc).map((s) => s.id))
  const fresh = (base: string) => {
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`
    taken.add(id)
    return id
  }
  const id = fresh(`${c.id}Figure`)
  // a text as the language reads it back: only \\, \", \n and \t are escaped
  const quote = (t: string) =>
    `"${t.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\t', '\\t')}"`
  const value = (v: ConditionValue) => (typeof v === 'string' ? quote(v) : String(v))
  const lines = [
    `edition: ${quote(c.edition)}`,
    ...(pick.version ? [`version: ${quote(pick.version)}`] : []),
    ...(pick.figure ? [`figure: ${quote(pick.figure)}`] : []),
    ...Object.entries(pick.conditions).map(([k, v]) => `${k}: ${value(v)}`),
  ]
  const statement = `published ${id} ${c.id} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`
  // the figure picked (a documented default is one only by its name), and a stale condition said, not thrown
  let figure: ReturnType<typeof published>
  try {
    figure = published(c, {
      ...pick.conditions,
      ...(pick.version ? { version: pick.version } : {}),
      ...(pick.figure ? { figure: pick.figure } : {}),
    })
  } catch (err) {
    return { error: String((err as Error).message ?? err).replace(/^loadmap: /, '') }
  }
  const changes: TextChange[] = []
  // a definition ends on a line of its own: the new lines go after one blank line
  const end = source.trimEnd().length
  const gap = '\n\n'
  let box: string
  let dropped: TextChange[] = []
  if (pick.into === 'new') {
    const added = newBox(source, doc.body, pick, { figure: id, unit: figure.unit, fresh, taken, quote })
    if ('error' in added) return added
    box = added.box
    changes.push({ from: end, to: source.length, insert: `${gap}${statement}\n\n${added.text}\n` }, ...added.changes)
    dropped = added.dropped
  } else {
    box = pick.into.box
    const d = doc.body.find(
      (s): s is Decl =>
        s.kind === 'decl' &&
        (BOXES as readonly string[]).includes(s.keyword.name) &&
        s.args[0]?.t === 'id' &&
        s.args[0].name === box,
    )
    if (!d) return { error: `no box "${box}"` }
    const prop = (k: string) =>
      d.body?.find((s): s is Extract<Stmt, { kind: 'prop' }> => s.kind === 'prop' && s.key.name === k)
    const cap = prop('capacity')
    // the box's demand is in its capacity's unit: a figure in another one would compare apples with pears
    const unit = cap?.value.t === 'call' && cap.value.args[1]?.t === 'str' ? cap.value.args[1].value : undefined
    if (unit && figure.unit && unit !== figure.unit)
      return { error: `${box}'s capacity is in ${unit}, ${c.name}'s figure in ${figure.unit}` }
    if (cap) changes.push({ from: cap.value.from, to: cap.value.to, insert: id })
    else {
      // a box without a component gains one: its capacity, and what happens past it
      // without a stage nothing reaches it: a demand to fill in, as a new box has
      const staged =
        d.keyword.name === 'pool' ||
        d.body?.some((s) => s.kind === 'decl' && (STAGES as readonly string[]).includes(s.keyword.name))
      const add = [
        ...(prop('demand') || staged ? [] : ['demand: 0']),
        `capacity: ${id}`,
        ...(prop('over') ? [] : ['over: "past its published capacity"']),
      ]
      if (d.bodySpan) {
        const close = d.bodySpan.to - 1
        const before = source.slice(0, close).trimEnd().length
        changes.push({ from: before, to: close, insert: `\n${add.map((l) => `  ${l}`).join('\n')}\n` })
      } else changes.push({ from: d.to, to: d.to, insert: ` {\n${add.map((l) => `  ${l}`).join('\n')}\n}` })
    }
    changes.push({ from: end, to: source.length, insert: `${gap}${statement}\n` })
  }
  const errors = (src: string) =>
    compile(src, options)
      .diagnostics.filter((x) => x.severity === 'error')
      .map((x) => x.message)
  const before = errors(source)
  const attempt = (all: TextChange[]) => {
    // from the end back; at one offset the later change first, so the box's own lines come before the statement
    const order = new Map(all.map((ch, i) => [ch, i]))
    const sorted = [...all].sort((a, b) => b.from - a.from || order.get(b)! - order.get(a)!)
    let next = source
    for (const ch of sorted) next = next.slice(0, ch.from) + ch.insert + next.slice(ch.to)
    const left = [...before]
    const broken = errors(next).find((m) => {
      const i = left.indexOf(m)
      if (i < 0) return true
      left.splice(i, 1)
      return false
    })
    return { next, broken, changes: sorted.reverse() }
  }
  // the edges left over go too, unless something still needs them
  let r = attempt([...changes, ...dropped])
  if (r.broken && dropped.length) r = attempt(changes)
  if (r.broken) return { error: r.broken }
  return { source: r.next, changes: r.changes, id, box }
}

interface NewBoxContext {
  figure: string
  unit: string
  fresh: (base: string) => string
  taken: Set<string>
  quote: (t: string) => string
}

/**
 * A new box for a catalog component: the generic box its kind needs with its stage, its demand in the figure's unit,
 * and the routes, edges and connection that put it on flows. The box's text, the changes elsewhere, and the plain
 * edges no route takes any more once it stands between their boxes (dropped only where nothing else needs them).
 */
function newBox(
  source: string,
  body: readonly Stmt[],
  pick: CatalogPick,
  { figure, unit, fresh, taken, quote }: NewBoxContext,
): { box: string; text: string; changes: TextChange[]; dropped: TextChange[] } | { error: string } {
  const c = pick.component
  const use = pick.use ?? {}
  const kind = catalogBox(c)
  let box: string
  if (use.id) {
    if (!/^[A-Za-z_]\w*$/.test(use.id)) return { error: `"${use.id}" is no id: letters, digits and _` }
    if (taken.has(use.id)) return { error: `the text has a "${use.id}" already` }
    box = use.id
    taken.add(box)
  } else box = fresh(c.id)

  const flows = new Map(
    body.flatMap((s) =>
      s.kind === 'decl' && s.keyword.name === 'flow' && s.args[0]?.t === 'id' ? [[s.args[0].name, s] as const] : [],
    ),
  )
  const prop = (d: Decl, k: string) =>
    d.body?.find((s): s is Extract<Stmt, { kind: 'prop' }> => s.kind === 'prop' && s.key.name === k)
  const placed: { flow: string; chain: Ident[]; at: number }[] = []
  for (const r of use.routes ?? []) {
    const f = flows.get(r.flow)
    if (!f) return { error: `no flow "${r.flow}"` }
    const chain = f.body && prop(f, 'route')?.chain
    if (!chain) return { error: `"${r.flow}" has no route to put it on` }
    if (!Number.isInteger(r.at) || r.at < 0 || r.at > chain.length)
      return { error: `"${r.flow}" has no place ${r.at} on its route` }
    if (placed.some((p) => p.flow === r.flow)) return { error: `"${r.flow}" is on the list twice` }
    placed.push({ flow: r.flow, chain, at: r.at })
  }

  // a store ends a flow: it stands only where every route ends
  const stage =
    use.stage ??
    (kind.stages.includes('store') && !placed.every((p) => p.at === p.chain.length) ? 'pass' : kind.stages[0])
  if (stage && !kind.stages.includes(stage))
    return { error: `${c.name} runs ${kind.stages.length ? kind.stages.join(' or ') : 'no stage'}, not ${stage}` }
  if (stage === 'cache' && use.hit != null && !(use.hit >= 0 && use.hit <= 1))
    return { error: 'a hit ratio is a share from 0 to 1' }

  const lines: string[] = []
  if (kind.box === 'cluster') {
    const n = MEMBERS.map((k) => pick.conditions[k]).find((v) => typeof v === 'number')
    lines.push(`members: ${n ?? 1}`)
  } else if (c.shape === 'cylinder') lines.push('shape: cylinder')
  if (stage === 'queue') {
    // a queue names its partitions for each flow through it: one, as Kafka's and RabbitMQ's defaults, unless said;
    // none yet without a flow, which the checker then says
    const parts = use.partitions ?? 1
    lines.push(
      `queue { partitions {${placed.map((p) => ` ${p.flow}: ${parts}`).join(';')}${placed.length ? ' ' : ''}} }`,
    )
  } else if (stage === 'cache') {
    if (use.hit == null) lines.push('# the share it answers, 0 to 1')
    lines.push(`cache { hit: ${use.hit ?? 0.8} }`)
  } else if (stage) lines.push(stage)
  lines.push(...demandLines(stage, box, unit, pick), `capacity: ${figure}`, 'over: "past its published capacity"')
  let text = `${kind.box} ${box} ${quote(use.label ?? c.name)} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`

  if (placed.length && !stage) return { error: `${c.name} runs no stage: no flow can pass it` }
  if (use.rule) {
    if (!c.connections?.some((r) => r.id === use.rule))
      return { error: `${c.name} has no connection rule "${use.rule}"` }
    if (stage !== 'queue') return { error: 'a connection rule here takes a queue' }
  }
  const boxName = (stage: string) => {
    const d = boxOf(body, stage)
    return d?.args[0]?.t === 'id' ? d.args[0].name : stage
  }
  const sourceOf = (f: Decl) => {
    const v = prop(f, 'from')?.value
    return v?.t === 'id' ? v.name : undefined
  }
  /** A flow's boxes in the order its units pass them, from its source, with the new box where it now stands. */
  const boxesOf = (f: Decl, chain: readonly Ident[], at?: number) => {
    const names = chain.map((n) => boxName(n.name))
    if (at != null) names.splice(at, 0, box)
    const src = sourceOf(f)
    return src ? [src, ...names] : names
  }

  // each route takes the box's stage, written in (the rest of the route as it is), and each hop of it an edge: from
  // the box before (or the flow's source) and to the box after
  const changes: TextChange[] = []
  const edges = new Set(
    body.flatMap((s) => (s.kind === 'edge' ? s.chain.slice(1).map((n, i) => `${s.chain[i]!.name} ${n.name}`) : [])),
  )
  const added: string[] = []
  const edge = (a: string, b: string) => {
    if (edges.has(`${a} ${b}`)) return
    edges.add(`${a} ${b}`)
    added.push(`${a} -> ${b}`)
  }
  const pools = new Set(
    body.flatMap((s) =>
      s.kind === 'decl' && s.keyword.name === 'pool' && s.args[0]?.t === 'id' ? [s.args[0].name] : [],
    ),
  )
  const drains: string[] = []
  /** The hops the new box now stands in: their edges go when no route takes them any more. */
  const replaced: [string, string][] = []
  for (const p of placed) {
    const f = flows.get(p.flow)!
    const boxes = boxesOf(f, p.chain, p.at)
    const i = boxes.indexOf(box)
    const prev = boxes[i - 1]
    const after = boxes[i + 1]
    changes.push(
      p.at > 0
        ? { from: p.chain[p.at - 1]!.to, to: p.chain[p.at - 1]!.to, insert: ` -> ${box}` }
        : { from: p.chain[0]!.from, to: p.chain[0]!.from, insert: `${box} -> ` },
    )
    if (prev) edge(prev, box)
    if (after) edge(box, after)
    if (prev && after) replaced.push([prev, after])
    const next = p.chain[p.at]?.name
    if (use.rule && next && pools.has(boxName(next)) && !drains.includes(next)) drains.push(next)
  }
  if (use.rule) {
    if (!drains.length) return { error: 'a connection rule needs a pool right after it on a route' }
    for (const after of drains) {
      const conn = fresh(`${box}${after.charAt(0).toUpperCase()}${after.slice(1)}`)
      text += `\n\nconnection ${conn} {\n  hop: ${box} -> ${after}\n  rule: ${quote(use.rule)}\n}`
    }
  }

  // a plain `a -> b` on a line of its own (its comment with it) that no route takes, as the routes now go, is left over
  const hops = new Set<string>()
  for (const [name, f] of flows) {
    const chain = f.body && prop(f, 'route')?.chain
    if (!chain) continue
    const boxes = boxesOf(f, chain, placed.find((x) => x.flow === name)?.at)
    for (let i = 1; i < boxes.length; i++) hops.add(`${boxes[i - 1]} ${boxes[i]}`)
  }
  const end = source.trimEnd().length
  const lineEnd = (at: number) => {
    const i = source.indexOf('\n', at)
    return i < 0 ? source.length : i
  }
  const dropped: TextChange[] = []
  for (const [a, b] of replaced) {
    if (hops.has(`${a} ${b}`)) continue
    const e = body.find(
      (s): s is Edge =>
        s.kind === 'edge' &&
        s.chain.length === 2 &&
        !s.value &&
        !s.body &&
        s.chain[0]!.name === a &&
        s.chain[1]!.name === b,
    )
    if (!e || dropped.some((d) => d.from <= e.from && e.from < d.to)) continue
    const start = source.lastIndexOf('\n', e.from - 1) + 1
    const stop = lineEnd(e.to)
    if (source.slice(start, e.from).trim() || !/^\s*(#.*)?$/.test(source.slice(e.to, stop))) continue
    // the line and its line break; the last line from the break before it, so no change reaches past the text's end
    dropped.push(
      stop >= end ? { from: Math.max(0, start - 1), to: end, insert: '' } : { from: start, to: stop + 1, insert: '' },
    )
  }
  if (added.length) {
    // the new edges on the lines after the last edge that stays (after its comment), else after the box; never where
    // another change starts or ends (the end of the text, a dropped line), which an editor may refuse as overlapping
    const last = body
      .filter((s) => {
        const at = lineEnd(s.to)
        return (
          s.kind === 'edge' &&
          at < end &&
          !dropped.some((d) => (d.from <= s.from && s.from < d.to) || d.from === at || d.to === at)
        )
      })
      .at(-1)
    if (last) {
      const at = lineEnd(last.to)
      changes.push({ from: at, to: at, insert: added.map((e) => `\n${e}`).join('') })
    } else text += `\n\n${added.join('\n')}`
  }
  return { box, text, changes, dropped }
}
