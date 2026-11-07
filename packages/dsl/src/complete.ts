import { childrenOf, type Decl, type Edge, type Expr, type Stmt } from './ast'
import { type DslSymbol, declarations } from './compile'
import { type Cursor, callAt, cursorAt } from './cursor'
import { Reporter } from './diagnostics'
import { BUILTINS } from './expr'
import type { Token } from './lexer'
import { parse } from './parser'
import { type BlockSpec, BOXES, COLORS, EDGE_PROPS, own, type PropSpec, SCHEMA, type Scope } from './schema'

export interface Completion {
  label: string
  type: 'keyword' | 'property' | 'variable' | 'function' | 'constant' | 'type'
  /** A few words next to the label. */
  detail?: string
  /** The longer help shown beside the list. */
  info?: string
  /** What to insert, when it differs from the label: "rate: ". */
  apply?: string
  /**
   * What to insert as a template, instead of `apply`: `${1:value}` is a field Tab moves to, `${0}` where the last Tab
   * leaves the cursor (after the call). CodeMirror's snippets and the language server protocol both read it as written.
   */
  snippet?: string
  /** Higher first among the matches, from -99 to 99: what fits this place best. */
  boost?: number
}

export interface Completions {
  /** The word being completed: replace source[from, to). */
  from: number
  to: number
  options: Completion[]
}

const CAPACITY = new Set(['measured', 'estimated', 'configured'])
/** Units to start from in a file that names none yet. */
const UNITS = ['req/s', 'cores', 'ops/s', 'msg/s', 'MB/s', 'connections']
const TABLES = ['flows', 'at', 'demand', 'util', 'derived'] as const

/**
 * What may be typed at `offset`: the properties and statements of the block the cursor is in, the ids a route or an
 * edge can name, the names a formula can read where it is, ranked by what fits there. Editor-agnostic. It reads only
 * the parse and the declared names, never runs the model: cheap enough for every keystroke.
 */
export function completions(source: string, offset: number): Completions {
  const cur = cursorAt(source, offset)
  const { doc } = parse(source, new Reporter(source))
  const options = new Help(source, doc.body, declarations(source, doc), cur, offset).options()
  return { from: cur.from, to: cur.to, options }
}

/** Where a formula is written: what it may read, and what the slot wants. */
interface Slot {
  scope: Scope
  key?: string
  prop?: PropSpec
}

class Help {
  readonly spec: BlockSpec
  readonly edgeBody: boolean
  /** The statements whose blocks hold the cursor, outermost first. */
  readonly path: (Decl | Edge)[]

  constructor(
    readonly source: string,
    readonly body: readonly Stmt[],
    readonly symbols: readonly DslSymbol[],
    readonly cur: Cursor,
    readonly offset: number,
  ) {
    ;({ spec: this.spec, edgeBody: this.edgeBody, path: this.path } = blockAt(body, offset))
  }

  options(): Completion[] {
    const { cur } = this
    if (cur.in === 'comment' || (cur.in === 'text' && !cur.string)) return []
    const head = cur.head
    const first = head[0]
    if (!first) return cur.in === 'code' ? this.lineStart() : []
    if (first.kind !== 'ident') return []

    // a -> b -> |   flow -> |   a -> b: `${…}`
    if (punct(head[1], '->')) {
      const colon = head.findIndex((t) => punct(t, ':'))
      if (colon >= 0) return this.formula(cur.part ?? head.slice(colon + 1), { scope: 'ctx' })
      if (!punct(head.at(-1), '->') || cur.in !== 'code') return []
      return this.spec.edges === 'branches' ? this.stages() : this.nodes(head.at(-2)?.text)
    }
    // key: |
    if (punct(head[1], ':')) {
      const key = first.text
      const prop = this.edgeBody
        ? own(EDGE_PROPS, key)
        : (own(this.spec.props, key) ?? (this.spec.open ? this.spec.open.spec : undefined))
      return this.value(key, prop, head.slice(2))
    }
    // let x = |
    const eq = head.findIndex((t) => punct(t, '='))
    if (first.text === 'let' && eq >= 0) return this.formula(cur.part ?? head.slice(eq + 1), { scope: 'ctx' })
    // node db `${|}`: a box's label and sub may be computed
    const kw = own(SCHEMA, first.text)
    if (cur.part && kw) return this.formula(cur.part, { scope: kw.args.some((a) => a.dynamic) ? 'ctx' : 'const' })
    // keyword lines (node x "…") take names and texts: nothing to offer
    return []
  }

