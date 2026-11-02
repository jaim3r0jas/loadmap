import {
  type Branch,
  type CheckResult,
  check,
  defineModel,
  fanout,
  type LinearFit,
  type Model,
  type Overload,
  p,
  parseAsOf,
  pass,
  queue,
  type StageDef,
  sink,
  store,
  workers,
} from '@loadmap/core'
import { fitLinear } from '@loadmap/core/calibrate'
import {
  type AnyNodeDef,
  type Direction,
  defineView,
  type EdgeDef,
  type FlowView,
  labelsAt,
  type View,
} from '@loadmap/layout'
import type { Decl, Document, Edge, Expr, Ident, Property, Row, Stmt } from './ast'
import { type Diagnostic, didYouMean, Reporter, type Span } from './diagnostics'
import {
  compileFormula,
  type Formula,
  FormulaError,
  type HostFunctions,
  isCapacity,
  type Names,
  placed,
  RESERVED,
  type Type,
  typeWord,
} from './expr'
import { parse } from './parser'
import {
  type BlockSpec,
  BOXES,
  COLORS,
  COMPONENT_PROPS,
  EDGE_PROPS,
  own,
  type PropSpec,
  SCHEMA,
  type Scope,
  STAGES,
} from './schema'

/** The version of the language this package reads: the number on a definition's first line. */
export const LANGUAGE_VERSION = 1

/** Counts that size the drawing; larger ones would hang the layout, so a shared link cannot ask for them. */
export const LIMITS = { members: 64, pods: 256, perPod: 256, partitions: 1024 } as const

export interface CompileOptions {
  /** Functions formulas may call beyond the built-in ones: the escape hatch for what formulas cannot say. */
  functions?: HostFunctions
}

/** What the definition sets beyond the model and the view: props of `<Loadmap>`. */
export interface DefinitionOptions {
  speed?: number
  direction?: Direction
  assumptions: string[]
}

export interface Definition {
  model: Model
  view: View
  options: DefinitionOptions
}

/** A name the definition declares, where: for autocomplete, and for finding a node's source. */
export interface DslSymbol {
  kind: 'param' | 'let' | 'fit' | 'flow' | 'node' | 'stage' | 'component' | 'scenario'
  id: string
  /** The id where it is written (or the keyword, for an id taken from its box). */
  span: Span
  /** The whole statement. */
  decl: Span
  /** For a stage, its box; for a node, its kind. */
  detail?: string
}

/** An `expect` line: where it is and whether it holds. */
export interface ExpectationResult {
  /** The keyword and the label. */
  at: Span
  line: number
  column: number
  result: CheckResult
}

export interface CompileResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Only when there are no errors. */
  definition?: Definition
  /** Each `expect` line, tested on the pessimistic edge; empty when the definition has errors. */
  expectations: ExpectationResult[]
  symbols: DslSymbol[]
  doc: Document
}

/** Reads a definition: parses, checks, and builds the model and view `<Loadmap>` takes. Never throws. */
export function compile(source: string, o: CompileOptions = {}): CompileResult {
  const report = new Reporter(source)
  const c = new Compiler(source, report, o.functions ?? {})
  let doc: Document = { body: [] }
  let definition: Definition | undefined
  let expectations: ExpectationResult[] = []
  try {
    doc = parse(source, report).doc
    definition = c.run(doc)
    if (definition)
      expectations = check(definition.model).map((result, i) => {
        const at = c.expectSpans[i]!
        return { at, ...report.position(at.from), result }
      })
  } catch (err) {
    // a formula that fails only at a capacity bound, while checking: it has its place
    if (err instanceof FormulaError) report.error(err.span, err.message)
    // a bug must not take the editor down with it: say so where the user looks
    else if (!(err instanceof Bail))
      report.error({ from: 0, to: 0 }, `internal error: ${(err as Error)?.message ?? err}`)
  }
  const diagnostics = [...report.list].sort((a, b) => a.from - b.from)
  return { ok: !report.failed && !!definition, diagnostics, definition, expectations, symbols: c.symbols, doc }
}

/**
 * The diagnostics and every failing expectation, in source order: an editor marks a failure as a warning (the
 * diagram still shows), `loadmap check` as an error.
 */
export function problems(r: CompileResult, failed: Diagnostic['severity'] = 'warning'): Diagnostic[] {
  const out = [...r.diagnostics]
  for (const e of r.expectations)
    if (!e.result.ok) {
      const name = e.result.expectation.label ? `"${e.result.expectation.label}" fails: ` : ''
      out.push({ severity: failed, message: `${name}${e.result.message}`, ...e.at, line: e.line, column: e.column })
    }
  return out.sort((a, b) => a.from - b.from)
}

/** Stops compiling after an error that leaves nothing sensible to check. */
class Bail {}

interface Args {
  id?: Ident
  label?: Expr
  sub?: Expr
  version?: Expr
  x?: Ident
  y?: Ident
}

/** A statement with its shape checked against the schema. */
interface Block {
  keyword: string
  spec: BlockSpec
  /** The keyword: where errors about the whole block go. */
  at: Span
  decl?: Decl
  args: Args
  props: Map<string, Property[]>
  children: Block[]
  edges: Edge[]
  rows: Row[]
}

interface Box {
  block: Block
  id: string
  stages: { block: Block; id: string }[]
  /** The component it owns: its own lines, or a nested `component`. */
  component?: { block: Block; id: string; own: boolean }
}

class Compiler {
  readonly symbols: DslSymbol[] = []
  /** Where each expectation of the model is written, in order. */
  readonly expectSpans: Span[] = []
  names!: Names
  private fits = new Map<string, LinearFit | null>()
  private lets = new Map<string, Type>()

  constructor(
    readonly source: string,
    readonly report: Reporter,
    readonly functions: HostFunctions,
  ) {}

