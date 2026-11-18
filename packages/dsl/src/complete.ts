import type { ConditionValue, Published } from '@loadmap/core'
import type { Decl, Edge, Stmt } from './ast'
import { catalogRules, componentOf, latestEdition, loadedCatalog } from './catalog'
import { type DslSymbol, declarations, templateArgs } from './compile'
import { type Cursor, callAt, cursorAt } from './cursor'
import { Reporter } from './diagnostics'
import { MAX_NESTING } from './expand'
import { BUILTINS } from './expr'
import { DEFAULT_PATH, HEAD, type Role, readHead } from './files'
import { isPlusMinus, type Token } from './lexer'
import { isTemplate, isValue, MODEL_ONLY, VARIANT_ADDS, VARIANT_ONCE, VARIANT_PROPS, VARIANT_REPLACES } from './link'
import { parse } from './parser'
import {
  type BlockSpec,
  BOXES,
  COLORS,
  COMPONENT_PROPS,
  EDGE_PROPS,
  own,
  type PropSpec,
  propNamed,
  SCHEMA,
  type Scope,
  STAGES,
} from './schema'
import { blockAt, propOf, walk } from './tree'
import { before, CURRENT, LANGUAGE_VERSION, parseVersion, plusMinusMark, stampOf, type Version } from './versions'

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
  /** Other changes made with it, in the same text: the edge a route's next stage needs. */
  edits?: { from: number; to: number; insert: string }[]
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
const TABLES = ['flows', 'at', 'out', 'demand', 'util', 'derived'] as const

/**
 * What may be typed at `offset`: the properties and statements of the block the cursor is in, the ids a route or an
 * edge can name, the names a formula can read where it is, ranked by what fits there. Editor-agnostic. It reads only
 * the parse and the declared names, never runs the model: cheap enough for every keystroke.
 */
export function completions(source: string, offset: number): Completions {
  return completionsIn(source, offset)
}

/** An input of a prototype or a subsystem: a value, or (`input flow main`) the name of a flow. */
export interface Input {
  name: string
  flow: boolean
  default?: string
}

/** Where the cursor is in its file's head: what the head lines and the first line may still be. */
export interface HeadState {
  role: Role
  /** The file has its `loadmap` line. */
  stamp: boolean
  /** Nothing but the `loadmap` line and head lines before the cursor's line: a head line may still go here. */
  open: boolean
  /** No statement before the cursor's line. */
  first: boolean
  /** The head lines the file has, by kind. */
  kinds: ReadonlySet<string>
}

/**
 * What the files around a text add, for `completionsAcross`: the names of the model linked (a library's prototypes
 * written out), this file's own head (a part's is blanked in the text it is read in), what it imports, and the inputs
 * of a prototype wherever it is declared. Without it, each is worked out from the text alone.
 */
export interface Context {
  symbols?: readonly DslSymbol[]
  head?: HeadState
  /** The boxes and subsystems this file imports, by the name they have here. */
  imported?: readonly { name: string; keyword: string; from: string; inputs: boolean; route: boolean }[]
  inputsOf?: (name: string) => Input[]
  /** The link stopped partway: its names are not all there, so this text's own fill in the rest. */
  partialLink?: boolean
  /** The part of the text that is this file's own, where an edge it adds goes: all of it, alone. */
  range?: { from: number; to: number }
}

/** The one-file help, with what `ctx` says of the files around: for `completionsAcross`. */
export function completionsIn(source: string, offset: number, ctx: Context = {}): Completions {
  const cur = cursorAt(source, offset)
  const { doc } = parse(source, new Reporter(source))
  // the linked names; this text's own beside them where the link stopped partway (a file being typed)
  const own = () => declarations(source, doc)
  const symbols = !ctx.symbols?.length ? own() : ctx.partialLink ? union(ctx.symbols, own()) : ctx.symbols
  const head = ctx.head ?? headIn(source, doc.body, offset)
  const options = new Help(source, doc.body, symbols, cur, offset, { ...ctx, head }).options()
  return { from: cur.from, to: cur.to, options }
}

const union = (a: readonly DslSymbol[], b: readonly DslSymbol[]) => {
  const seen = new Set(a.map((s) => `${s.kind} ${s.id}`))
  return [...a, ...b.filter((s) => !seen.has(`${s.kind} ${s.id}`))]
}

/**
 * Whether the top of a file of `role` may hold a property, a statement of `name` or an edge: what the linker refuses
 * there as misplaced, for completion to leave out. Head lines are the head's to say.
 */
function holdsAtTop(role: Role, what: 'prop' | 'decl' | 'edge', name = ''): boolean {
  if (role === 'model') return true
  if (role === 'part') return what === 'edge' || (what === 'decl' && !MODEL_ONLY.has(name))
  if (role === 'library') return what === 'decl' && (isValue(name) || isTemplate(name))
  if (what === 'prop') return VARIANT_PROPS.has(name)
  return (
    what === 'decl' &&
    (name === 'param' || VARIANT_REPLACES.has(name) || VARIANT_ADDS.has(name) || VARIANT_ONCE.has(name))
  )
}

/** The head of a text, as it stands at `offset`. */
export function headAt(source: string, offset: number): HeadState {
  return headIn(source, parse(source, new Reporter(source)).doc.body, offset)
}