  lineStart(): Completion[] {
    // what the block sets, but for the line being written
    const written = new Set(
      (this.path.at(-1)?.body ?? this.body).flatMap((s) =>
        s.kind === 'prop' && !(s.from <= this.offset && this.offset <= s.to) ? [s.key.name] : [],
      ),
    )
    if (this.edgeBody) return props(EDGE_PROPS, written)
    const { spec } = this
    const list: Completion[] = [...props(spec.props, written), ...statements(spec)]
    const open = (names: string[]) =>
      names
        .filter((n) => !written.has(n))
        .map((label) => ({ label, type: 'variable' as const, apply: `${label}: `, boost: 1 }))
    if (spec.open?.names === 'values') list.push(...open(['load', ...this.ids('param')]))
    if (spec.open?.names === 'params') list.push(...open(this.ids('param')))
    if (spec.open?.names === 'flows') list.push(...open(this.ids('flow')))
    if (spec.edges === 'edges') list.push(...this.nodes())
    if (spec.edges === 'branches') list.push(...this.ids('flow').map((label) => ({ label, type: 'variable' as const })))
    return list
  }

  value(key: string, p: PropSpec | undefined, rest: Token[]): Completion[] {
    const { cur } = this
    const kind = p?.value
    if (kind === 'route') {
      if (cur.in !== 'code' || (rest.length && !punct(rest.at(-1), '->'))) return []
      return this.stages(rest.at(-2)?.text)
    }
    if (kind === 'node') return cur.in === 'code' ? this.nodes() : []
    if (kind === 'component')
      return cur.in === 'code' ? this.ids('component').map((label) => ({ label, type: 'variable' })) : []
    if (kind === 'tier') return cur.in === 'code' ? this.ids('tier').map((label) => ({ label, type: 'constant' })) : []
    if (kind === 'scenario')
      return this.ids('scenario').map((label) => ({
        label,
        type: 'constant',
        apply: cur.in === 'text' || /^[A-Za-z_]\w*$/.test(label) ? label : JSON.stringify(label),
      }))
    if (kind === 'enum' || kind === 'names')
      return (key === 'color' ? COLORS : (p?.values ?? [])).map((label) => ({ label, type: 'constant' }))
    // a value of the load or a parameter, in a preset, a scenario or a step
    if (kind === 'value' && this.spec.open && p === this.spec.open.spec) return this.paramValues(key)
    // a parameter's default: one of its options
    if (kind === 'value' && this.spec === SCHEMA.param) {
      const id = this.path.at(-1)?.kind === 'decl' ? (this.path.at(-1) as Decl).args[0] : undefined
      return id?.t === 'id' ? this.paramValues(id.name, false) : []
    }
    if (kind === 'boolean' && p?.scope === 'const') return cur.in === 'code' ? booleans() : []
    // a constant number or text: nothing to pick from
    if (!p || p.scope === 'const') return p ? [] : this.formula(cur.part ?? rest, { scope: 'ctx' })
    return this.formula(cur.part ?? rest, { scope: p.scope, key, prop: p })
  }

  /** What fits next in a formula, after `tokens`. */
  formula(tokens: Token[], slot: Slot): Completion[] {
    const { cur } = this
    if (slot.scope === 'const') return []
    const call = callAt(tokens)
    if (cur.in === 'text') return call && CAPACITY.has(call.name) && call.arg === 1 ? this.units(true) : []

    // flows.|  at.|  at.db.|  demand.|  util.|  derived.|
    const last = tokens.at(-1)
    if (punct(last, '.')) return this.table(tokens, slot)
    // after a ± only a number fits: 30%
    if (punct(last, '±') || punct(last, '+/-')) return []

    // a unit, until one is written; the source is free text
    if (call && CAPACITY.has(call.name) && call.arg > 0)
      return call.arg === 1 && !call.tokens.length ? this.units(false) : []
    // after a whole operand only an operator fits, or the ± of a capacity's value
    const within = call?.arg === 0 && call.tokens.some((t) => t.text === '±' || t.text === '+/-')
    if (last && (last.kind !== 'punct' || last.text === ')' || last.text === ']' || (within && last.text === '%'))) {
      if (call && call.arg === 0 && call.name !== 'configured' && CAPACITY.has(call.name) && !within)
        return [
          {
            label: '± 30%',
            type: 'keyword',
            snippet: '± ${1:30}%${0}',
            detail: 'how sure',
            info: 'The value is known to within this share: every crossing becomes a range, and the verdict uses its pessimistic edge.',
          },
        ]
      return []
    }
    const names = this.names(slot)
    if (slot.prop?.value === 'capacity' && !tokens.length) names.push(...capacityForms())
    return names
  }