  run(doc: Document): Definition | undefined {
    const root = this.shape('', SCHEMA['']!, doc.body, { from: 0, to: 0 })
    this.header(doc.body)

    // names first: formulas and routes may refer to anything declared further down
    const byKind = (k: string) => root.children.filter((b) => b.keyword === k)
    const loads = byKind('load')
    if (!loads.length) this.report.error({ from: 0, to: 0 }, 'a definition needs a load line', 'load { max: 100 }')
    for (const extra of loads.slice(1)) this.report.error(extra.at, 'only one load line is allowed')
    const params = byKind('param')
    const lets = byKind('let')
    const fits = byKind('fit')
    const flows = byKind('flow')
    const boxes = root.children
      .filter((b) => (BOXES as readonly string[]).includes(b.keyword) && b.args.id)
      .map((b) => this.box(b))
    const loose = byKind('component')

    const formulaNames = new Map<string, Span>()
    const own = (kind: DslSymbol['kind'], b: Block, taken: Map<string, Span>) => {
      const id = b.args.id
      if (!id) return
      this.declare(kind, id.name, id, b, taken)
    }
    for (const b of [...params, ...lets, ...fits]) {
      own(b.keyword === 'param' ? 'param' : b.keyword === 'let' ? 'let' : 'fit', b, formulaNames)
      if (b.args.id && RESERVED.has(b.args.id.name))
        this.report.error(b.args.id, `"${b.args.id.name}" is a reserved name; pick another`)
    }
    const flowNames = new Map<string, Span>()
    for (const b of flows) own('flow', b, flowNames)
    const nodeNames = new Map<string, Span>()
    const stageNames = new Map<string, Span>()
    const componentNames = new Map<string, Span>()
    for (const box of boxes) {
      this.declare('node', box.id, box.block.args.id!, box.block, nodeNames, box.block.keyword)
      for (const s of box.stages)
        this.declare('stage', s.id, s.block.args.id ?? s.block.at, s.block, stageNames, box.id)
      if (box.component) {
        const c = box.component
        this.declare(
          'component',
          c.id,
          c.own ? box.block.args.id! : (c.block.args.id ?? c.block.at),
          c.block,
          componentNames,
        )
      }
    }
    for (const b of loose) {
      if (!b.args.id) this.report.error(b.at, 'a component outside a box needs an id: component cache "Cache"')
      else own('component', b, componentNames)
    }

    const paramTypes = new Map<string, Type>([['load', 'number']])
    for (const b of params) if (b.args.id) paramTypes.set(b.args.id.name, this.paramType(b))
    for (const f of fits) this.fit(f)
    this.names = {
      params: paramTypes,
      lets: this.lets,
      flows: new Set(flowNames.keys()),
      components: new Set(componentNames.keys()),
      fits: this.fits,
      functions: this.functions,
    }
    // a let's type comes from its formula, which may use other lets: settle them on a scratch reporter first
    for (const b of lets) if (b.args.id) this.lets.set(b.args.id.name, 'any')
    // until nothing changes: each pass settles at least one more let of a chain, so it ends within lets.length
    for (let changed = true, pass = 0; changed && pass <= lets.length; pass++) {
      changed = false
      for (const b of lets) {
        if (!b.args.id || !b.decl?.init) continue
        const type = compileFormula(b.decl.init, this.names, 'ctx', new Reporter(this.source)).type
        if (type !== this.lets.get(b.args.id.name)) changed = true
        this.lets.set(b.args.id.name, type)
      }
    }

    const stageOf = new Map<string, { block: Block; box: Box }>()
    for (const box of boxes) for (const s of box.stages) stageOf.set(s.id, { block: s.block, box })
    const boxById = new Map(boxes.map((b) => [b.id, b]))

    // the model
    const load = loads[0] && this.load(loads[0])
    const paramDefs: Record<string, unknown> = {}
    for (const b of params) if (b.args.id) paramDefs[b.args.id.name] = this.param(b)
    const presets: Record<string, Record<string, unknown>> = {}
    for (const b of byKind('preset')) {
      const label = this.text(b.args.label)
      if (label != null) presets[label] = this.preset(b, params)
    }
    const scenarios: Record<string, Record<string, unknown>> = {}
    for (const b of byKind('scenario')) {
      const label = this.text(b.args.label)
      if (label == null) continue
      if (Object.hasOwn(scenarios, label)) this.report.error(b.args.label!, `scenario "${label}" is declared twice`)
      else scenarios[label] = this.preset(b, params, 'scenario')
      this.symbols.push({ kind: 'scenario', id: label, span: b.args.label!, decl: b.decl ?? b.at })
    }
    const expects: Record<string, unknown>[] = []
    for (const b of byKind('expect')) {
      const e = this.expectation(b, scenarios, componentNames)
      if (!e) continue
      expects.push(e)
      this.expectSpans.push({ from: b.at.from, to: b.args.label?.to ?? b.at.to })
    }
    const story: Record<string, unknown>[] = []
    for (const b of byKind('step')) {
      const st = this.step(b, scenarios, componentNames, params)
      if (st) story.push(st)
    }
    const growths = byKind('growth')
    for (const extra of growths.slice(1)) this.report.error(extra.at, 'only one growth line is allowed')
    const growth = growths[0] && this.growth(growths[0])
    const derived: Record<string, unknown> = {}
    for (const b of lets)
      if (b.args.id && b.decl?.init) derived[b.args.id.name] = placed(b.decl.init, this.formula(b.decl.init, 'ctx').run)

    const resolveStage = (n: Ident, what: string): string | undefined => {
      if (stageOf.has(n.name)) return n.name
      const box = boxById.get(n.name)
      if (box?.stages.length === 1) return box.stages[0]!.id
      if (box)
        this.report.error(
          n,
          box.stages.length
            ? `"${n.name}" holds ${box.stages.length} stages; name one: ${box.stages.map((s) => s.id).join(', ')}`
            : `the box "${n.name}" runs no stage`,
        )
      else
        this.report.error(n, `unknown ${what} "${n.name}"`, didYouMean(n.name, [...stageOf.keys(), ...boxById.keys()]))
      return undefined
    }

    const flowDefs: Record<string, unknown> = {}
    const flowViews: Record<string, FlowView> = {}
    const routes: Record<string, string[]> = {}
    const reached = new Set<string>()
    for (const b of flows) {
      const id = b.args.id
      if (!id) continue
      const label = this.text(b.args.label)
      const def: Record<string, unknown> = {}
      if (label != null) def.label = label
      const unit = this.constProp<string>(b, 'unit')
      if (unit != null) def.unit = unit
      def.rate = this.dynProp(b, 'rate', 'number')
      const priority = this.constProp<number>(b, 'priority')
      if (priority != null) def.priority = priority
      const overload = this.overload(b)
      if (overload) def.overload = overload
      flowDefs[id.name] = def

      const route = this.prop(b, 'route')
      const stages: string[] = []
      for (const [i, n] of (route?.chain ?? (route?.value.t === 'id' ? [route.value as Ident] : [])).entries()) {
        const s = resolveStage(n, 'stage')
        if (!s) continue
        if (stageOf.get(s)!.block.keyword === 'fanout' && i < (route?.chain?.length ?? 1) - 1)
          this.report.error(n, `the fan-out "${s}" must be the last stage of the route`)
        stages.push(s)
        reached.add(s)
      }
      if (route && route.value.t !== 'id') this.report.error(route.value, 'a route is a list of stages: a -> b -> c')
      routes[id.name] = stages

      const from = this.prop(b, 'from')
      const view: FlowView = { from: '', color: 'accent' }
      if (from) {
        if (from.value.t === 'id' && boxById.has(from.value.name)) view.from = from.value.name
        else
          this.report.error(
            from.value,
            `unknown node "${this.slice(from.value)}"`,
            didYouMean(this.slice(from.value), boxById.keys()),
          )
      }
      const color = this.prop(b, 'color')
      if (color) view.color = this.color(color.value)
      if (label != null) view.label = label
      flowViews[id.name] = view
    }

    const componentDefs: Record<string, unknown> = {}
    for (const box of boxes)
      if (box.component) componentDefs[box.component.id] = this.component(box.component.block, box.block)
    for (const b of loose) if (b.args.id) componentDefs[b.args.id.name] = this.component(b)

    const stageDefs: Record<string, StageDef> = {}
    for (const box of boxes)
      for (const s of box.stages) {
        const def = this.stage(s.block, box, componentNames, resolveStage, flowNames, reached)
        if (def) stageDefs[s.id] = def
      }
    for (const [id, s] of stageOf)
      if (!reached.has(id) && s.block.keyword !== 'fanout')
        this.report.warning(s.block.args.id ?? s.block.at, `no flow passes the stage "${id}"`)

    const calibration: Record<string, LinearFit> = {}
    for (const f of fits) {
      const fit = f.args.id && this.fits.get(f.args.id.name)
      if (fit) calibration[this.text(f.args.label) ?? f.args.id!.name] = fit
    }

    const model: Record<string, unknown> = {
      load,
      params: paramDefs,
      flows: flowDefs,
      components: componentDefs,
      stages: stageDefs,
      routes,
    }
    const title = this.constProp<string>(root, 'title')
    if (title != null) model.title = title
    if (Object.keys(presets).length) model.presets = presets
    if (Object.keys(scenarios).length) model.scenarios = scenarios
    if (growth) model.growth = growth
    if (expects.length) model.expect = expects
    if (story.length) model.story = story
    if (Object.keys(derived).length) model.derived = derived
    if (Object.keys(calibration).length) model.calibration = calibration
    const th = byKind('thresholds')[0]
    if (th) {
      const t: Record<string, number> = {}
      for (const k of ['target', 'full']) {
        const v = this.constProp<number>(th, k)
        if (v != null) t[k] = v
      }
      model.thresholds = t
    }
    const searchMax = this.constProp<number>(root, 'searchMax')
    if (searchMax != null) model.searchMax = searchMax

    // the view
    const nodes: Record<string, AnyNodeDef> = {}
    for (const box of boxes) nodes[box.id] = this.node(box)
    const edges: EdgeDef[] = []
    for (const e of root.edges) edges.push(...this.edges(e, boxById))
    if (!flows.length) this.report.error({ from: 0, to: 0 }, 'a definition needs at least one flow')

    const options: DefinitionOptions = { assumptions: [] }
    const speed = this.constProp<number>(root, 'speed')
    if (speed != null) options.speed = speed
    const layout = this.prop(root, 'layout')
    if (layout) options.direction = this.enumValue(layout, SCHEMA['']!.props.layout!) === 'down' ? 'DOWN' : 'RIGHT'
    for (const a of root.props.get('assume') ?? []) {
      const v = this.constant(a.value, 'string')
      if (typeof v === 'string') options.assumptions.push(v)
    }

    if (this.report.failed) return undefined
    return this.build(model, { nodes, edges, flows: flowViews }, options, byKind('preset'), byKind('scenario'))
  }