export function headIn(source: string, body: readonly Stmt[], offset: number): HeadState {
  const { role, head, stamp } = readHead(new Reporter(source), DEFAULT_PATH, body)
  const line = source.lastIndexOf('\n', offset - 1) + 1
  const earlier = body.filter((s) => s.from < line)
  const heads = new Set<Stmt>(head.map((h) => h.decl))
  return {
    role,
    stamp: !!stamp,
    open: earlier.every((s) => s === stamp || heads.has(s)),
    first: !earlier.length,
    kinds: new Set(head.map((h) => h.kind)),
  }
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
    readonly ctx: Context & { head: HeadState },
  ) {
    ;({ spec: this.spec, edgeBody: this.edgeBody, path: this.path } = blockAt(body, offset))
    this.version = stampOf(source, body)?.version ?? CURRENT
  }

  /** The definition's language version: what completion offers is what it writes. */
  readonly version: Version

  options(): Completion[] {
    const { cur } = this
    if (cur.in === 'comment' || (cur.in === 'text' && !cur.string)) return []
    const head = cur.head
    const first = head[0]
    if (!first) return cur.in === 'code' ? this.lineStart() : []
    if (first.kind !== 'ident') return []
    // the names as written: orderLine.kafka is one
    const names = joinDots(head)

    // a -> b -> |   flow -> |   a -> b: `${…}`
    if (punct(names[1], '->')) {
      const colon = head.findIndex((t) => punct(t, ':'))
      if (colon >= 0) return this.formula(cur.part ?? head.slice(colon + 1), { scope: 'ctx' })
      if (cur.in !== 'code') return []
      const kind = this.spec.edges === 'branches' ? 'stage' : 'node'
      // a -> orderLine.|
      if (punct(names.at(-1), '.') && punct(names.at(-3), '->')) return this.inside(names.at(-2)!.text, kind)
      if (!punct(names.at(-1), '->')) return []
      return kind === 'stage' ? this.stages() : this.nodes(names.at(-2)?.text)
    }
    // orderLine.|  at the start of an edge
    if (names.length === 2 && punct(names[1], '.') && cur.in === 'code')
      return this.spec.edges === 'edges' ? this.inside(names[0]!.text, 'node') : []
    // loadmap |
    if (first.text === 'loadmap' && head.length === 1 && cur.in === 'code' && !this.path.length)
      return [{ label: LANGUAGE_VERSION, type: 'constant', detail: 'the language version', boost: 9 }]
    // measure x |: a metric
    if (first.text === 'measure' && head.length === 2 && cur.in === 'code' && !this.path.length)
      return this.ids('metric').map((label) => ({ label, type: 'variable', detail: 'metric' }))
    // key: |
    if (punct(head[1], ':')) {
      // an old name (`fill` in workers) takes the values of the property it is now
      const named = this.edgeBody ? undefined : propNamed(this.spec.props, first.text)
      const key = named?.name ?? first.text
      const prop = this.edgeBody
        ? own(EDGE_PROPS, key)
        : (named?.spec ?? (this.spec.open ? this.spec.open.spec : undefined))
      return this.value(key, prop, head.slice(2))
    }
    // let x = |
    const eq = head.findIndex((t) => punct(t, '='))
    if (first.text === 'let' && eq >= 0) return this.formula(cur.part ?? head.slice(eq + 1), { scope: 'ctx' })
    // node db `${|}`: a box's label and sub may be computed
    const kw = own(SCHEMA, first.text)
    if (cur.part && kw) return this.formula(cur.part, { scope: kw.args.some((a) => a.dynamic) ? 'ctx' : 'const' })
    // published x |: a component of the catalog
    if (first.text === 'published' && head.length === 2 && cur.in === 'code') return this.catalogComponents()
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
    if (this.edgeBody) return props(EDGE_PROPS, written, this.version)
    const { spec } = this
    // an old name written (`target` in expect) sets the property it is now
    for (const k of [...written]) {
      const named = propNamed(spec.props, k)
      if (named?.old) written.add(named.name)
    }
    // a whole statement only on a line of its own: not before what the line already holds
    const end = this.source.indexOf('\n', this.offset)
    const alone = !this.source.slice(this.offset, end < 0 ? undefined : end).trim()
    const top = !this.path.length
    const { head } = this.ctx
    // before anything else, a file starts with its version
    if (top && !head.stamp && head.first)
      return [
        {
          label: `loadmap ${LANGUAGE_VERSION}`,
          type: 'keyword',
          detail: 'the first line',
          info: SCHEMA.loadmap!.doc,
          boost: 9,
        },
      ]
    const box = this.path.at(-1)
    const others = (box?.body ?? []).filter((s) => !(s.from <= this.offset && this.offset <= s.to))
    const has = new Set(others.flatMap((s) => (s.kind === 'decl' ? [s.keyword.name] : [])))
    const stages: readonly string[] = STAGES
    const kind = box?.kind === 'decl' ? box.keyword.name : ''
    const boxKind = (BOXES as readonly string[]).includes(kind)
    // a box's own component lines, or a component block: one or the other
    const ownComponent = Object.keys(COMPONENT_PROPS).some((p) => written.has(p))
    const fits = (k: string) => {
      if (top) return HEAD.has(k) ? this.headLine(k) : holdsAtTop(head.role, 'decl', k)
      // a node runs one stage; a box has one component
      if (kind === 'node' && stages.includes(k)) return ![...has].some((h) => stages.includes(h))
      if (k === 'component' && boxKind) return !has.has(k) && !ownComponent
      // with sets the inputs of what this one is like
      if (k === 'with') return written.has('like') && !has.has(k)
      // an input goes at the top of a library's box or subsystem, never in a model
      if (k === 'input') return head.role === 'library' && this.path.length === 1
      return true
    }
    const fields = props(spec.props, written, this.version).filter((p) =>
      top
        ? holdsAtTop(head.role, 'prop', p.label)
        : !(boxKind && has.has('component') && own(COMPONENT_PROPS, p.label)),
    )
    const blocks = statements(spec, this.version, alone).filter((s) => fits(s.label))
    for (const s of blocks) {
      if (HEAD.has(s.label)) {
        s.snippet = alone ? HEAD_SNIPPETS[s.label] : undefined
        s.boost = 5
      }
      // a property and a block of one name (held): the block says it is one
      if (fields.some((f) => f.label === s.label)) s.detail = 'block'
    }
    const list: Completion[] = [...fields, ...blocks]
    const open = (names: string[]) =>
      names
        .filter((n) => !written.has(n))
        .map((label) => ({ label, type: 'variable' as const, apply: `${label}: `, boost: 1 }))
    if (spec.open?.names === 'values') list.push(...open(['load', ...this.ids('param')]))
    if (spec.open?.names === 'params') list.push(...open(this.ids('param')))
    if (spec.open?.names === 'flows')
      for (const f of this.flowsHere(this.passing()))
        if (!written.has(f.label)) list.push({ ...f, apply: `${f.label}: ` })
    if (spec.open?.names === 'inputs')
      for (const i of this.prototypeInputs())
        if (!written.has(i.name))
          list.push({
            label: i.name,
            type: 'property',
            apply: `${i.name}: `,
            detail: i.flow ? 'a flow' : i.default != null ? `default ${i.default}` : 'required',
            boost: i.flow || i.default == null ? 2 : 1,
          })
    if (spec.open?.names === 'conditions') {
      const c = this.publishedComponent()
      for (const [label, def] of Object.entries(c?.conditions ?? {}))
        if (!written.has(label)) list.push({ label, type: 'variable', apply: `${label}: `, info: def.doc, boost: 1 })
    }
    if (spec.open?.names === 'arguments')
      for (const label of this.metricArguments())
        if (!written.has(label))
          list.push({ label, type: 'variable', apply: `${label}: `, detail: 'argument', boost: 1 })
    if (spec.edges === 'edges' && (!top || holdsAtTop(head.role, 'edge'))) list.push(...this.nodes())
    if (spec.edges === 'branches') list.push(...this.flows().map((label) => ({ label, type: 'variable' as const })))
    return list
  }

  /** Whether a head line of kind `k` may still be written here. */
  headLine(k: string): boolean {
    const { head } = this.ctx
    if (!head.open || !head.stamp) return false
    const role = head.kinds.has('part') || head.kinds.has('library') || head.kinds.has('extends')
    const imports = head.kinds.has('import')
    const includes = head.kinds.has('include')
    if (k === 'include') return head.role === 'model'
    if (k === 'import') return head.role === 'model' || head.role === 'library'
    if (k === 'library') return !role && !includes
    // part of, extends: a part and a variant take their model's imports
    return !role && !includes && !imports
  }

  /** The inputs of what the block around `with` is like. */
  prototypeInputs(): Input[] {
    const owner = this.path.at(-2)
    const like = owner?.kind === 'decl' ? propOf(owner, 'like') : undefined
    const name = like?.t === 'id' ? like.name : undefined
    if (name == null) return []
    return this.ctx.inputsOf?.(name) ?? inputsIn(this.source, this.body, name)
  }

  /** The input that `with { key: … }` sets. */
  inputNamed(key: string): Input | undefined {
    return this.prototypeInputs().find((i) => i.name === key)
  }

  /** The inputs of the prototypes and subsystems around the cursor: names its formulas read. */
  ownInputs(): Input[] {
    return this.path.flatMap((d) => (d.kind === 'decl' ? inputsOf(this.source, d) : []))
  }

  /** The flows, and the flow inputs of what the cursor is in (`flows.main`). */
  flows(): string[] {
    return [...new Set([...this.ids('flow'), ...this.ownInputs().flatMap((i) => (i.flow ? [i.name] : []))])]
  }

  /** The names of kind `kind` under a subsystem's id: `orderLine.` gives kafka, consumers. */
  inside(prefix: string, kind: 'node' | 'stage' | 'component'): Completion[] {
    const ids =
      kind === 'stage'
        ? [...this.ids('stage'), ...singleStageBoxes(this.symbols)]
        : kind === 'node'
          ? this.ids('node')
          : this.ids('component')
    const out = new Set<string>()
    for (const id of ids) if (id.startsWith(`${prefix}.`)) out.add(id.slice(prefix.length + 1))
    return [...out].map((label) => ({ label, type: 'variable', detail: `${kind} of ${prefix}` }))
  }

  value(key: string, p: PropSpec | undefined, rest: Token[]): Completion[] {
    const { cur } = this
    const kind = p?.value
    const names = joinDots(rest)
    // orderLine.|: a name inside a subsystem
    const dotted =
      cur.in === 'code' && punct(names.at(-1), '.') && names.at(-2)?.kind === 'ident' ? names.at(-2)!.text : undefined
    if (kind === 'route') {
      if (cur.in !== 'code') return []
      if (dotted != null && (names.length === 2 || punct(names.at(-3), '->'))) return this.inside(dotted, 'stage')
      if (names.length && !punct(names.at(-1), '->')) return []
      // a flow's hops need edges: from its from node to its first stage, and between its stages
      const flow =
        key === 'route' && this.path.at(-1)?.kind === 'decl' && (this.path.at(-1) as Decl).keyword.name === 'flow'
      const from = flow ? propOf(this.path.at(-1) as Decl, 'from') : undefined
      const prev = names.at(-2)?.text ?? (from?.t === 'id' ? from.name : undefined)
      return this.stages(prev, flow)
    }
    if (key === 'like' && !this.edgeBody) return cur.in === 'code' ? this.prototypes() : []
    if (kind === 'node' && key === 'from' && dotted == null) return cur.in === 'code' ? this.sources() : []
    if (kind === 'node') return cur.in !== 'code' ? [] : dotted != null ? this.inside(dotted, 'node') : this.nodes()
    if (kind === 'component' && dotted != null) return this.inside(dotted, 'component')
    if (kind === 'flow' || kind === 'flows')
      return cur.in === 'code' ? this.flowsHere(this.spec === SCHEMA.connection ? this.hopFlows() : undefined) : []
    if (kind === 'component')
      return cur.in === 'code' ? this.ids('component').map((label) => ({ label, type: 'variable' })) : []
    // with { main: | }: a flow for a flow input, else a formula of this file
    if (this.spec === SCHEMA.with) {
      if (this.inputNamed(key)?.flow)
        return cur.in === 'code' ? this.flows().map((label) => ({ label, type: 'variable', detail: 'flow' })) : []
      return this.formula(cur.part ?? rest, { scope: 'ctx', key, prop: p })
    }
    if (kind === 'measure')
      return cur.in === 'code' ? this.ids('measure').map((label) => ({ label, type: 'variable' })) : []
    if (kind === 'tier') return cur.in === 'code' ? this.ids('tier').map((label) => ({ label, type: 'constant' })) : []
    if (kind === 'scenario')
      return this.ids('scenario').map((label) => ({
        label,
        type: 'constant',
        apply: cur.in === 'text' || /^[A-Za-z_]\w*$/.test(label) ? label : JSON.stringify(label),
      }))
    if (kind === 'enum' || kind === 'names')
      return (key === 'color' ? COLORS : (p?.values ?? [])).map((label) => ({ label, type: 'constant' }))
    // a published run's value of a condition, or a parameter that holds it
    if (this.spec === SCHEMA.published && (p === this.spec.open?.spec || key === 'version'))
      return [...this.runValues(key), ...this.formula(cur.part ?? rest, { scope: 'values', key, prop: p })]
    // a connection's rule: every rule of the catalog
    if (this.spec === SCHEMA.connection && key === 'rule')
      return [...catalogRules().values()].map((r) => ({
        label: r.id,
        type: 'constant',
        apply: cur.in === 'text' ? r.id : JSON.stringify(r.id),
        detail: r.assign,
        info: r.what,
      }))
    if (this.spec === SCHEMA.published && key === 'edition' && cur.in === 'code')
      return Object.keys(loadedCatalog() ?? {})
        .reverse()
        .map((label, i) => ({ label, type: 'constant', apply: JSON.stringify(label), boost: i ? 0 : 2 }))
    if (this.spec === SCHEMA.published && key === 'figure' && cur.in === 'code')
      return [...(this.publishedComponent()?.figures ?? []), ...(this.publishedComponent()?.defaults ?? [])].map(
        (f) => ({
          label: f.id,
          type: 'constant',
          apply: JSON.stringify(f.id),
          detail: `${f.value} ${f.unit}`,
          info: `${f.what}, ${f.scope}`,
        }),
      )
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
    if (isPlusMinus(last)) return []

    // a unit, until one is written; the source is free text
    if (call && CAPACITY.has(call.name) && call.arg > 0)
      return call.arg === 1 && !call.tokens.length ? this.units(false) : []
    // after a whole operand only an operator fits, or the ± of a capacity's value
    const within = call?.arg === 0 && call.tokens.some(isPlusMinus)
    if (last && (last.kind !== 'punct' || last.text === ')' || last.text === ']' || (within && last.text === '%'))) {
      if (call && call.arg === 0 && call.name !== 'configured' && CAPACITY.has(call.name) && !within)
        return [
          {
            label: `${plusMinusMark(this.version)} 30%`,
            type: 'keyword',
            snippet: `${plusMinusMark(this.version)} \${1:30}%\${0}`,
            detail: 'how sure',
            info: 'The value is known to within this share: every crossing becomes a range, and the verdict uses its pessimistic edge.',
          },
        ]
      return []
    }
    // a capacity's value is a number: what a capacity names (a published figure) does not go there
    const names = this.names(call && CAPACITY.has(call.name) ? { scope: slot.scope, key: slot.key } : slot)
    if (slot.prop?.value === 'capacity' && !tokens.length) names.push(...capacityForms())
    return names
  }

  names(slot: Slot): Completion[] {
    const { scope } = slot
    if (scope === 'i' || scope === 'value') return [{ label: scope, type: 'variable' }]
    const wantsSwitch = slot.prop?.value === 'boolean'
    // in a prototype or a subsystem: what the box that is like it sets, over a parameter of that name
    const inputs = scope === 'values' ? [] : this.ownInputs().flatMap((i) => (i.flow ? [] : [i.name]))
    const list: Completion[] = [
      { label: 'load', type: 'variable', detail: '× today' },
      ...this.ids('param').flatMap((label) =>
        inputs.includes(label)
          ? []
          : [
              {
                label,
                type: 'variable' as const,
                detail: 'parameter',
                boost: wantsSwitch && this.isSwitch(label) ? 2 : undefined,
              },
            ],
      ),
      ...inputs.map((label) => ({ label, type: 'variable' as const, detail: 'input', boost: 1 })),
    ]
    if (scope === 'values') return list
    const capacity = slot.prop?.value === 'capacity'
    for (const label of this.ids('published'))
      list.push({ label, type: 'variable', detail: 'published', boost: capacity ? 3 : -1 })
    for (const label of this.ids('measure'))
      list.push({ label, type: 'variable', detail: 'measure', boost: capacity ? 2 : 0 })
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
        return this.flows().map((f) =>
          entry(f, near.has(f) ? 'reaches this box' : 'flows', near.has(f) ? 3 : undefined),
        )
      }
      case 'at':
        return this.ids('stage').map((s) => entry(s, 'at'))
      case 'out':
        return this.ids('stage').map((s) => entry(s, 'out'))
      // a component's own demand or utilization in its own lines would need itself
      case 'demand':
        return this.ids('component').flatMap((c) =>
          c === self && (slot.key === 'demand' || slot.key === 'held') ? [] : [entry(c, 'demand')],
        )
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

  /** The components of the catalog, once it is loaded: each by its id, with its name and what it is. */
  catalogComponents(): Completion[] {
    const e = loadedCatalog()
    if (!e) return []
    return Object.values(e[latestEdition(e)]!.components).map((c) => ({
      label: c.id,
      type: 'type',
      detail: c.figures.length ? c.name : `${c.name}, nothing published`,
      info: `${c.about}${c.tags.length ? ` Also: ${c.tags.join(', ')}.` : ''}`,
    }))
  }

  /** The arguments the query of the measure's metric names: `{{ args.job }}` gives `job`. */
  metricArguments(): string[] {
    const d = this.path.at(-1)
    const name = d?.kind === 'decl' && d.keyword.name === 'measure' ? d.args[1] : undefined
    // by its statement in this text: a symbol of another file has its place there
    const metric = name?.t === 'id' ? this.decl('metric', name.name) : undefined
    if (!metric) return []
    return templateArgs(this.source.slice(metric.from, metric.to))
  }

  /** The component the `published` statement around the cursor names, in its edition (or the latest). */
  publishedComponent(): Published | undefined {
    const d = this.path.at(-1)
    return d?.kind === 'decl' && d.keyword.name === 'published' ? componentOf(d) : undefined
  }

  /** The values a condition (or the version) takes in the component's published runs, as they are written. */
  runValues(key: string): Completion[] {
    const c = this.publishedComponent()
    if (!c || this.cur.in !== 'code') return []
    const vs = new Set<ConditionValue>(
      c.figures.flatMap((f): readonly ConditionValue[] =>
        key === 'version' ? f.versions : f.when[key] == null ? [] : [f.when[key]!],
      ),
    )
    return [...vs].map((v) => ({
      label: String(v),
      type: 'constant',
      apply: typeof v === 'string' ? JSON.stringify(v) : String(v),
      detail: key === 'version' ? 'a run' : 'published',
      boost: 2,
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

  /**
   * Stages, boxes with one stage of their own name and the subsystems a route may name; after `prev`, not `prev`. Those
   * an edge joins to `prev` first; in a flow's route (`flow`), the others last, each drawing the edge it needs.
   */
  stages(prev?: string, flow = false): Completion[] {
    const box = this.boxOf()
    const edges = this.edgePairs()
    const from = prev == null ? undefined : (box.get(prev) ?? prev)
    // an edge to a subsystem ends at one of its boxes, one from it starts at one
    const joins = (a: string, b: string) =>
      edges.some(([x, y]) => (x === a || a.startsWith(`${x}.`)) && (y === b || b.startsWith(`${y}.`)))
    // a lost box is on no route: it takes what the stages on one lose
    const lost = new Set<string>()
    for (const s of this.body) {
      if (s.kind !== 'decl') continue
      const inner = s.body?.find((c) => c.kind === 'decl' && c.keyword.name === 'lost')
      if (inner?.kind !== 'decl') continue
      for (const a of [s.args[0], inner.args[0]]) if (a?.t === 'id') lost.add(a.name)
    }
    const all = [
      ...this.ids('stage').map((label) => ({ label, detail: 'stage' })),
      // a box whose one stage has another name is offered by that stage, not twice
      ...this.subsystems(true).map((label) => ({ label, detail: 'subsystem' })),
    ].filter(({ label }) => {
      const to = box.get(label) ?? label
      // a subsystem and its own boxes are one place on a route
      const inner = from != null && (to.startsWith(`${from}.`) || from.startsWith(`${to}.`))
      return !lost.has(label) && label !== prev && !inner
    })
    return all.map(({ label, detail }): Completion => {
      const to = box.get(label) ?? label
      if (from == null || to === from) return { label, type: 'variable', detail }
      if (joins(from, to)) return { label, type: 'variable', detail: `${detail}, next along an edge`, boost: 2 }
      if (!flow) return { label, type: 'variable', detail }
      return {
        label,
        type: 'variable',
        detail: `${detail}, draws ${from} -> ${to}`,
        boost: -1,
        edits: [this.edgeEdit(from, to)],
      }
    })
  }

  /** Each stage's box (a box with one stage stands for it, as the compiler reads a route). */
  boxOf(): Map<string, string> {
    if (this.boxMemo) return this.boxMemo
    const out = new Map<string, string>()
    for (const s of this.symbols) if (s.kind === 'stage') out.set(s.id, s.detail ?? s.id)
    for (const b of singleStageBoxes(this.symbols)) out.set(b, b)
    this.boxMemo = out
    return out
  }

  private boxMemo?: Map<string, string>
  private edgeMemo?: [string, string][]
  private chainMemo?: Map<string, { from?: string; stages: string[] }>
  private stageMemo?: (name: string) => string

  /** The stage a name in a route stands for: itself, or the one stage of a box of that name. */
  stageOf(name: string): string {
    if (!this.stageMemo) {
      const stages = new Set(this.ids('stage'))
      const only = new Map<string, string[]>()
      for (const s of this.symbols)
        if (s.kind === 'stage' && s.detail) only.set(s.detail, [...(only.get(s.detail) ?? []), s.id])
      this.stageMemo = (n) => (stages.has(n) || only.get(n)?.length !== 1 ? n : only.get(n)![0]!)
    }
    return this.stageMemo(name)
  }

  /** Every edge drawn, by the ids its ends have outside (a subsystem's own edges under its id). */
  edgePairs(): [string, string][] {
    if (this.edgeMemo) return this.edgeMemo
    const out: [string, string][] = []
    const visit = (list: readonly Stmt[], prefix: string) => {
      for (const s of list) {
        // not the edge being written: its end is what is asked for
        if (s.kind === 'edge' && !(s.from <= this.offset && this.offset <= s.to))
          for (let i = 0; i + 1 < s.chain.length; i++)
            out.push([`${prefix}${s.chain[i]!.name}`, `${prefix}${s.chain[i + 1]!.name}`])
        if (s.kind === 'decl' && s.keyword.name === 'subsystem' && s.args[0]?.t === 'id')
          visit(s.body ?? [], `${prefix}${s.args[0].name}.`)
      }
    }
    visit(this.body, '')
    this.edgeMemo = out
    return out
  }

  /**
   * The change that draws `from -> to`: after the file's last edge; with none yet, before the statement being written
   * (its block may not be closed yet, and the end of the file would be inside it).
   */
  edgeEdit(from: string, to: string): { from: number; to: number; insert: string } {
    const range = this.ctx.range ?? { from: 0, to: this.source.length }
    const mine = this.body.filter((s) => range.from <= s.from && s.to <= range.to)
    const last = mine.findLast((s) => s.kind === 'edge' && !(s.from <= this.offset && this.offset <= s.to))
    if (last) return { from: last.to, to: last.to, insert: `\n${from} -> ${to}` }
    // the statement the cursor is in (its end may stop before the cursor while it is typed) or the one above it
    const here = mine.findLast((s) => s.from <= this.offset)
    if (here) return { from: here.from, to: here.from, insert: `${from} -> ${to}\n` }
    const end = range.to
    return { from: end, to: end, insert: `${this.source[end - 1] === '\n' ? '' : '\n'}${from} -> ${to}\n` }
  }

  /** The nodes a flow may come from: those that run no stage first. */
  sources(): Completion[] {
    const running = new Set(this.boxOf().values())
    // a subsystem is no node a flow comes from
    const subsystems = new Set(this.subsystems(false))
    return this.nodes().flatMap((n) =>
      subsystems.has(n.label) ? [] : [running.has(n.label) ? n : { ...n, detail: 'node, runs no stage', boost: 2 }],
    )
  }

  /** The flows, those in `near` first. */
  flowsHere(near?: ReadonlySet<string>): Completion[] {
    return this.flows().map((label) =>
      near?.has(label)
        ? { label, type: 'variable', detail: 'passes here', boost: 2 }
        : { label, type: 'variable', detail: 'flow' },
    )
  }

  /** The flows that pass the queue or the box whose block the cursor is in (partitions, held). */
  passing(): Set<string> | undefined {
    const queue = this.path.findLast((d): d is Decl => d.kind === 'decl' && d.keyword.name === 'queue')
    if (queue) {
      const id = queue.args[0]
      const stage = id?.t === 'id' ? id.name : this.box()
      const routes = this.routes()
      return new Set(this.ids('flow').filter((f) => stage != null && routes.get(f)?.has(stage)))
    }
    const box = this.box()
    if (box) return new Set(this.reaching(box))
    // a component of its own: the stages it is on
    const d = this.path.findLast((x): x is Decl => x.kind === 'decl' && x.keyword.name === 'component')
    const on = d?.body?.find((x) => x.kind === 'prop' && x.key.name === 'on')
    if (on?.kind !== 'prop') return undefined
    const stages = new Set((on.chain ?? [on.value]).flatMap((n) => ('name' in n ? [n.name] : [])))
    const routes = this.routes()
    return new Set(this.ids('flow').filter((f) => [...(routes.get(f) ?? [])].some((st) => stages.has(st))))
  }

  /** The flows whose route takes the connection's hop, a -> b. */
  hopFlows(): Set<string> | undefined {
    const d = this.path.at(-1)
    const hop = d?.kind === 'decl' ? d.body?.find((s) => s.kind === 'prop' && s.key.name === 'hop') : undefined
    const chain = hop?.kind === 'prop' ? hop.chain : undefined
    const [a, b] = (chain ?? []).map((n) => ('name' in n ? this.stageOf(n.name) : ''))
    if (!a || !b) return undefined
    const out = new Set<string>()
    // from the flow's from node to its first stage too
    for (const [flow, { from, stages }] of this.routeChains()) {
      const hops = [...(from != null ? [from] : []), ...stages]
      for (let i = 0; i + 1 < hops.length; i++) if (hops[i] === a && hops[i + 1] === b) out.add(flow)
    }
    return out
  }

  /** Each flow's route in order, by its stages (a box with one stage read as it), and the node it comes from. */
  routeChains(): Map<string, { from?: string; stages: string[] }> {
    if (this.chainMemo) return this.chainMemo
    const out = new Map<string, { from?: string; stages: string[] }>()
    for (const s of this.body) {
      if (s.kind !== 'decl' || s.keyword.name !== 'flow' || s.args[0]?.t !== 'id') continue
      const route = s.body?.find((p) => p.kind === 'prop' && p.key.name === 'route')
      const from = propOf(s, 'from')
      if (route?.kind === 'prop')
        out.set(s.args[0].name, {
          ...(from?.t === 'id' && { from: from.name }),
          stages: (route.chain ?? [route.value]).flatMap((n) => ('name' in n ? [this.stageOf(n.name)] : [])),
        })
    }
    this.chainMemo = out
    return out
  }

  /** Every node; after `a ->`, not `a` itself. In a subsystem, its own boxes, by the ids they have there. */
  nodes(prev?: string): Completion[] {
    const subs = this.path.filter((d): d is Decl => d.kind === 'decl' && d.keyword.name === 'subsystem')
    const sub = subs.at(-1)
    // its id outside, `outer.inner.`: what a like brought into it is declared under it
    const prefix = `${subs.map((d) => (d.args[0]?.t === 'id' ? d.args[0].name : '')).join('.')}.`
    const ids = sub
      ? [
          ...new Set([
            ...(sub.body ?? []).flatMap((s) =>
              s.kind === 'decl' &&
              ([...BOXES, 'subsystem'] as string[]).includes(s.keyword.name) &&
              s.args[0]?.t === 'id'
                ? [s.args[0].name]
                : [],
            ),
            ...this.ids('node').flatMap((id) => (id.startsWith(prefix) ? [id.slice(prefix.length)] : [])),
          ]),
        ]
      : [...this.ids('node'), ...this.subsystems(false)]
    // not the box itself, nor its own boxes: an edge leaves a subsystem from its last box
    const mine = (id: string) => prev != null && (id === prev || id.startsWith(`${prev}.`))
    if (prev == null || sub)
      return ids.flatMap((label) => (mine(label) ? [] : [{ label, type: 'variable' as const, detail: 'node' }]))
    // not an edge drawn already; first, where a flow's route goes next
    const drawn = new Set(this.edgePairs().flatMap(([a, b]) => (a === prev ? [b] : [])))
    const box = this.boxOf()
    const next = new Set<string>()
    // its hops: from its from node to its first stage, then from each stage's box to the next
    for (const { from, stages } of this.routeChains().values()) {
      const boxes = [...(from != null ? [from] : []), ...stages.map((st) => box.get(st) ?? st)]
      for (let i = 0; i + 1 < boxes.length; i++) if (boxes[i] === prev) next.add(boxes[i + 1]!)
    }
    // an edge drawn already last: a second one may stand under another condition
    return ids.flatMap((label): Completion[] =>
      mine(label)
        ? []
        : [
            drawn.has(label)
              ? { label, type: 'variable', detail: 'node, drawn already', boost: -1 }
              : next.has(label)
                ? { label, type: 'variable', detail: 'node, a route goes here', boost: 2 }
                : { label, type: 'variable', detail: 'node' },
          ],
    )
  }

  /**
   * The subsystems at the top, by id; `routed`: only those a route may name, which say what a flow passes (`route:`)
   * or are like one that does.
   */
  subsystems(routed: boolean): string[] {
    const subs = this.body.filter(
      (s): s is Decl => s.kind === 'decl' && s.keyword.name === 'subsystem' && s.args[0]?.t === 'id',
    )
    const imported = (name: string) => !!this.ctx.imported?.some((i) => i.name === name && i.route)
    return subs.flatMap((d) =>
      !routed || routable(d, this.body, imported) ? [(d.args[0] as { name: string }).name] : [],
    )
  }

  /** What the box or subsystem being written may be like: one of its kind, of this file or imported. */
  prototypes(): Completion[] {
    const d = this.path.at(-1)
    if (d?.kind !== 'decl') return []
    const kind = d.keyword.name
    const self = d.args[0]?.t === 'id' ? d.args[0].name : undefined
    const out: Completion[] = []
    for (const s of this.body) {
      const id = s.kind === 'decl' && s.keyword.name === kind ? s.args[0] : undefined
      if (id?.t !== 'id' || id.name === self || out.some((o) => o.label === id.name)) continue
      const inputs = inputsOf(this.source, s as Decl).length > 0
      out.push({ label: id.name, type: 'type', detail: inputs ? `${kind} with inputs` : kind, boost: inputs ? 2 : 0 })
    }
    for (const i of this.ctx.imported ?? [])
      if (i.keyword === kind && !out.some((o) => o.label === i.name))
        out.push({ label: i.name, type: 'type', detail: `${kind} of ${i.from}`, boost: i.inputs ? 3 : 1 })
    return out
  }

  private routesMemo?: Map<string, Set<string>>

  /** Each flow's stages: its route, and the stages a fan-out copies it to or a split sends it through. */
  routes(): Map<string, Set<string>> {
    if (this.routesMemo) return this.routesMemo
    const out = new Map<string, Set<string>>()
    const add = (f: string, s: string) => out.set(f, (out.get(f) ?? new Set()).add(s))
    for (const [flow, { stages }] of this.routeChains()) for (const st of stages) add(flow, st)
    const visit = (list: readonly Stmt[], fanout: boolean) => {
      for (const s of list) {
        if (s.kind === 'edge' && fanout) for (const n of s.chain.slice(1)) add(s.chain[0]!.name, this.stageOf(n.name))
        if (s.kind === 'decl' && s.body) visit(s.body, s.keyword.name === 'fanout' || s.keyword.name === 'split')
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
    if (!slot.key || !['demand', 'capacity', 'when', 'held'].includes(slot.key)) return undefined
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

/** The tokens with each dotted name as one: `orderLine . kafka` is `orderLine.kafka`; a trailing dot stays. */
function joinDots(tokens: readonly Token[]): Token[] {
  const out: Token[] = []
  for (const t of tokens) {
    const dot = out.at(-1)
    const name = out.at(-2)
    if (
      t.kind === 'ident' &&
      punct(dot, '.') &&
      name?.kind === 'ident' &&
      name.to === dot!.from &&
      dot!.to === t.from
    ) {
      out.splice(-2, 2, { ...name, text: `${name.text}.${t.text}`, to: t.to })
    } else out.push(t)
  }
  return out
}

/**
 * Whether a route may name a subsystem: it says what a flow passes (`route:`), or is like one that does, in `body` (its
 * file's statements) or, by the name it has there, one `imported` says does.
 */
export function routable(d: Decl, body: readonly Stmt[], imported?: (name: string) => boolean, depth = 0): boolean {
  if (d.body?.some((s) => s.kind === 'prop' && s.key.name === 'route')) return true
  const like = propOf(d, 'like')
  if (like?.t !== 'id' || depth >= MAX_NESTING) return false
  const local = body.find(
    (s): s is Decl =>
      s.kind === 'decl' && s.keyword.name === 'subsystem' && s.args[0]?.t === 'id' && s.args[0].name === like.name,
  )
  return local ? routable(local, body, imported, depth + 1) : !!imported?.(like.name)
}

/** The `input` lines of a prototype or a subsystem. */
export function inputsOf(source: string, d: Decl): Input[] {
  return (d.body ?? []).flatMap((s): Input[] => {
    if (s.kind !== 'decl' || s.keyword.name !== 'input') return []
    const [first, second] = s.args
    if (first?.t === 'id' && first.name === 'flow' && second?.t === 'id') return [{ name: second.name, flow: true }]
    if (first?.t !== 'id') return []
    return [{ name: first.name, flow: false, ...(s.init && { default: source.slice(s.init.from, s.init.to) }) }]
  })
}

/** The inputs of the box or subsystem `name` declared at the top of `body`. */
export function inputsIn(source: string, body: readonly Stmt[], name: string): Input[] {
  const d = body.find((s): s is Decl => s.kind === 'decl' && s.args[0]?.t === 'id' && s.args[0].name === name)
  return d ? inputsOf(source, d) : []
}

/** The head lines as snippets: the path in quotes, an import's names. */
const HEAD_SNIPPETS: Readonly<Record<string, string>> = {
  include: 'include "${1:./part.loadmap}"',
  import: 'import "${1:./library.loadmap}" { ${2:name} }',
  part: 'part of "${1:./model.loadmap}"',
  library: 'library "${1:what it holds}"',
  extends: 'extends "${1:./model.loadmap}"',
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

/**
 * Whether the definition's version writes it: from its `since`, and before its `until` or the version that moved it
 * elsewhere (`movedTo`). A newer stamp still reads what it no longer writes; completion offers only what it writes.
 */
function writes(version: Version, s: { since?: string; until?: string; movedTo?: string; movedIn?: string }) {
  const at = (v: string) => parseVersion(v)!
  if (s.since && before(version, at(s.since))) return false
  if (s.until && !before(version, at(s.until))) return false
  return !(s.movedTo && !before(version, at(s.movedIn ?? '1.2')))
}

function props(p: Readonly<Record<string, PropSpec>>, written: ReadonlySet<string>, version: Version): Completion[] {
  return Object.entries(p).flatMap(([label, s]) =>
    (written.has(label) && !s.repeat) || !writes(version, s)
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

function statements(spec: BlockSpec, version: Version, snippets = true): Completion[] {
  return spec.children
    .filter((k) => k !== 'loadmap' && writes(version, SCHEMA[k]!))
    .map((k) => ({
      label: k,
      type: 'keyword',
      info: `${SCHEMA[k]!.doc}\n\n${SCHEMA[k]!.example}`,
      snippet: snippets ? statementSnippet(k, version) : undefined,
    }))
}

/** What a statement's lines hold first, beyond its required properties: what makes it useful. */
const STARTS: Readonly<Record<string, readonly string[]>> = {
  node: ['#{pass}', 'capacity: #{capacity}'],
  cluster: ['queue #{topic} { partitions { #{flow}: #{12} } }', 'capacity: #{capacity}'],
  pool: ['pods: #{2}', 'perPod: #{8}', 'capacity: #{capacity}'],
  component: ['demand: #{demand}', 'capacity: #{capacity}'],
  expect: ['underTarget: #{2}'],
  step: ['load: #{10}'],
  scenario: ['#{param}: #{value}'],
  preset: ['load: #{10}'],
  // a fit needs two distinct x
  fit: ['points #{x} #{y} {', '  #{1} #{1}', '  #{2} #{2}', '}'],
}

/** The same, as an older version writes it: a pool's workers in their block before 1.5, `target` before 1.1. */
const STARTS_BEFORE: Readonly<Record<string, readonly [since: Version, lines: readonly string[]]>> = {
  pool: [
    [1, 5],
    ['workers { pods: #{2}; perPod: #{8} }', 'capacity: #{capacity}'],
  ],
  expect: [[1, 1], ['target: #{2}']],
}

/**
 * A whole statement as a snippet, from the schema: its id and label, its required properties with a value of their
 * kind, and for a box a stage and a capacity. Statements with nothing to fill in (`pass`, `store`) have none.
 */
function statementSnippet(k: string, version: Version): string | undefined {
  const s = SCHEMA[k]!
  let n = 0
  const field = (name: string) => `\${${++n}:${name}}`
  const words = [k]
  for (const a of s.args) {
    if (a.kind === 'id' && !a.optional) words.push(field(a.name))
    else if (a.kind === 'text' && (!a.optional || a.name === 'label')) words.push(`"${field(a.name)}"`)
    else if (a.kind === 'number' && !a.optional) words.push(field('1'))
  }
  if (s.init) words.push('=', field('formula'))
  const values: Partial<Record<PropSpec['value'], string>> = {
    string: '"#{KEY}"',
    route: '#{a} -> #{b}',
    node: '#{node}',
    capacity: 'estimated(#{value}, "#{unit}", "#{source}")',
  }
  const lines = [
    ...Object.entries(s.props)
      .filter(([, p]) => p.required)
      .map(
        ([key, p]) =>
          `${key}: ${(values[p.value] ?? `#{${p.values?.[0] ?? (key === 'default' ? 1 : key)}}`).replace('KEY', key)}`,
      ),
    ...(own(STARTS_BEFORE, k) && before(version, STARTS_BEFORE[k]![0]) ? STARTS_BEFORE[k]![1] : (STARTS[k] ?? [])).map(
      (l) => l.replace('#{capacity}', 'estimated(#{value}, "#{unit}", "#{source}")'),
    ),
  ]
  // #{…} in the lines are fields too, numbered after the words
  const body = lines.map((l) => l.replace(/#\{([^}]*)\}/g, (_, name: string) => field(name)))
  if (!body.length && words.length === 1) return undefined
  return body.length ? `${words.join(' ')} {\n${body.map((l) => `  ${l}`).join('\n')}\n}` : words.join(' ')
}

function singleStageBoxes(symbols: readonly DslSymbol[]): string[] {
  const count = new Map<string, number>()
  for (const s of symbols) if (s.kind === 'stage' && s.detail) count.set(s.detail, (count.get(s.detail) ?? 0) + 1)
  const stages = new Set(symbols.filter((s) => s.kind === 'stage').map((s) => s.id))
  return [...count].filter(([box, n]) => n === 1 && !stages.has(box)).map(([box]) => box)
}