  names(slot: Slot): Completion[] {
    const { scope } = slot
    if (scope === 'i' || scope === 'value') return [{ label: scope, type: 'variable' }]
    const wantsSwitch = slot.prop?.value === 'boolean'
    const list: Completion[] = [
      { label: 'load', type: 'variable', detail: '× today' },
      ...this.ids('param').map((label) => ({
        label,
        type: 'variable' as const,
        detail: 'parameter',
        boost: wantsSwitch && this.isSwitch(label) ? 2 : undefined,
      })),
    ]
    if (scope === 'values') return list
    const self = this.selfLet()
    list.push(
      ...this.ids('let').flatMap((label) =>
        label === self ? [] : [{ label, type: 'variable' as const, detail: 'let' }],
      ),
    )
    for (const label of TABLES) list.push({ label, type: 'type', apply: `${label}.`, boost: -1 })
    if (slot.key === 'demand') {
      const box = this.box()
      if (box)
        for (const f of this.reaching(box))
          list.push({ label: `flows.${f}`, type: 'variable', detail: 'reaches this box', boost: 3 })
    }
    for (const s of this.symbols)
      if (s.kind === 'fit')
        list.push({ label: s.id, type: 'function', detail: 'fit', snippet: `${s.id}(\${1:${this.fitX(s.id)}})\${0}` })
    for (const [label, b] of Object.entries(BUILTINS)) {
      if (CAPACITY.has(label)) continue
      list.push({
        label,
        type: 'function',
        detail: `(${b.params.join(', ')}${b.variadic ? ', …' : ''})`,
        info: b.doc,
        snippet: `${label}(${b.params.map((n, i) => `\${${i + 1}:${n}}`).join(', ')})\${0}`,
        boost: -2,
      })
    }
    if (slot.prop?.value !== 'capacity') list.push(...capacityForms(-3))
    list.push(...booleans(wantsSwitch ? 2 : -3))
    return list
  }

  /** After `flows.`, `at.`, `at.<stage>.`, `demand.`, `util.`, `derived.`. */
  table(tokens: Token[], slot: Slot): Completion[] {
    const name = tokens.at(-2)
    if (name?.kind !== 'ident') return []
    const entry = (label: string, detail: string, boost?: number) => ({
      label,
      type: 'variable' as const,
      detail,
      boost,
    })
    // at.<stage>.: the flows that reach that stage
    if (punct(tokens.at(-3), '.') && tokens.at(-4)?.text === 'at') {
      const reach = this.routes()
      return this.ids('flow').flatMap((f) => (reach.get(f)?.has(name.text) ? [entry(f, `at.${name.text}`)] : []))
    }
    if (punct(tokens.at(-3), '.')) return []
    const self = this.component(slot)
    switch (name.text) {
      case 'flows': {
        const box = slot.key === 'demand' ? this.box() : undefined
        const near = new Set(box ? this.reaching(box) : [])
        return this.ids('flow').map((f) =>
          entry(f, near.has(f) ? 'reaches this box' : 'flows', near.has(f) ? 3 : undefined),
        )
      }
      case 'at':
        return this.ids('stage').map((s) => entry(s, 'at'))
      // a component's own demand or utilization in its own lines would need itself
      case 'demand':
        return this.ids('component').flatMap((c) => (c === self && slot.key === 'demand' ? [] : [entry(c, 'demand')]))
      case 'util':
        return this.ids('component').flatMap((c) => (c === self ? [] : [entry(c, 'util')]))
      case 'derived': {
        const own = this.selfLet()
        return this.ids('let').flatMap((l) => (l === own ? [] : [entry(l, 'derived')]))
      }
      default:
        return []
    }
  }

  units(inText: boolean): Completion[] {
    const count = new Map<string, number>()
    walk(this.body, (e) => {
      if (e.t !== 'call' || !CAPACITY.has(e.callee.name)) return
      const u = e.args[1]
      // not the one being typed
      if (u?.t === 'str' && u.value && !(u.from < this.offset && this.offset <= u.to))
        count.set(u.value, (count.get(u.value) ?? 0) + 1)
    })
    const used = [...count].sort((a, b) => b[1] - a[1]).map(([u]) => u)
    const all = [...used, ...UNITS.filter((u) => !count.has(u))]
    return all.map((label, i) => ({
      label,
      type: 'constant',
      detail: i < used.length ? 'used here' : undefined,
      apply: inText ? label : JSON.stringify(label),
      boost: i < used.length ? 1 : undefined,
    }))
  }