  /** Hands the parts to core and layout, then runs the model once per preset and scenario so formula errors show now. */
  private build(
    modelDef: Record<string, unknown>,
    viewDef: { nodes: Record<string, AnyNodeDef>; edges: EdgeDef[]; flows: Record<string, FlowView> },
    options: DefinitionOptions,
    presets: Block[],
    scenarios: Block[],
  ): Definition | undefined {
    const top = { from: 0, to: 0 }
    let model: Model
    let view: View
    try {
      model = defineModel(modelDef as any)
      view = defineView(model, viewDef as any)
    } catch (err) {
      this.report.error(top, err instanceof Error ? err.message.replace(/^loadmap: /, '') : String(err))
      return undefined
    }
    const runs: { values: Record<string, unknown>; at: Span }[] = [{ values: {}, at: top }]
    for (const b of presets) {
      const label = this.text(b.args.label)
      const v = label != null && (modelDef.presets as Record<string, Record<string, unknown>> | undefined)?.[label]
      if (v) runs.push({ values: v, at: b.at })
    }
    for (const b of scenarios) {
      const label = this.text(b.args.label)
      const v = label != null && model.scenarios.find((s) => s.label === label)?.values
      if (v) runs.push({ values: v, at: b.at })
    }
    for (const { values, at } of runs) {
      try {
        const ev = model.evaluate(values as any)
        labelsAt(view, ev)
        // what the evaluation alone leaves lazy: every let, and the counts and labels only the layout reads
        for (const k of Object.keys((modelDef.derived as object | undefined) ?? {})) void ev.ctx.derived[k]
        for (const n of Object.values(viewDef.nodes)) {
          if (n.kind === 'cluster') {
            const members = typeof n.members === 'function' ? n.members(ev.ctx) : n.members
            n.memberLabel?.(Math.max(0, members - 1))
          }
          if (n.kind === 'pool') n.podLabel?.(0)
        }
        for (const e of viewDef.edges) e.when?.(ev.ctx)
        for (const f of model.flowIds)
          if (!Number.isFinite(ev.flows[f]))
            this.report.warning(this.flowRate.get(f) ?? at, `the rate of "${f}" is ${ev.flows[f]} here`)
      } catch (err) {
        if (err instanceof FormulaError) this.report.error(err.span, err.message)
        else this.report.error(at, err instanceof Error ? err.message.replace(/^loadmap: /, '') : String(err))
      }
    }
    if (this.report.failed) return undefined
    return { model, view, options }
  }

  private flowRate = new Map<string, Span>()

  // -- shape ---------------------------------------------------------------------------------------------------

  private shape(keyword: string, spec: BlockSpec, stmts: readonly Stmt[], at: Span, decl?: Decl): Block {
    const b: Block = { keyword, spec, at, decl, args: {}, props: new Map(), children: [], edges: [], rows: [] }
    if (decl) this.args(b, decl)
    const here = keyword ? `in ${keyword}` : 'at the top'
    for (const s of stmts) {
      if (s.kind === 'prop') {
        const k = s.key.name
        if (!spec.open && !own(spec.props, k)) {
          const hint = spec.children.includes(k)
            ? `write it as a block: ${k} { … }`
            : didYouMean(k, [...Object.keys(spec.props), ...spec.children])
          this.report.error(s.key, `unknown property "${k}" ${here}`, hint)
          continue
        }
        const list = b.props.get(k) ?? []
        if (list.length && !(own(spec.props, k)?.repeat ?? false))
          this.report.error(s.key, `"${k}" is set twice ${here}`, 'remove one of them')
        list.push(s)
        b.props.set(k, list)
      } else if (s.kind === 'decl') {
        const k = s.keyword.name
        const childSpec = own(SCHEMA, k)
        if (!spec.children.includes(k) || !childSpec || k === '') {
          if (own(spec.props, k)) this.report.error(s.keyword, `"${k}" is a property: write "${k}: …"`)
          else if (childSpec) this.report.error(s.keyword, `"${k}" cannot go ${here}`, where(k))
          else
            this.report.error(
              s.keyword,
              `unknown statement "${k}" ${here}`,
              didYouMean(k, [...spec.children, ...Object.keys(spec.props)]),
            )
          continue
        }
        b.children.push(this.shape(k, childSpec, s.body ?? [], s.keyword, s))
      } else if (s.kind === 'edge') {
        if (!spec.edges) this.report.error(s.chain[0]!, `an "a -> b" line cannot go ${here}`)
        else b.edges.push(s)
      } else if (!spec.rows) this.report.error(s, `a row of numbers can only go in "points"`)
      else b.rows.push(s)
    }
    if (decl)
      for (const [k, p] of Object.entries(spec.props))
        if (p.required && !b.props.has(k)) this.report.error(at, `"${keyword}" needs "${k}: …"`, p.doc)
    return b
  }

  private args(b: Block, d: Decl) {
    const slots = [...b.spec.args]
    for (const a of d.args) {
      const kind = a.t === 'id' ? 'id' : a.t === 'str' || a.t === 'tpl' ? 'text' : a.t === 'num' ? 'number' : null
      const i = slots.findIndex((s) => s.kind === kind)
      if (kind == null || i < 0 || slots.slice(0, i).some((s) => !s.optional)) {
        this.report.error(a, `unexpected ${this.slice(a)} after "${b.keyword}"`, usage(b.keyword))
        continue
      }
      const slot = slots[i]!
      slots.splice(0, i + 1)
      if (a.t === 'tpl' && !slot.dynamic && !a.parts.length) {
        ;(b.args as Record<string, Expr>)[slot.name] = { t: 'str', value: a.quasis[0]!, from: a.from, to: a.to }
        continue
      }
      if (a.t === 'tpl' && !slot.dynamic)
        this.report.error(a, `the ${slot.name} of "${b.keyword}" must be a plain text`)
      if (a.t === 'id') b.args[slot.name as 'id' | 'x' | 'y'] = { name: a.name, from: a.from, to: a.to }
      else (b.args as Record<string, Expr>)[slot.name] = a
    }
    const missing = slots.find((s) => !s.optional)
    if (missing) this.report.error(b.at, `"${b.keyword}" needs its ${missing.name}`, usage(b.keyword))
    if (b.spec.init && !d.init) this.report.error(b.at, `"${b.keyword}" needs "= formula"`, usage(b.keyword))
    if (!b.spec.init && d.init) this.report.error(d.init, `"${b.keyword}" takes no "="`)
  }

  private header(body: readonly Stmt[]) {
    const first = body[0]
    const isHeader = (s: Stmt | undefined): s is Decl => s?.kind === 'decl' && s.keyword.name === 'loadmap'
    if (!isHeader(first)) {
      this.report.error(
        first ?? { from: 0, to: 0 },
        `a definition starts with "loadmap ${LANGUAGE_VERSION}"`,
        `add "loadmap ${LANGUAGE_VERSION}" as the first line`,
      )
      throw new Bail()
    }
    for (const s of body.slice(1))
      if (isHeader(s)) this.report.error(s.keyword, 'the "loadmap" line must be the first and only one')
    const v = first.args[0]
    if (v?.t === 'num' && v.value !== LANGUAGE_VERSION) {
      this.report.error(
        v,
        v.value > LANGUAGE_VERSION
          ? `this definition is written in language version ${v.value}; this loadmap reads version ${LANGUAGE_VERSION}`
          : `there is no language version ${v.value}; the first is 1`,
        v.value > LANGUAGE_VERSION ? 'update @loadmap/dsl' : undefined,
      )
      throw new Bail()
    }
  }

  private declare(
    kind: DslSymbol['kind'],
    id: string,
    span: Span,
    b: Block,
    taken: Map<string, Span>,
    detail?: string,
  ) {
    if (FORBIDDEN.has(id)) this.report.error(span, `"${id}" cannot be used as a name`)
    if (taken.has(id)) this.report.error(span, `"${id}" is declared twice`, 'rename one of them')
    else taken.set(id, span)
    this.symbols.push({ kind, id, span, decl: b.decl ?? b.at, detail })
  }

  private box(b: Block): Box {
    const id = b.args.id!.name
    const stageBlocks = b.children.filter((c) => (STAGES as readonly string[]).includes(c.keyword))
    const stages = stageBlocks.map((s) => ({ block: s, id: s.args.id?.name ?? id }))
    const ownLines = Object.keys(COMPONENT_PROPS).some((k) => b.props.has(k))
    const nested = b.children.filter((c) => c.keyword === 'component')
    let component: Box['component']
    if (ownLines) component = { block: b, id, own: true }
    for (const n of nested) {
      if (component)
        this.report.error(n.at, `"${id}" already has a component`, 'one component per box; put others at the top')
      else component = { block: n, id: n.args.id?.name ?? id, own: false }
    }
    if (b.keyword === 'node' && stages.length > 1)
      this.report.error(stageBlocks[1]!.at, 'a node runs at most one stage; a cluster can hold several queues')
    if (b.keyword === 'cluster' && !stages.length)
      this.report.error(b.at, 'a cluster needs a queue', 'queue topic { partitions { orders: 12 } }')
    if (b.keyword === 'pool' && stages.length !== 1)
      this.report.error(b.at, 'a pool needs exactly one workers stage', 'workers { pods: 3; perPod: 8 }')
    const ids = new Set<string>()
    for (const s of stages) {
      if (ids.has(s.id)) this.report.error(s.block.at, `"${id}" has two stages called "${s.id}"`, 'give each an id')
      ids.add(s.id)
    }
    return { block: b, id, stages, component }
  }