  /** The options of a parameter, or true and false for a switch. */
  paramValues(key: string, switches = true): Completion[] {
    const decl = this.decl('param', key)
    if (!decl || this.cur.in !== 'code') return []
    const options = propOf(decl, 'options')
    if (options?.t === 'array')
      return options.items.map((e) => ({ label: this.source.slice(e.from, e.to), type: 'constant' as const }))
    return switches && this.isSwitch(key) ? booleans() : []
  }

  ids(kind: DslSymbol['kind']): string[] {
    return [...new Set(this.symbols.filter((s) => s.kind === kind).map((s) => s.id))]
  }

  /** Stages, and boxes with a single stage of their own name; those right after `prev` along an edge first. */
  stages(prev?: string): Completion[] {
    const next = new Set<string>()
    if (prev) {
      const boxOf = new Map(this.symbols.filter((s) => s.kind === 'stage').map((s) => [s.id, s.detail ?? s.id]))
      const from = boxOf.get(prev) ?? prev
      for (const s of this.body)
        if (s.kind === 'edge')
          for (let i = 0; i + 1 < s.chain.length; i++) if (s.chain[i]!.name === from) next.add(s.chain[i + 1]!.name)
      for (const [stage, box] of boxOf) if (next.has(box)) next.add(stage)
    }
    const all = [
      ...this.ids('stage').map((label) => ({ label, detail: 'stage' })),
      ...singleStageBoxes(this.symbols).map((label) => ({ label, detail: 'box' })),
    ]
    return all.map(({ label, detail }) => ({
      label,
      type: 'variable' as const,
      detail: next.has(label) ? `${detail}, next along an edge` : detail,
      boost: next.has(label) ? 2 : undefined,
    }))
  }

  /** Every node; after `a ->`, not `a` itself. */
  nodes(prev?: string): Completion[] {
    return this.ids('node').flatMap((label) =>
      label === prev ? [] : [{ label, type: 'variable' as const, detail: 'node' }],
    )
  }

  private routesMemo?: Map<string, Set<string>>

  /** Each flow's stages: its route, and the stages a fan-out copies it to. */
  routes(): Map<string, Set<string>> {
    if (this.routesMemo) return this.routesMemo
    const out = new Map<string, Set<string>>()
    const add = (f: string, s: string) => out.set(f, (out.get(f) ?? new Set()).add(s))
    // a box with one stage stands for it, as the compiler reads a route
    const stages = new Set(this.ids('stage'))
    const only = new Map<string, string[]>()
    for (const s of this.symbols)
      if (s.kind === 'stage' && s.detail) only.set(s.detail, [...(only.get(s.detail) ?? []), s.id])
    const stageOf = (n: string) => (stages.has(n) || only.get(n)?.length !== 1 ? n : only.get(n)![0]!)
    const visit = (list: readonly Stmt[], fanout: boolean) => {
      for (const s of list) {
        if (s.kind === 'decl' && s.keyword.name === 'flow') {
          const id = s.args[0]
          const route = s.body?.find((p) => p.kind === 'prop' && p.key.name === 'route')
          if (id?.t === 'id' && route?.kind === 'prop')
            for (const n of route.chain ?? [route.value]) if ('name' in n) add(id.name, stageOf(n.name))
        }
        if (s.kind === 'edge' && fanout) for (const n of s.chain.slice(1)) add(s.chain[0]!.name, stageOf(n.name))
        if (s.kind === 'decl' && s.body) visit(s.body, s.keyword.name === 'fanout')
      }
    }
    visit(this.body, false)
    this.routesMemo = out
    return out
  }

  /** The flows that pass a stage of this box. */
  reaching(box: string): string[] {
    const stages = new Set(this.symbols.filter((s) => s.kind === 'stage' && s.detail === box).map((s) => s.id))
    if (!stages.size) return []
    const routes = this.routes()
    return this.ids('flow').filter((f) => [...(routes.get(f) ?? [])].some((s) => stages.has(s)))
  }

  /** The id of the box the cursor is in. */
  box(): string | undefined {
    const b = this.path.findLast(
      (d): d is Decl => d.kind === 'decl' && (BOXES as readonly string[]).includes(d.keyword.name),
    )
    const id = b?.args[0]
    return id?.t === 'id' ? id.name : undefined
  }

  /** The component whose line the cursor is on: a nested `component`, or the box that owns its lines. */
  component(slot: Slot): string | undefined {
    // what its utilization is made of; its texts may show it
    if (!slot.key || !['demand', 'capacity', 'when'].includes(slot.key)) return undefined
    const inner = this.path.at(-1)
    if (inner?.kind === 'decl' && inner.keyword.name === 'component') {
      const id = inner.args[0]
      return id?.t === 'id' ? id.name : this.box()
    }
    return this.box()
  }