  // -- values --------------------------------------------------------------------------------------------------

  private slice(s: Span) {
    return this.source.slice(s.from, s.to)
  }

  private prop(b: Block, key: string): Property | undefined {
    return b.props.get(key)?.[0]
  }

  private formula(e: Expr, scope: Scope, want?: Type): Formula {
    const f = compileFormula(e, this.names, scope, this.report)
    if (want && want !== 'any' && f.type !== want && f.type !== 'any') {
      // a number reads fine where a text is wanted: it is shown as written
      if (want === 'string' && f.type === 'number') {
        const run = f.run
        return { ...f, type: 'string', run: (c, l) => String(run(c, l)) }
      }
      if (want === 'capacity' && f.type === 'number')
        this.report.error(
          e,
          'a capacity says where it came from',
          `write measured(${this.slice(e)}, "unit", "source") or estimated(…)`,
        )
      else this.report.error(e, `expected ${typeWord(want)}, this is ${typeWord(f.type)}`)
    }
    return f
  }

  /** A value that must not depend on the model. */
  private constant(e: Expr, want: Type): unknown {
    const f = this.formula(e, 'const', want)
    try {
      return f.run(undefined)
    } catch (err) {
      this.report.error(e, err instanceof Error ? err.message : String(err))
      return undefined
    }
  }

  private constProp<T>(b: Block, key: string): T | undefined {
    const p = this.prop(b, key)
    if (!p) return undefined
    const spec = b.spec.props[key]!
    if (spec.value === 'enum') return this.enumValue(p, spec) as T
    return this.constant(p.value, spec.value as Type) as T | undefined
  }

  /**
   * A plain or computed value: a constant is computed now, so the model sees it as it would from TypeScript. `check`
   * throws on a value the drawing cannot take (a count too large); at run time its error carries the formula's place.
   */
  private dyn<T>(e: Expr, want: Type, scope: Scope = 'ctx', check?: (v: unknown) => void): T | ((ctx: any) => T) {
    const f = this.formula(e, scope, want)
    if (f.constant) {
      const v = this.constant(e, want)
      try {
        if (v !== undefined) check?.(v)
      } catch (err) {
        this.report.error(e, (err as Error).message)
      }
      return v as T
    }
    const run = f.run
    if (!check) return placed<T>(e, run)
    return placed<T>(e, (c, l) => {
      const v = run(c, l)
      check(v)
      return v
    })
  }

  private dynProp<T>(b: Block, key: string, want: Type, check?: (v: unknown) => void) {
    const p = this.prop(b, key)
    if (!p) return undefined
    if (key === 'rate' && b.args.id) this.flowRate.set(b.args.id.name, p.value)
    return this.dyn<T>(p.value, want, own(b.spec.props, key)?.scope ?? 'ctx', check)
  }

  /** A label or name argument: a plain text, or a template when the argument may be computed. */
  private text(e: Expr | undefined): string | undefined {
    if (!e) return undefined
    const v = this.constant(e, 'string')
    return typeof v === 'string' ? v : undefined
  }

  private label(e: Expr | undefined): string | ((ctx: any) => string) | undefined {
    if (!e) return undefined
    return this.dyn<string>(e, 'string')
  }

  private enumValue(p: Property, spec: PropSpec): string | undefined {
    const raw = p.value.t === 'str' ? p.value.value : this.slice(p.value).replace(/\s+/g, '')
    if (spec.values?.includes(raw)) return raw
    this.report.error(p.value, `"${raw}" is not one of ${spec.values!.join(', ')}`, didYouMean(raw, spec.values ?? []))
    return undefined
  }

  private color(e: Expr): string {
    if (e.t === 'id') {
      if ((COLORS as readonly string[]).includes(e.name)) return e.name
      this.report.error(e, `"${e.name}" is not a theme colour`, didYouMean(e.name, COLORS) ?? 'or quote a CSS colour')
    } else if (e.t === 'str') {
      if (CSS_COLOR.test(e.value.trim())) return e.value.trim()
      this.report.error(e, `"${e.value}" is not a colour`, 'use #rrggbb, rgb(…), hsl(…) or a theme colour')
    } else this.report.error(e, 'a colour is a theme colour or a CSS colour in quotes')
    return 'accent'
  }