  /** In `let x = …`, x. */
  selfLet(): string | undefined {
    const first = this.cur.head[0]
    const id = this.cur.head[1]
    return first?.text === 'let' && id?.kind === 'ident' ? id.text : undefined
  }

  decl(keyword: string, id: string): Decl | undefined {
    return this.body.find(
      (s): s is Decl =>
        s.kind === 'decl' && s.keyword.name === keyword && s.args[0]?.t === 'id' && s.args[0].name === id,
    )
  }

  isSwitch(param: string): boolean {
    const d = this.decl('param', param)
    return !!d && propOf(d, 'default')?.t === 'bool'
  }

  /** The name of a fit's x, as its points line calls it. */
  fitX(fit: string): string {
    const points = this.decl('fit', fit)?.body?.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'points')
    const x = points?.args[0]
    return x?.t === 'id' ? x.name : 'x'
  }
}

const punct = (t: Token | undefined, text: string) => t?.kind === 'punct' && t.text === text

export function propOf(d: Decl, key: string): Expr | undefined {
  const p = d.body?.find((s) => s.kind === 'prop' && s.key.name === key)
  return p?.kind === 'prop' ? p.value : undefined
}

function booleans(boost?: number): Completion[] {
  return [
    { label: 'true', type: 'constant', boost },
    { label: 'false', type: 'constant', boost },
  ]
}

function capacityForms(boost = 4): Completion[] {
  return [...CAPACITY].map((label) => ({
    label,
    type: 'function' as const,
    detail: '(value, unit, source)',
    info: BUILTINS[label]!.doc,
    snippet: `${label}(\${1:value}, "\${2:unit}", "\${3:source}")\${0}`,
    // measured first: the verdict trusts it most
    boost: boost - [...CAPACITY].indexOf(label),
  }))
}

function props(p: Readonly<Record<string, PropSpec>>, written: ReadonlySet<string>): Completion[] {
  return Object.entries(p).flatMap(([label, s]) =>
    written.has(label) && !s.repeat
      ? []
      : [
          {
            label,
            type: 'property' as const,
            apply: `${label}: `,
            detail: s.required ? 'required' : undefined,
            info: s.doc,
            boost: s.required ? 2 : undefined,
          },
        ],
  )
}

function statements(spec: BlockSpec): Completion[] {
  return spec.children
    .filter((k) => k !== 'loadmap')
    .map((k) => ({ label: k, type: 'keyword', info: `${SCHEMA[k]!.doc}\n\n${SCHEMA[k]!.example}` }))
}

function singleStageBoxes(symbols: readonly DslSymbol[]): string[] {
  const count = new Map<string, number>()
  for (const s of symbols) if (s.kind === 'stage' && s.detail) count.set(s.detail, (count.get(s.detail) ?? 0) + 1)
  const stages = new Set(symbols.filter((s) => s.kind === 'stage').map((s) => s.id))
  return [...count].filter(([box, n]) => n === 1 && !stages.has(box)).map(([box]) => box)
}

/** Every formula in the statements, and every formula inside it. */
function walk(list: readonly Stmt[], visit: (e: Expr) => void) {
  const expr = (e: Expr) => {
    visit(e)
    for (const c of childrenOf(e, true)) expr(c)
  }
  for (const s of list) {
    if (s.kind === 'prop') expr(s.value)
    else if (s.kind === 'row') s.values.forEach(expr)
    else {
      if (s.kind === 'decl') {
        s.args.forEach(expr)
        if (s.init) expr(s.init)
      } else if (s.value) expr(s.value)
      if (s.body) walk(s.body, visit)
    }
  }
}

/** The innermost block whose braces hold `offset`, and the statements whose blocks lead to it. */
export function blockAt(
  body: readonly Stmt[],
  offset: number,
): { spec: BlockSpec; edgeBody: boolean; path: (Decl | Edge)[] } {
  let spec = SCHEMA['']!
  let list = body
  const path: (Decl | Edge)[] = []
  for (;;) {
    const inside = list.find(
      (s): s is Decl | Edge =>
        (s.kind === 'decl' || s.kind === 'edge') && !!s.bodySpan && s.bodySpan.from < offset && offset < s.bodySpan.to,
    )
    if (!inside?.body) return { spec, edgeBody: false, path }
    path.push(inside)
    // an edge's block holds label and when
    if (inside.kind === 'edge') return { spec, edgeBody: true, path }
    const next = own(SCHEMA, inside.keyword.name)
    if (!next) return { spec, edgeBody: false, path }
    spec = next
    list = inside.body
  }
}