  private count(what: keyof typeof LIMITS) {
    const max = LIMITS[what]
    return (v: unknown) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
        throw new Error(`${what} must be a whole number of at least 0, not ${String(v)}`)
      if (v > max) throw new Error(`${what} is ${v}; at most ${max}`)
    }
  }

  // -- model ---------------------------------------------------------------------------------------------------

  private load(b: Block) {
    const o: Record<string, unknown> = {}
    const label = this.text(b.args.label)
    if (label != null) o.label = label
    for (const k of ['min', 'max', 'step', 'default']) {
      const v = this.constProp<number>(b, k)
      if (v != null) o[k] = v
    }
    if (typeof o.max !== 'number') o.max = 1
    return p.load(o as Parameters<typeof p.load>[0])
  }

  private paramType(b: Block): Type {
    const options = this.prop(b, 'options')
    if (options?.value.t === 'array') {
      const first = options.value.items[0]
      return first?.t === 'str' ? 'string' : 'number'
    }
    if (b.props.has('min') || b.props.has('max')) return 'number'
    const d = this.prop(b, 'default')?.value
    return d?.t === 'bool' ? 'boolean' : d?.t === 'str' ? 'string' : d?.t === 'num' ? 'number' : 'any'
  }

  private param(b: Block) {
    const label = this.text(b.args.label) ?? b.args.id!.name
    const o: Record<string, unknown> = { label }
    for (const k of ['hint', 'tag']) {
      const v = this.constProp<string>(b, k)
      if (v != null) o[k] = v
    }
    const enabled = this.prop(b, 'enabled')
    if (enabled) o.enabled = placed(enabled.value, this.formula(enabled.value, 'values').run)
    const format = this.prop(b, 'format')
    if (format) {
      const run = placed<string>(format.value, this.formula(format.value, 'value', 'string').run)
      o.format = (v: unknown) => run(undefined, v)
    }
    const dflt = this.prop(b, 'default')
    if (!dflt) return undefined
    const value = this.constant(dflt.value, 'any')
    const options = this.prop(b, 'options')
    if (options) {
      for (const k of ['min', 'max', 'step'])
        if (b.props.has(k)) this.report.error(this.prop(b, k)!.key, `"${k}" is for a slider; this param has options`)
      const list = this.options(options)
      if (!list) return undefined
      if (!list.includes(value as never)) {
        this.report.error(
          dflt.value,
          `the default ${this.slice(dflt.value)} is not one of the options`,
          list.join(', '),
        )
        return undefined
      }
      return p.select({ ...o, options: list, default: value } as any)
    }
    if (b.props.has('min') || b.props.has('max')) {
      for (const k of ['min', 'max']) if (!b.props.has(k)) this.report.error(b.at, `a slider needs "${k}: …"`)
      const r: Record<string, unknown> = { ...o }
      for (const k of ['min', 'max', 'step']) {
        const v = this.constProp<number>(b, k)
        if (v != null) r[k] = v
      }
      if (typeof value !== 'number') this.report.error(dflt.value, 'the default of a slider is a number')
      return p.range({ ...r, default: value } as any)
    }
    if (typeof value === 'boolean') return p.switch({ ...o, default: value } as any)
    this.report.error(
      b.at,
      `"${b.args.id!.name}" is neither a select, a slider nor a switch`,
      'give it options: [...], min and max, or a default of true or false',
    )
    return undefined
  }

  private options(prop: Property): (number | string)[] | undefined {
    if (prop.value.t !== 'array' || !prop.value.items.length) {
      this.report.error(prop.value, 'options are a list: [2, 3, 4] or ["a", "b"]')
      return undefined
    }
    const list = prop.value.items.map((e) => this.constant(e, 'any'))
    const kind = typeof list[0]
    if (!list.every((v) => (typeof v === 'number' || typeof v === 'string') && typeof v === kind)) {
      this.report.error(prop.value, 'options are all numbers or all texts')
      return undefined
    }
    return list as (number | string)[]
  }

  /** A preset's values, or a scenario's: the same, but a scenario leaves the load to the slider. */
  private preset(b: Block, params: Block[], kind: 'preset' | 'scenario' = 'preset'): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const known = new Map(params.filter((x) => x.args.id).map((x) => [x.args.id!.name, x]))
    for (const [k, props] of b.props) {
      // a step's own properties; its other lines are values
      if (own(b.spec.props, k)) continue
      const prop = props[0]!
      const v = this.constant(prop.value, 'any')
      if (k === 'load' && kind === 'scenario') {
        this.report.error(prop.key, 'a scenario leaves the load to the slider', 'use a preset for a load')
        continue
      }
      if (k !== 'load' && !known.has(k)) {
        const names = [...(kind === 'preset' ? ['load'] : []), ...known.keys()]
        this.report.error(prop.key, `unknown parameter "${k}"`, didYouMean(k, names))
        continue
      }
      const type = this.names.params.get(k)
      if (type && type !== 'any' && typeof v !== type) {
        this.report.error(prop.value, `"${k}" takes ${typeWord(type)}`)
        continue
      }
      const opts = known.get(k) && this.prop(known.get(k)!, 'options')
      if (opts?.value.t === 'array') {
        const list = opts.value.items.map((e) => (e.t === 'num' || e.t === 'str' ? e.value : undefined))
        if (!list.includes(v as never))
          this.report.error(prop.value, `${String(v)} is not an option of "${k}"`, list.join(', '))
      }
      out[k] = v
    }
    return out
  }

  /** An `expect` line as the model takes it: names checked here, so a mistake points at its word. */
  private expectation(
    b: Block,
    scenarios: Record<string, unknown>,
    components: Map<string, Span>,
  ): Record<string, unknown> | undefined {
    const e: Record<string, unknown> = {}
    const label = this.text(b.args.label)
    if (label != null) e.label = label
    const scenario = this.named(b, 'scenario', Object.keys(scenarios), 'scenario')
    const component = this.named(b, 'component', [...components.keys()], 'component')
    if (scenario === null || component === null) return undefined
    if (scenario != null) e.scenario = scenario
    if (component != null) e.component = component
    for (const k of ['target', 'full']) {
      const v = this.constProp<number>(b, k)
      if (v == null) continue
      if (!(v > 0 && Number.isFinite(v))) this.report.error(this.prop(b, k)!.value, `${k} is a load multiple above 0`)
      else e[k] = v
    }
    if (!b.props.has('target') && !b.props.has('full')) {
      this.report.error(b.at, 'an expect needs a target or a full multiple', 'expect { target: 8 }')
      return undefined
    }
    return e.target != null || e.full != null ? e : undefined
  }

  /** A property naming a scenario or a component: undefined when absent, null when wrong (reported). */
  private named(b: Block, key: string, known: readonly string[], what: string): string | null | undefined {
    const p = this.prop(b, key)
    if (!p) return undefined
    const v = p.value.t === 'id' ? p.value.name : p.value.t === 'str' ? p.value.value : undefined
    if (v == null) this.report.error(p.value, `${key} is the name of a ${what}`)
    else if (!known.includes(v)) this.report.error(p.value, `unknown ${what} "${v}"`, didYouMean(v, known))
    else return v
    return null
  }

  /** A story step as the model takes it. */
  private step(
    b: Block,
    scenarios: Record<string, unknown>,
    components: Map<string, Span>,
    params: Block[],
  ): Record<string, unknown> | undefined {
    const text = this.text(b.args.label)
    const scenario = this.named(b, 'scenario', Object.keys(scenarios), 'scenario')
    const focus = this.named(b, 'focus', [...components.keys()], 'component')
    const seconds = this.constProp<number>(b, 'seconds')
    if (seconds != null && !(seconds > 0 && Number.isFinite(seconds)))
      this.report.error(this.prop(b, 'seconds')!.value, 'seconds is a duration above 0')
    const set = this.preset(b, params)
    if (text == null || scenario === null || focus === null) return undefined
    return {
      text,
      ...(scenario != null ? { scenario } : {}),
      ...(focus != null ? { focus } : {}),
      ...(seconds != null && seconds > 0 ? { seconds } : {}),
      ...(Object.keys(set).length ? { set } : {}),
    }
  }

  private growth(b: Block): { rate: number; per: string; asOf: string } | undefined {
    const rate = this.constProp<number>(b, 'rate')
    const per = this.constProp<string>(b, 'per')
    const asOf = this.constProp<string>(b, 'asOf')
    if (rate != null && !(rate > 0)) this.report.error(this.prop(b, 'rate')!.value, 'growth needs a rate above 0')
    if (asOf != null && !parseAsOf(asOf))
      this.report.error(this.prop(b, 'asOf')!.value, `"${asOf}" is not a date`, 'a day like "2026-11-01"')
    if (rate == null || per == null || asOf == null) return undefined
    return { rate, per, asOf }
  }

  private fit(b: Block) {
    const id = b.args.id
    if (!id) return
    this.fits.set(id.name, null)
    const pts = b.children.filter((c) => c.keyword === 'points')
    if (pts.length !== 1) {
      this.report.error(b.at, pts.length ? 'a fit has one points block' : 'a fit needs its points', usage('points'))
      return
    }
    const block = pts[0]!
    const { x, y } = block.args
    if (!x || !y) return
    if (x.name === y.name) this.report.error(y, 'x and y need different names')
    const points: Record<string, number>[] = []
    for (const r of block.rows) {
      if (r.values.length !== 2) {
        this.report.error(r, `a row is two numbers: ${x.name} and ${y.name}`)
        continue
      }
      const [a, c] = r.values.map((v) => this.constant(v, 'number')) as [number, number]
      points.push({ [x.name]: a, [y.name]: c })
    }
    const source = this.constProp<string>(b, 'source')
    const through = this.constProp<'origin'>(b, 'through')
    try {
      const o: Parameters<typeof fitLinear>[1] = { x: x.name, y: y.name }
      if (source != null) o.source = source
      if (through) o.through = through
      this.fits.set(id.name, fitLinear(points, o))
    } catch (err) {
      this.report.error(block.at, (err as Error).message.replace(/^loadmap: /, ''))
    }
  }

  private overload(b: Block): Overload | ((ctx: any) => Overload) | undefined {
    const rules = b.children.filter((c) => c.keyword === 'drop' || c.keyword === 'merge')
    if (!rules.length) return undefined
    const seen = new Set<string>()
    const parts: { key: 'drop' | 'merge'; when?: (c: any) => unknown; fields: [string, unknown][] }[] = []
    for (const r of rules) {
      const key = r.keyword as 'drop' | 'merge'
      if (seen.has(key)) this.report.error(r.at, `"${key}" is set twice in this flow`)
      seen.add(key)
      const fields: [string, unknown][] = []
      const first = key === 'drop' ? 'olderThan' : 'share'
      for (const k of [first, 'reason']) {
        const v = this.dynProp(r, k, k === 'reason' ? 'string' : 'number')
        if (v !== undefined) fields.push([k, v])
      }
      const when = this.prop(r, 'when')
      parts.push({ key, fields, when: when && placed(when.value, this.formula(when.value, 'ctx').run) })
    }
    const fixed = parts.every((x) => !x.when && x.fields.every(([, v]) => typeof v !== 'function'))
    const at = (ctx: any): Overload => {
      const o: Overload = {}
      for (const x of parts) {
        if (x.when && !x.when(ctx)) continue
        const rule: Record<string, unknown> = {}
        for (const [k, v] of x.fields) rule[k] = typeof v === 'function' ? v(ctx) : v
        ;(o as Record<string, unknown>)[x.key] = rule
      }
      return o
    }
    return fixed ? at(undefined) : at
  }

  private component(b: Block, box?: Block) {
    const o: Record<string, unknown> = {}
    const name = this.constProp<string>(b, 'name') ?? this.text(b.args.label) ?? this.text(box?.args.label)
    if (name == null) {
      const label = box?.args.label ?? b.args.label
      if (label) this.report.error(label, 'a computed label cannot name the component', 'add name: "…"')
    }
    o.name = name ?? (b.args.id ?? box?.args.id)?.name
    for (const k of ['short', 'plural']) {
      const v = this.constProp(b, k)
      if (v != null) o[k] = v
    }
    for (const [k, want] of [
      ['demand', 'number'],
      ['capacity', 'capacity'],
      ['when', 'any'],
      ['over', 'string'],
      ['describe', 'string'],
    ] as const) {
      const prop = this.prop(b, k)
      if (!prop) continue
      const check =
        k === 'capacity'
          ? (v: unknown) => {
              if (!isCapacity(v)) throw new Error('a capacity comes from measured(…) or estimated(…)')
            }
          : undefined
      o[k] = this.dyn(prop.value, want, 'ctx', check)
    }
    const at = box ? (box.args.id ?? box.at) : b.at
    for (const k of ['demand', 'capacity', 'over'])
      if (!(k in o)) this.report.error(at, `the component needs "${k}: …"`, COMPONENT_PROPS[k]!.doc)
    return o
  }

  private stage(
    b: Block,
    box: Box,
    components: Map<string, Span>,
    resolve: (n: Ident, what: string) => string | undefined,
    flows: Map<string, Span>,
    reached: Set<string>,
  ): StageDef | undefined {
    const label = this.text(b.args.label)
    const base = label != null ? { label } : {}
    let component = box.component?.id
    const named = this.prop(b, 'component')
    if (named) {
      const n = named.value
      if (n.t === 'id' && components.has(n.name)) component = n.name
      else this.report.error(n, `unknown component "${this.slice(n)}"`, didYouMean(this.slice(n), components.keys()))
    }
    const needs = () => {
      this.report.error(
        b.at,
        `a ${b.keyword} stage needs a component`,
        'give the box demand and capacity lines, or name one: component: db',
      )
      return undefined
    }
    switch (b.keyword) {
      case 'pass':
        return component ? pass(component, base) : needs()
      case 'store':
        return component ? store(component, base) : needs()
      case 'sink':
        return sink(base)
      case 'workers': {
        if (!component) return needs()
        const pods = this.dynProp<number>(b, 'pods', 'number', this.count('pods'))
        const perPod = this.dynProp<number>(b, 'perPod', 'number', this.count('perPod'))
        const fill = this.constProp<'round-robin' | 'in-order'>(b, 'fill')
        return workers(component, { ...base, pods: pods ?? 0, perPod: perPod ?? 0, ...(fill ? { fill } : {}) })
      }
      case 'queue': {
        const block = b.children.find((c) => c.keyword === 'partitions')
        if (!block) {
          this.report.error(b.at, 'a queue needs its partitions', 'partitions { orders: 12 }')
          return undefined
        }
        const entries: [string, number | ((c: any) => number)][] = []
        for (const [f, props] of block.props) {
          const prop = props[0]!
          if (!flows.has(f)) {
            this.report.error(prop.key, `unknown flow "${f}"`, didYouMean(f, flows.keys()))
            continue
          }
          entries.push([f, this.dyn<number>(prop.value, 'number', 'ctx', this.count('partitions'))])
        }
        const fixed = entries.every(([, v]) => typeof v === 'number')
        const at = (ctx: any): Record<string, number> =>
          Object.fromEntries(entries.map(([k, v]) => [k, typeof v === 'function' ? v(ctx) : v]))
        const partitions = fixed ? at(undefined) : at
        return queue({ ...base, partitions, ...(component ? { component } : {}) })
      }
      case 'fanout': {
        const branches: [string, string, number | ((c: any) => number)][] = []
        for (const e of b.edges) {
          if (e.chain.length !== 2) {
            this.report.error(e, 'a branch is one "flow -> stage: copies" line')
            continue
          }
          const [f, s] = e.chain as [Ident, Ident]
          if (!flows.has(f.name)) this.report.error(f, `unknown flow "${f.name}"`, didYouMean(f.name, flows.keys()))
          const stage = resolve(s, 'stage')
          if (stage) reached.add(stage)
          if (!e.value) this.report.error(e, 'how many copies per unit?', `${f.name} -> ${s.name}: 1`)
          if (e.body) this.report.error(e.bodySpan ?? e, 'a branch has no block')
          if (stage && e.value && flows.has(f.name)) branches.push([f.name, stage, this.dyn<number>(e.value, 'number')])
        }
        const build = (ctx: any) => {
          const to: Record<string, Branch[]> = {}
          for (const [f, stage, share] of branches) {
            const list = to[f] ?? []
            list.push({ stage, share: typeof share === 'function' ? share(ctx) : share })
            to[f] = list
          }
          return to
        }
        const fixed = branches.every(([, , v]) => typeof v === 'number')
        return fanout({ ...base, to: fixed ? build(undefined) : build, ...(component ? { component } : {}) })
      }
    }
    return undefined
  }

  // -- view ----------------------------------------------------------------------------------------------------

  private node(box: Box): AnyNodeDef {
    const b = box.block
    const label = this.label(b.args.label) ?? box.id
    const subProp = this.prop(b, 'sub')
    if (subProp && b.args.sub) this.report.error(subProp.key, 'the sub-line is set twice: on the first line and here')
    const sub = this.label(b.args.sub ?? subProp?.value)
    const o: Record<string, unknown> = { label }
    if (sub != null) o.sub = sub
    const indexLabel = (key: string) => {
      const prop = this.prop(b, key)
      if (!prop) return undefined
      const run = placed<string>(prop.value, this.formula(prop.value, 'i', 'string').run)
      return (i: number) => run(undefined, i)
    }
    const stageIds = box.stages.map((s) => s.id)
    if (b.keyword === 'cluster') {
      o.stage = stageIds.length === 1 ? stageIds[0] : stageIds
      const members = this.prop(b, 'members')
      o.members = members ? this.dyn<number>(members.value, 'number', 'ctx', this.count('members')) : 1
      const memberLabel = indexLabel('memberLabel')
      if (memberLabel) o.memberLabel = memberLabel
      return { kind: 'cluster', ...o } as AnyNodeDef
    }
    if (b.keyword === 'pool') {
      o.stage = stageIds[0]
      const podLabel = indexLabel('podLabel')
      if (podLabel) o.podLabel = podLabel
      return { kind: 'pool', ...o } as AnyNodeDef
    }
    if (stageIds.length) o.stage = stageIds[0]
    else if (box.component) o.component = box.component.id
    const shape = this.constProp<'box' | 'cylinder'>(b, 'shape')
    return { kind: 'node', shape: shape ?? 'box', ...o } as AnyNodeDef
  }

  private edges(e: Edge, boxes: Map<string, Box>): EdgeDef[] {
    for (const n of e.chain)
      if (!boxes.has(n.name)) this.report.error(n, `unknown node "${n.name}"`, didYouMean(n.name, boxes.keys()))
    const props = new Map<string, Property>()
    for (const s of e.body ?? []) {
      if (s.kind !== 'prop' || !own(EDGE_PROPS, s.key.name)) {
        const at = s.kind === 'prop' ? s.key : s.kind === 'decl' ? s.keyword : s
        this.report.error(at, 'an edge holds only label and when', didYouMean(this.slice(at), Object.keys(EDGE_PROPS)))
        continue
      }
      if (props.has(s.key.name)) this.report.error(s.key, `"${s.key.name}" is set twice on this edge`)
      props.set(s.key.name, s)
    }
    const labelExpr = e.value ?? props.get('label')?.value
    if (e.value && props.has('label')) this.report.error(props.get('label')!.key, 'the label is set twice')
    if (labelExpr && e.chain.length > 2) this.report.error(labelExpr, 'a label goes on a single edge: a -> b: "…"')
    const label = this.label(labelExpr)
    const when = props.get('when')
    const out: EdgeDef[] = []
    for (let i = 0; i + 1 < e.chain.length; i++) {
      const d: EdgeDef = { from: e.chain[i]!.name, to: e.chain[i + 1]!.name }
      if (label != null) d.label = label
      if (when) d.when = placed(when.value, this.formula(when.value, 'ctx').run)
      out.push(d)
    }
    return out
  }
}

const FORBIDDEN = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]+\))$/i

function usage(keyword: string): string | undefined {
  const ex = own(SCHEMA, keyword)?.example
  return ex ? `e.g. ${ex.split('\n')[0]}` : undefined
}

function where(keyword: string): string | undefined {
  const parents = Object.entries(SCHEMA)
    .filter(([, s]) => s.children.includes(keyword))
    .map(([k]) => (k === '' ? 'the top level' : k))
  return parents.length ? `it goes in ${parents.join(' or ')}` : undefined
}
