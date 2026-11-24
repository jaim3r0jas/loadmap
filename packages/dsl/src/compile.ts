import {
  type Branch,
  type Catalog,
  type CheckResult,
  cache,
  check,
  defineModel,
  type Evaluation,
  type Fit,
  fanout,
  type Loss,
  limit,
  lost,
  type Model,
  type Overload,
  type PublishedConfig,
  p,
  parseAsOf,
  pass,
  published,
  queue,
  type RetryRule,
  type ScalingFit,
  type SnapshotReader,
  type SplitBranch,
  type StageDef,
  type Stat,
  sink,
  split,
  store,
  workers,
} from '@loadmap/core'
import { fitLinear } from '@loadmap/core/calibrate'
import { duration, fmt } from '@loadmap/core/format'
import { flowOf, lossesIn, propOf, waysOf } from '@loadmap/core/internal'
import { bestSize, fitScaling } from '@loadmap/core/scaling'
import {
  type AnyNodeDef,
  type Direction,
  defineView,
  type EdgeDef,
  type FlowView,
  labelsAt,
  type SubsystemDef,
  type TierDef,
  type View,
} from '@loadmap/layout'
import { defineViewUnjoined, type Hop, hopsOf, unjoined } from '@loadmap/layout/internal'
import {
  childrenOf,
  type Decl,
  type Document,
  type Edge,
  type Expr,
  formulasOf,
  type Ident,
  type Property,
  type Row,
  type Stmt,
} from './ast'
import { catalogComponent, catalogRules, latestEdition, loadedCatalog } from './catalog'
import { type Code, closest, type Diagnostic, didYouMean, Reporter, type Span } from './diagnostics'
import {
  BUILTIN_SINCE,
  compileFormula,
  type Formula,
  FormulaError,
  failure,
  type HostFunctions,
  isCapacity,
  type Names,
  notCondition,
  placed,
  RESERVED,
  type Type,
  typeWord,
} from './expr'
import {
  Bail,
  DEFAULT_PATH,
  type Files,
  fileText,
  Loader,
  normalizePath,
  type Role,
  relativePath,
  type SourceFile,
} from './files'
import { expandAlone, type Linked, link, stamp } from './link'
import { parse } from './parser'
import { modText } from './rewrite'
import {
  type BlockSpec,
  BOXES,
  COLORS,
  COMPONENT_PROPS,
  DIRECTIONS,
  EDGE_PROPS,
  type FULL_SCREEN_MODES,
  matchArgs,
  ONE_SPELLING,
  own,
  type PANELS,
  POOL_LINES,
  type PropSpec,
  propNamed,
  SCHEMA,
  type Scope,
  STAGES,
} from './schema'
import {
  capacityCall,
  describe,
  disagree,
  PROPERTY_UNITS,
  parseUnit,
  sizePower,
  sizeScale,
  type UnitNames,
  unitOf,
  wrongMark,
} from './units'
import { before, CURRENT, LANGUAGE_VERSION, parseVersion, type Version, versionText } from './versions'
import { VIEW_KEYS } from './viewblock'

export { LANGUAGE_VERSION }

/**
 * The version from which formulas are typed strictly (true or false for a condition, numbers for `<`, like types for
 * `==`, no chained comparison) and a rate, demand or capacity below 0 is refused: a warning before it.
 */
const STRICT_FORMULAS: Version = [1, 1]
/** A `%` where a load multiple goes, a `×` where a share goes: refused from 1.2. */
const STRICT_SUFFIXES: Version = [1, 2]
/** The version from which the view settings live in `view { … }`. */
const VIEW_BLOCK: Version = [1, 2]
/** `30%+1`, the remainder where a share was likely meant: refused from 1.2. */
const STRICT_PERCENT: Version = [1, 2]
/** One spelling each: an old name, a view setting at the top, `%` as the remainder and what has `until` in the schema. */
const ONE: Version = parseVersion(ONE_SPELLING)!

/** The longest move to a new structure a definition may ask for, in seconds. */
const MAX_TRANSITION = 5
/** The most rows a definition may fold its diagram into. */
const MAX_ROWS = 6

/** `{{ args.job }}` in a metric's query: the measure's argument `job`. */
const TEMPLATE = /\{\{\s*args\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** A metric's query with a measure's arguments filled in. */
type Fill = (args: ReadonlyMap<string, string>) => string

/** The arguments a metric's query names, in order, once each. */
export function templateArgs(query: string): string[] {
  return [...new Set([...query.matchAll(TEMPLATE)].map((m) => m[1]!))]
}

/** Counts that size the drawing; larger ones would hang the layout, so a shared link cannot ask for them. */
export const LIMITS = { members: 64, pods: 256, perPod: 256, partitions: 1024 } as const

export interface CompileOptions {
  /** Functions formulas may call beyond the built-in ones: the escape hatch for what formulas cannot say. */
  functions?: HostFunctions
  /** The component catalog's editions, for `published` statements; by default the one `loadCatalog()` loaded. */
  catalog?: Readonly<Record<string, Catalog>>
  /**
   * Measured data for the `measure` statements: `fromSnapshot(parseSnapshot(text))` from `@loadmap/core/measure`.
   * Without one, every measure is its fallback.
   */
  snapshot?: SnapshotReader
  /**
   * This text's own path from the project root (`models/checkout.loadmap`): what the paths in its head start from.
   * Default `input.loadmap`.
   */
  path?: string
  /**
   * The other files the definition may name, by their path from the project root: its parts and libraries, and for a
   * part or a variant its model. The compiler reads nothing itself; without them a definition is one file.
   */
  files?: Files
}

/** A `measure` as `loadmap pull` reads it: the query with its arguments filled in. */
export interface MeasureQuery {
  /** The measure's id: the measurement's name in the snapshot. */
  id: string
  metric: string
  /** The metric's label. */
  label?: string
  provider: 'prometheus' | 'elasticsearch'
  /** PromQL for Prometheus; for Elasticsearch, the request as JSON: index, time field, agg, field and query. */
  query: string
  stat?: Stat
  /** The samples the window needs before its value counts. */
  minSamples?: number
  /** The fallback's unit, or the measure's own for a number. */
  unit: string
}

/** What the definition sets beyond the model and the view: props of `<Loadmap>`. */
export interface DefinitionOptions {
  speed?: number
  transition?: number
  /** `auto`, or none: the way that fits the room larger. */
  direction?: Direction | 'auto'
  /** The rows a long diagram is folded into; none: chosen for the room. */
  rows?: number
  assumptions: string[]
  fullScreen?: (typeof PANELS)[number][]
  fullScreenMode?: (typeof FULL_SCREEN_MODES)[number]
  /** The editor's dot grid; only the editor reads it. */
  grid?: boolean
  /** The subsystems the page draws closed at first. */
  closed?: string[]
}

/** The tab each of the language's panel names is in: the verdict's sentence with the limits, the comparison with the headroom. */
const TABS = {
  verdict: 'limits',
  live: 'live',
  limits: 'limits',
  controls: 'controls',
  headroom: 'headroom',
  compare: 'headroom',
  assumptions: 'assumptions',
} as const
const TAB_ORDER = ['limits', 'controls', 'headroom', 'live', 'assumptions'] as const

/**
 * The page options as `<Loadmap>` props, leaving out the unset ones so it keeps its defaults. `fullScreen` names the
 * panels a page offers (`panels`), in a page and in full screen alike; `fullScreenMode` what stands around the diagram
 * in full screen (`chrome`: `focus` is the least).
 */
export function pageOptions(o: DefinitionOptions) {
  return {
    ...(o.speed != null ? { speed: o.speed } : {}),
    ...(o.transition != null ? { transition: o.transition } : {}),
    ...(o.direction ? { direction: o.direction } : {}),
    ...(o.rows != null ? { rows: o.rows } : {}),
    ...(o.assumptions.length ? { assumptions: o.assumptions } : {}),
    ...(o.fullScreen ? { panels: TAB_ORDER.filter((t) => o.fullScreen?.some((p) => TABS[p] === t)) } : {}),
    // the Headroom tab holds the chart and the scenarios compared: a list that names one of the two leaves the other out
    ...(o.fullScreen?.includes('compare') && !o.fullScreen.includes('headroom') ? { headroom: false } : {}),
    ...(o.fullScreen?.includes('headroom') && !o.fullScreen.includes('compare') ? { compare: false } : {}),
    ...(o.fullScreenMode ? { chrome: o.fullScreenMode === 'focus' ? ('least' as const) : ('all' as const) } : {}),
    ...(o.closed ? { closed: o.closed } : {}),
  }
}

export interface Definition {
  model: Model
  view: View
  options: DefinitionOptions
}

/** A name the definition declares, where: for autocomplete, and for finding a node's source. */
export interface DslSymbol {
  kind:
    | 'param'
    | 'let'
    | 'fit'
    | 'published'
    | 'measure'
    | 'metric'
    | 'flow'
    | 'node'
    | 'stage'
    | 'component'
    | 'scenario'
    | 'tier'
    | 'domain'
    | 'connection'
  id: string
  /** The id where it is written (or the keyword, for an id taken from its box). */
  span: Span
  /** The whole statement. */
  decl: Span
  /** For a stage, its box; for a node, its kind. */
  detail?: string
  /** The file it is declared in, from the project root, when that is not the text that was compiled. */
  file?: string
}

/** An `expect` line: where it is and whether it holds. */
export interface ExpectationResult {
  /** The keyword and the label. */
  at: Span
  line: number
  column: number
  result: CheckResult
  /** The file it is written in, when that is not the text that was compiled: a part. */
  file?: string
}

export interface CompileResult {
  ok: boolean
  diagnostics: Diagnostic[]
  /** Only when there are no errors. */
  definition?: Definition
  /** Each `expect` line, tested on the pessimistic edge; empty when the definition has errors. */
  expectations: ExpectationResult[]
  /** Every `measure`, with its query filled in: what `loadmap pull` reads. Empty when the definition has errors. */
  measures: MeasureQuery[]
  symbols: DslSymbol[]
  /** The text that was compiled, parsed: its own statements, whatever its files add. */
  doc: Document
  /** What the text is: a model, a part of one, a library, or a variant of a model. */
  role: Role
  /** Every file the definition read, by its path from the project root: the model first. */
  files: string[]
}

/** What says nothing about a library checked on its own: nothing routes through it, nothing is drawn around it. */
const ALONE_QUIET = new Set<Code>(['unused-stage', 'unused-component', 'tier-order', 'unseen-loss'])

/** For each result, the one list of statements its files came to, and the text their places are in. */
const LINKED = new WeakMap<CompileResult, { body: readonly Stmt[]; source: string }>()

/** A place in a file of the definition; no `file` for the text that was compiled. */
export type Where = Span & { file?: string }

/** What a compile wrote out, by where it is written: each subsystem of the diagram, and each `like:` it followed. */
export interface Copies {
  subsystems: readonly { id: string; decl: Where }[]
  likes: readonly { site: Where; to: Where }[]
}
const COPIES = new WeakMap<CompileResult, Copies>()

/** The subsystems and the `like`s of a compile: how a box of a copy came to be. */
export function copiesOf(r: CompileResult): Copies {
  return COPIES.get(r) ?? { subsystems: [], likes: [] }
}

/** The statements a compile read, its files joined and written out: what `flatten()` prints. */
export function linkedOf(r: CompileResult): { body: readonly Stmt[]; source: string } | undefined {
  return LINKED.get(r)
}

/** What is read before anything is checked: the text parsed, the files it names, and all of them as one model. */
export interface Front {
  /** Holds every file the definition read, one after the other: a place in it says its file. */
  report: Reporter
  loader?: Loader
  /** The text that was asked about, parsed. */
  doc: Document
  role: Role
  linked?: Linked
}

/**
 * Parses a text, reads the files it names and links them into one list of statements (link.ts). A part and a variant
 * are read through their model. Fills `f` as far as it gets; what stops it is reported, and thrown as a Bail.
 */
export function front(source: string, o: CompileOptions, f: Front): void {
  const path = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const hosted = new Set(Object.keys(o.functions ?? {}))
  f.report.first = f.report.given = path
  f.doc = parse(source, f.report).doc
  f.loader = new Loader(f.report, o.files, { path, text: source })
  let entry = f.loader.first(path, f.doc)
  const role = entry.role
  f.role = role
  let variant: SourceFile | undefined
  if (role === 'part' || role === 'variant') {
    // read through its model: the names it uses are declared there
    const owner = entry.head.find((h) => h.kind === (role === 'part' ? 'part' : 'extends'))
    if (owner?.path == null) throw new Bail()
    const text = fileText(o.files, owner.path)
    if (text == null) {
      const why = o.files ? 'it is not among the files of this definition' : 'this file came alone'
      f.report.error('missing-file', owner.at, `there is no "${owner.path}": ${why}`)
      throw new Bail()
    }
    const report = new Reporter(text)
    report.first = owner.path
    report.given = path
    f.report = report
    f.loader = new Loader(report, o.files, { path, text: source })
    const model = f.loader.first(owner.path, parse(text, report).doc)
    const mine = f.loader.load(path, { from: 0, to: 0 })!
    const back = mine.head.find((h) => h.kind === owner.kind)!
    if (model.role !== 'model') {
      report.error('bad-file', back.at, `"${owner.path}" is a ${model.role}, not a model`)
      throw new Bail()
    }
    if (role === 'variant') variant = mine
    else if (!model.head.some((h) => h.kind === 'include' && h.path === path)) {
      const line = `include "${relativePath(owner.path, path)}"`
      report.error('bad-file', back.at, `"${owner.path}" does not include this file`, `${line} in its head`, {
        file: owner.path,
        line,
      })
      throw new Bail()
    }
    entry = model
  }
  f.linked = link(f.loader, entry, hosted, variant)
}

/** Reads a definition: parses, checks, and builds the model and view `<Loadmap>` takes. Never throws. */
export function compile(source: string, o: CompileOptions = {}): CompileResult {
  const path = normalizePath(o.path ?? DEFAULT_PATH) ?? DEFAULT_PATH
  const f: Front = { report: new Reporter(source), doc: { body: [] }, role: 'model' }
  let c: Compiler | undefined
  let definition: Definition | undefined
  let expectations: ExpectationResult[] = []
  try {
    front(source, o, f)
    const { report, linked } = f
    if (!linked) throw new Bail()
    c = new Compiler(report, o.functions ?? {}, o.catalog ?? loadedCatalog(), o.snapshot, linked)
    definition = c.run(linked.body)
    if (definition)
      expectations = check(definition.model).map((found, i) => {
        const { file, ...at } = report.local(c!.expectSpans[i]!)
        const where = report.position(c!.expectSpans[i]!.from)
        return { at, ...where, result: grounded(definition!.model, found), ...(file != null && { file }) }
      })
  } catch (err) {
    const report = f.report
    const run = c ?? new Compiler(report, {})
    // a formula that fails only at a capacity bound, while checking: it has its place
    if (err instanceof FormulaError || flowOf(err) || (err instanceof Error && err.message.startsWith('loadmap: ')))
      run.runError(err, { from: 0, to: 0 })
    // a bug must not take the editor down with it: say so where the user looks
    else if (!(err instanceof Bail))
      report.error('internal', { from: 0, to: 0 }, `internal error: ${(err as Error)?.message ?? err}`)
  }
  const { report, linked, loader, doc, role } = f
  const stand = linked?.stand
  const kept = linked?.preview
    ? report.list.filter(
        (d) =>
          !ALONE_QUIET.has(d.code) &&
          // a line a prototype leaves to the box that is like it
          !(d.code === 'missing-property' && stand && d.from === stand.from && d.to === stand.to),
      )
    : report.list
  const diagnostics = [...kept].sort((a, b) => a.from - b.from).map((d) => report.local(d))
  const ok = !kept.some((d) => d.severity === 'error') && !!definition
  const symbols = (c?.symbols ?? []).map((s) => {
    const { file, ...span } = report.local(s.span)
    const { file: _, ...decl } = report.local(s.decl)
    return { ...s, span, decl, ...(file != null && { file }) }
  })
  const files = loader?.list.map((f) => f.path) ?? [path]
  const result: CompileResult = {
    ok,
    diagnostics,
    definition,
    expectations,
    measures: ok && c ? c.measures : [],
    symbols,
    doc,
    role,
    files,
  }
  if (linked) {
    LINKED.set(result, { body: linked.body, source: report.source })
    const placed = (s: Span): Where => {
      const { file, from, to } = report.local(s)
      return { from, to, ...(file != null && { file }) }
    }
    COPIES.set(result, {
      subsystems: (c?.subsystems ?? []).map((s) => ({ id: s.id, decl: placed(s.decl) })),
      likes: linked.likes.map((l) => ({ site: placed(l.site), to: placed(l.to) })),
    })
  }
  return result
}

/**
 * The names a definition declares, without checking or building anything else: cheap enough for every keystroke, where
 * a full compile is not. Never throws. Of this text only: what its other files declare takes a compile.
 */
export function declarations(source: string, doc: Document): DslSymbol[] {
  const report = new Reporter(source)
  const c = new Compiler(report, {})
  try {
    const loader = new Loader(report, undefined, { path: DEFAULT_PATH, text: source })
    const file = loader.first(DEFAULT_PATH, doc)
    stamp(loader, file, new Set())
    c.version = file.version ?? CURRENT
    c.run([file.stamp!, ...expandAlone(loader, file.body)], true)
  } catch {
    // a bail leaves the names found so far
  }
  return c.symbols
}

/**
 * The diagnostics and every expectation that does not pass, in source order: an editor marks a failure as a warning
 * (the diagram still shows), `loadmap check` as an error. An inconclusive one says why; an expect with `severity:
 * warn` is a warning either way.
 */
export function problems(
  r: CompileResult,
  failed: Diagnostic['severity'] = 'warning',
  inconclusive: Diagnostic['severity'] = 'warning',
): Diagnostic[] {
  const out = [...r.diagnostics]
  for (const e of r.expectations) {
    const { outcome, expectation, reasons, message } = e.result
    if (outcome === 'pass') continue
    const label = expectation.label ? `"${expectation.label}" ` : ''
    const text =
      outcome === 'fail'
        ? `${label ? `${label}fails: ` : ''}${message}`
        : `${label ? `${label}is inconclusive` : 'inconclusive'}: ${reasons.join('; ')}${reasons.length ? '; ' : ''}${message}`
    // a warning-level expect is never more than a warning
    const severity = expectation.severity === 'warn' ? 'warning' : outcome === 'fail' ? failed : inconclusive
    const code = outcome === 'fail' ? 'expect-failed' : 'expect-inconclusive'
    out.push({
      severity,
      code,
      message: text,
      ...e.at,
      line: e.line,
      column: e.column,
      ...(e.file != null && { file: e.file }),
    })
  }
  // each file's own, in order: the text that was compiled first
  const files = [...new Set(out.map((d) => d.file))]
  return out.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.from - b.from)
}

/** A capacity and nothing else: what `capacity` and a connection's `max` take. */
function checkCapacity(v: unknown): void {
  if (!isCapacity(v)) throw new Error('a capacity comes from measured(…), estimated(…) or configured(…)')
}

/**
 * An expectation's result, made inconclusive where it rests on a demand that is no number (a division by zero at these
 * values): the crossing found for that component is not one, so "holds up to 0×" is no answer. A failure stays one
 * where a component with a real demand fails by itself. Here and not in core's check, which every page loads first.
 */
function grounded(model: Definition['model'], r: CheckResult): CheckResult {
  const e = r.expectation
  if (e.flow != null || e.lost != null || (e.underTarget == null && e.notFull == null)) return r
  const scenario = e.scenario == null ? undefined : model.scenarios.find((s) => s.label === e.scenario)
  const values = e.down == null ? scenario?.values : { ...scenario?.values, down: e.down }
  const all = Object.values(model.evaluate(values as never).components)
  const scope = e.component == null ? all : all.filter((x) => x.id === e.component)
  const adrift = scope.filter((x) => x.demand != null && !Number.isFinite(x.demand))
  if (!adrift.length) return r
  const where = scenario ? ` in ${scenario.label}` : ''
  const reasons = adrift.map((x) => `the demand of ${x.short} is ${x.demand}${where}, not a number to rank by`)
  const short = (x: { high: number } | null, min: number | undefined) => min != null && x != null && x.high < min
  const alone = scope.some(
    (x) => !adrift.includes(x) && (short(x.targetRange, e.underTarget) || short(x.fullRange, e.notFull)),
  )
  if (r.outcome === 'fail' && alone) return r
  return { ...r, ok: false, outcome: 'inconclusive', reasons: [...r.reasons, ...reasons] }
}

/** Stops compiling after an error that leaves nothing sensible to check. */
interface Args {
  id?: Ident
  label?: Expr
  sub?: Expr
  version?: Expr
  x?: Ident
  y?: Ident
  component?: Ident
  metric?: Ident
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
  /** Properties written as a statement (`rate = 40`): an error of their own, and not missing. */
  said: Set<string>
  /** A pool read as its workers stage: its lines are the pool's own (from loadmap 1.5). */
  pool?: true
}

interface Box {
  block: Block
  id: string
  stages: { block: Block; id: string }[]
  /** The component it owns: its own lines, or a nested `component`. */
  component?: { block: Block; id: string; own: boolean }
}

export class Compiler {
  readonly symbols: DslSymbol[] = []
  /** Where each expectation of the model is written, in order. */
  readonly expectSpans: Span[] = []
  names!: Names
  /** Each scenario's id and the label it stands for. */
  private scenarioIds = new Map<string, string>()
  /** The failure domains declared, by id: what across and down name. */
  private domainIds = new Map<string, Span>()
  /** Each fan-out and the copies a second it sends: what `out.<stage>` reads. */
  private sent = new Map<string, { run: (ctx: any) => number }>()
  /** What the units of a formula's names come from: each let's formula, each fit's y, each parameter's default. */
  private unitNames: UnitNames = { let: () => undefined, fit: () => undefined }
  readonly measures: MeasureQuery[] = []
  private fits = new Map<string, Fit | null>()
  private lets = new Map<string, Type>()
  private measureIds = new Set<string>()
  /** The subsystems that hold a box: what `closed` may name. */
  private subsystemIds = new Set<string>()
  /** Each subsystem of the diagram and the statement that writes it: one statement writes one in every copy. */
  readonly subsystems: { id: string; decl: Span }[] = []
  /** The measures whose fallback is a number. */
  private numbers = new Set<string>()
  /** The language version the model says it is written in; a library's lines are read under its own. */
  version: Version

  constructor(
    readonly report: Reporter,
    readonly functions: HostFunctions,
    readonly catalog?: Readonly<Record<string, Catalog>>,
    readonly snapshot?: SnapshotReader,
    private readonly linked?: Linked,
  ) {
    this.version = linked?.version ?? CURRENT
  }

  /** Every file of the model, one after the other: a span is a place in it. */
  get source() {
    return this.report.source
  }

  /**
   * An input set with a formula against its default: one type (a number for a number), and where both say a unit, the
   * same one. The value is the model's formula, so this waits for the model's names; the default is the library's,
   * read for what it is without them.
   */
  private inputs() {
    const quiet = new Reporter(this.source)
    for (const c of this.linked?.checks ?? []) {
      const [want, got] = [c.default, c.value].map((e) => compileFormula(e, this.names, 'ctx', quiet).type)
      // said once: where a line that reads the input already refused the value's type, that is the mistake's message
      const told = this.report.list.some((d) => d.code === 'wrong-type' && d.from === c.value.from)
      if (want && got && want !== 'any' && got !== 'any' && want !== got) {
        if (told) continue
        this.report.error(
          'wrong-type',
          c.value,
          `"${c.input}" takes ${typeWord(want)}, as its default is; this is ${typeWord(got)}`,
        )
        continue
      }
      const [du, vu] = [unitOf(c.default, this.unitNames), unitOf(c.value, this.unitNames)]
      if (du && vu && disagree(vu, du))
        this.report.warning(
          'unit-mismatch',
          c.value,
          `"${c.input}" is ${describe(du)}, as its default ${this.slice(c.default)} is; this is ${describe(vu)}`,
        )
    }
  }

  /** The version of the file a place is in. */
  private versionOf(at: Span): Version {
    return this.linked?.versionAt(at.from) ?? this.version
  }

  /**
   * `body` is the model as one list of statements: its files joined, every `like` and subsystem written out, each
   * `loadmap` line checked (link.ts). With `namesOnly`, stops once every name is declared: `symbols` is then complete,
   * and nothing is built.
   */
  run(body: readonly Stmt[], namesOnly = false): Definition | undefined {
    this.gluedPercents(body)
    this.spellings(body)
    const root = this.shape('', SCHEMA['']!, body, { from: 0, to: 0 })

    // names first: formulas and routes may refer to anything declared further down
    const byKind = (k: string) => root.children.filter((b) => b.keyword === k)
    const loads = byKind('load')
    if (!loads.length)
      this.report.error('missing-part', { from: 0, to: 0 }, 'a definition needs a load line', 'load { max: 100 }')
    for (const extra of loads.slice(1)) this.report.error('duplicate', extra.at, 'only one load line is allowed')
    const params = byKind('param')
    const lets = byKind('let')
    const fits = byKind('fit')
    const publisheds = byKind('published')
    const metrics = byKind('metric')
    const measures = byKind('measure')
    const flows = byKind('flow')
    const boxes = root.children
      .filter((b) => (BOXES as readonly string[]).includes(b.keyword) && b.args.id)
      .map((b) => this.box(b))
    const loose = byKind('component')
    for (const b of byKind('subsystem'))
      if (b.args.id) {
        this.subsystemIds.add(b.args.id.name)
        this.subsystems.push({ id: b.args.id.name, decl: b.decl ?? b.at })
      }

    const formulaNames = new Map<string, Span>()
    const own = (kind: DslSymbol['kind'], b: Block, taken: Map<string, Span>) => {
      const id = b.args.id
      if (!id) return
      this.declare(kind, id.name, id, b, taken)
    }
    for (const b of [...params, ...lets, ...fits, ...publisheds, ...measures]) {
      own(b.keyword as 'param' | 'let' | 'fit' | 'published' | 'measure', b, formulaNames)
      const since =
        b.args.id && Object.hasOwn(BUILTIN_SINCE, b.args.id.name) ? BUILTIN_SINCE[b.args.id.name] : undefined
      // a function a version added: a file from before may have the name, and reads its own where it says it
      if (b.args.id && since)
        this.strict(
          parseVersion(since)!,
          'reserved-name',
          b.args.id,
          `"${b.args.id.name}" is a reserved name; pick another`,
        )
      else if (b.args.id && RESERVED.has(b.args.id.name))
        this.report.error('reserved-name', b.args.id, `"${b.args.id.name}" is a reserved name; pick another`)
    }
    for (const b of measures) if (b.args.id) this.measureIds.add(b.args.id.name)
    const metricNames = new Map<string, Span>()
    for (const b of metrics) own('metric', b, metricNames)
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
      if (!b.args.id)
        this.report.error('missing-part', b.at, 'a component outside a box needs an id: component cache "Cache"')
      else own('component', b, componentNames)
    }

    const paramTypes = new Map<string, Type>([['load', 'number']])
    for (const b of params) if (b.args.id) paramTypes.set(b.args.id.name, this.paramType(b))
    // a select's options as written: a formula compares a literal with them (one computed leaves it unchecked)
    const paramOptions = new Map<string, (number | string)[]>()
    for (const b of params) {
      const list = optionLiterals(b)
      if (b.args.id && list?.every((v) => v !== undefined))
        paramOptions.set(b.args.id.name, list as (number | string)[])
    }
    for (const f of fits) this.fit(f)
    // a published figure is read like a let: a capacity in `derived`
    for (const b of publisheds) if (b.args.id) this.lets.set(b.args.id.name, 'capacity')
    // a connection that gives accepts is a limit: expect, focus and formulas read its id as a component's
    const limits = new Map(componentNames)
    for (const b of byKind('connection'))
      if (b.args.id && b.props.has('accepts') && !componentNames.has(b.args.id.name))
        limits.set(b.args.id.name, b.args.id)
    this.names = {
      params: paramTypes,
      options: paramOptions,
      lets: this.lets,
      flows: new Set(flowNames.keys()),
      stages: new Set(stageNames.keys()),
      components: new Set(limits.keys()),
      fits: this.fits,
      functions: this.functions,
      out: this.sent,
    }
    for (const box of boxes)
      for (const s of box.stages)
        if (s.block.keyword === 'fanout')
          this.sent.set(s.id, {
            run: () => {
              throw new Error(`"${s.id}" has no branches to send by`)
            },
          })
    const inits = new Map(
      lets.flatMap((b) => (b.args.id && b.decl?.init ? [[b.args.id.name, b.decl.init] as const] : [])),
    )
    const ys = new Map(
      fits.flatMap((b) => {
        const y = b.children.find((c) => c.keyword === 'points')?.args.y
        return b.args.id && y ? [[b.args.id.name, y.name] as const] : []
      }),
    )
    const defaults = new Map(
      params.flatMap((b) => {
        const options = this.prop(b, 'options')?.value
        const v = this.prop(b, 'default')?.value ?? (options?.t === 'array' ? options.items[0] : undefined)
        return b.args.id && v ? [[b.args.id.name, v] as const] : []
      }),
    )
    this.unitNames = { let: (n) => inits.get(n), fit: (n) => ys.get(n), param: (n) => defaults.get(n) }
    const scenarioLabels = byKind('scenario').map((b) => {
      const label = this.text(b.args.label)
      if (label != null) this.symbols.push({ kind: 'scenario', id: label, span: b.args.label!, decl: b.decl ?? b.at })
      return label
    })
    // a scenario's id is the language's own name for it: the model, and every page, knows it by its label
    for (const [i, b] of byKind('scenario').entries()) {
      const [id, label] = [b.args.id, scenarioLabels[i]]
      if (!id || label == null) continue
      const other = scenarioLabels.findIndex((l, k) => k !== i && l === id.name)
      if (this.scenarioIds.has(id.name))
        this.report.error('duplicate', id, `scenario "${id.name}" is declared twice`, 'rename one of them')
      else if (other >= 0)
        this.report.error(
          'duplicate',
          id,
          `"${id.name}" is also the label of another scenario: a step naming it could mean either`,
          'give the id another name',
        )
      else {
        this.scenarioIds.set(id.name, label)
        this.symbols.push({ kind: 'scenario', id: id.name, span: id, decl: b.decl ?? b.at })
      }
    }
    const tierNames = new Map<string, Span>()
    for (const b of byKind('tier')) if (b.args.id) this.declare('tier', b.args.id.name, b.args.id, b, tierNames)
    for (const b of byKind('domain'))
      if (b.args.id) this.declare('domain', b.args.id.name, b.args.id, b, this.domainIds)
    if (!namesOnly) this.shadowed(boxes, loose)
    if (namesOnly) return undefined
    // a measure is read like a let, of its fallback's type: a capacity or a number
    const metricOf = new Map(metrics.flatMap((b) => (b.args.id ? [[b.args.id.name, b] as const] : [])))
    // checked whether or not a measure uses it yet
    for (const b of metrics) this.metricQuery(b)
    const measured = new Map<string, unknown>()
    for (const b of measures) {
      const v = this.measure(b, metricOf)
      if (v === undefined || !b.args.id) continue
      measured.set(b.args.id.name, v)
      this.lets.set(b.args.id.name, typeof v === 'number' ? 'number' : 'capacity')
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
    const peaks: Record<string, number> = {}
    for (const b of byKind('preset')) {
      const label = this.text(b.args.label)
      if (label == null) continue
      const set = this.preset(b, params)
      presets[label] = set
      const lasts = params.some((x) => x.args.id?.name === 'lasts') ? undefined : this.constProp<number>(b, 'lasts')
      if (lasts != null) {
        if (lasts > 0 && Number.isFinite(lasts)) peaks[label] = lasts
        else this.report.error('out-of-range', this.prop(b, 'lasts')!.value, 'a peak lasts a time above 0')
      }
      const l = this.prop(b, 'load')
      if (l && load && typeof set.load === 'number' && !(set.load >= load.min && set.load <= load.max))
        this.strict(STRICT_FORMULAS, 'out-of-range', l.value, `the load goes from ${load.min} to ${load.max}`)
    }
    const scenarios: Record<string, Record<string, unknown>> = {}
    for (const [i, b] of byKind('scenario').entries()) {
      const label = scenarioLabels[i]
      if (label == null) continue
      if (Object.hasOwn(scenarios, label))
        this.report.error('duplicate', b.args.label!, `scenario "${label}" is declared twice`)
      else scenarios[label] = this.preset(b, params, 'scenario')
    }
    const expects: Record<string, unknown>[] = []
    this.hasGrowth = byKind('growth').length > 0
    for (const b of byKind('expect')) {
      const e = this.expectation(b, scenarios, limits, flowNames)
      if (!e) continue
      expects.push(e)
      this.expectSpans.push({ from: b.at.from, to: b.args.label?.to ?? b.at.to })
    }
    const story: Record<string, unknown>[] = []
    for (const b of byKind('step')) {
      const st = this.step(b, scenarios, limits, params, load)
      if (st) story.push(st)
    }
    const growths = byKind('growth')
    for (const extra of growths.slice(1)) this.report.error('duplicate', extra.at, 'only one growth line is allowed')
    const growth = growths[0] && this.growth(growths[0])
    const derived: Record<string, unknown> = {}
    for (const b of lets)
      if (b.args.id && b.decl?.init) derived[b.args.id.name] = placed(b.decl.init, this.formula(b.decl.init, 'ctx').run)
    for (const b of publisheds) {
      const run = this.published(b)
      if (run && b.args.id) derived[b.args.id.name] = run
    }
    // the same for every load and every value: today's system, or the definition's fallback
    for (const [id, v] of measured) derived[id] = () => v

    const resolveStage = (n: Ident, what: string): string | undefined => {
      if (stageOf.has(n.name)) return n.name
      const box = boxById.get(n.name)
      if (box?.stages.length === 1) return box.stages[0]!.id
      if (box)
        this.report.error(
          'bad-route',
          n,
          box.stages.length
            ? `"${n.name}" holds ${box.stages.length} stages; name one: ${box.stages.map((s) => s.id).join(', ')}`
            : `the box "${n.name}" runs no stage`,
        )
      else
        this.report.error(
          'unknown-name',
          n,
          `unknown ${what} "${n.name}"`,
          didYouMean(n.name, [...stageOf.keys(), ...boxById.keys()]),
        )
      return undefined
    }

    const flowDefs: Record<string, unknown> = {}
    const flowViews: Record<string, FlowView> = {}
    const routes: Record<string, string[]> = {}
    const reached = new Set<string>()
    for (const b of flows) {
      const id = b.args.id
      if (!id) continue
      this.flowAt.set(id.name, id)
      this.flowBlock.set(id.name, b)
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
      const retry = this.retry(b)
      if (retry) def.retry = retry
      const brs = b.children.filter((c) => c.keyword === 'breaker')
      for (const extra of brs.slice(1))
        this.report.error('duplicate', extra.at, `"breaker" is set twice in this flow`, 'one breaker per flow')
      const br = brs[0]
      if (br) {
        const opens = this.dynProp<number>(br, 'opens', 'number', (v) => {
          if (typeof v !== 'number' || !(v > 0 && v < 1))
            throw new Error(`a breaker opens past a share above 0 and below 100%, not ${String(v)}`)
        })
        if (opens !== undefined)
          def.breaker =
            typeof opens === 'number' ? { opens } : (v: unknown) => ({ opens: (opens as (v: unknown) => number)(v) })
      }
      const timeout = this.dynProp<number>(b, 'timeout', 'number', (v) => {
        if (typeof v !== 'number' || !(v > 0)) throw new Error(`a timeout is seconds above 0, not ${String(v)}`)
      })
      if (timeout !== undefined) def.timeout = timeout
      const average = this.dynProp<number>(b, 'average', 'number', (v) => {
        if (typeof v !== 'number' || !(v > 0 && v <= 1))
          throw new Error(`an average is a share of the peak above 0, up to 100%, not ${String(v)}`)
      })
      if (average !== undefined) def.average = average
      flowDefs[id.name] = def

      const route = this.prop(b, 'route')
      const stages: string[] = []
      const chain: [Ident, string][] = []
      this.routeAt.set(id.name, chain)
      for (const [i, n] of (route?.chain ?? (route?.value.t === 'id' ? [route.value as Ident] : [])).entries()) {
        const s = resolveStage(n, 'stage')
        if (!s) continue
        chain.push([n, s])
        if (stageOf.get(s)!.block.keyword === 'fanout' && i < (route?.chain?.length ?? 1) - 1)
          this.report.error('bad-route', n, `the fan-out "${s}" must be the last stage of the route`)
        stages.push(s)
        reached.add(s)
      }
      if (route && route.value.t !== 'id')
        this.report.error('bad-route', route.value, 'a route is a list of stages: a -> b -> c')
      routes[id.name] = stages
      const fbs = b.children.filter((c) => c.keyword === 'fallback')
      for (const extra of fbs.slice(1))
        this.report.error('duplicate', extra.at, `"fallback" is set twice in this flow`, 'one fallback per flow')
      const fb = fbs[0]
      if (fb) {
        this.fallbackAt.set(id.name, fb.at)
        const names = (p: Property | undefined) => p?.chain ?? (p?.value.t === 'id' ? [p.value as Ident] : [])
        const after = names(this.prop(fb, 'after'))
        const way = names(this.prop(fb, 'route')).flatMap((n) => resolveStage(n, 'stage') ?? [])
        const at = after.length === 1 ? resolveStage(after[0]!, 'stage') : undefined
        if (after.length > 1)
          this.report.error('bad-route', this.prop(fb, 'after')!.value, 'a fallback leaves the route at one stage')
        for (const s of way) reached.add(s)
        if (at && way.length) def.fallback = { after: at, route: way }
        else if (this.prop(fb, 'after') && this.prop(fb, 'route'))
          this.report.error('bad-route', fb.at, 'a fallback names a stage of its route, then the stages that serve it')
      }

      const from = this.prop(b, 'from')
      const view: FlowView = { from: '', color: 'accent' }
      if (from) {
        this.fromAt.set(id.name, from.value)
        if (from.value.t === 'id' && boxById.has(from.value.name)) view.from = from.value.name
        else
          this.report.error(
            'unknown-name',
            from.value,
            `unknown node "${this.slice(from.value)}"`,
            didYouMean(this.slice(from.value), boxById.keys()),
          )
      }
      const color = this.prop(b, 'color')
      if (color) view.color = this.color(color.value) ?? 'accent'
      if (label != null) view.label = label
      flowViews[id.name] = view
    }

    const componentDefs: Record<string, Record<string, unknown>> = {}
    const componentBlocks = this.componentBlocks
    for (const box of boxes) {
      const stray = box.component?.own
        ? undefined
        : box.block.children.find((c) => c.keyword === 'held' || c.keyword === 'runs')
      if (stray)
        this.report.error(
          'misplaced',
          stray.at,
          `${stray.keyword} belongs to a component`,
          box.component ? `move it into component ${box.component.id}` : 'give the box capacity and over lines',
        )
      if (box.component) {
        componentDefs[box.component.id] = this.component(box.component.block, flowNames, box.block)
        componentBlocks.set(box.component.id, box.component.block)
      }
    }
    for (const b of loose)
      if (b.args.id) {
        componentDefs[b.args.id.name] = this.component(b, flowNames)
        componentBlocks.set(b.args.id.name, b)
      }
    // the stages whose units hold a component's slots, once every stage is known
    for (const [id, b] of componentBlocks) {
      const on = this.prop(b, 'on')
      if (!on) continue
      if (on.value.t !== 'id') this.report.error('bad-box', on.value, 'on is a list of stages: a -> b')
      const stages = (on.chain ?? (on.value.t === 'id' ? [on.value as Ident] : [])).map((n) => resolveStage(n, 'stage'))
      if (stages.every((s) => s)) componentDefs[id]!.on = stages
      if (!this.prop(b, 'held') && !this.prop(b, 'through') && !b.children.some((c) => c.keyword === 'held'))
        this.report.error(
          'missing-property',
          on.key,
          'on names the stages that hold its slots: give it held too',
          'held: 0.02',
          { key: 'held' },
        )
    }

    const stageDefs: Record<string, StageDef> = {}
    for (const box of boxes)
      for (const s of box.stages) {
        const def = this.stage(s.block, box, componentNames, resolveStage, flowNames, reached, s.id)
        if (def) stageDefs[s.id] = def
      }
    // the stretch of the way a slot is held through: two stages, from the one that holds it
    for (const [id, b] of componentBlocks) {
      const through = this.prop(b, 'through')
      if (!through) continue
      const chain = through.chain ?? (through.value.t === 'id' ? [through.value as Ident] : [])
      if (chain.length !== 2) {
        this.report.error('bad-box', through.value, 'through is a stretch of the way: from -> to', 'through: api -> db')
        continue
      }
      const stages = chain.map((n) => resolveStage(n, 'stage'))
      if (!stages.every((s) => s)) continue
      componentDefs[id]!.through = stages
      // its slots are held on the stretch's first stage: said there, or the one stage that runs it
      const on =
        (componentDefs[id]!.on as string[] | undefined) ??
        Object.keys(stageDefs).filter((s) => (stageDefs[s] as { component?: string }).component === id)
      if (on.length !== 1 || on[0] !== stages[0])
        this.report.error(
          'bad-box',
          through.value,
          `a slot held through ${stages[0]} -> ${stages[1]} is held on "${stages[0]}"`,
          `on: ${stages[0]}`,
        )
    }
    for (const [id, s] of stageOf)
      if (!reached.has(id) && s.block.keyword !== 'fanout' && s.block.keyword !== 'lost')
        this.report.warning('unused-stage', s.block.args.id ?? s.block.at, `no flow passes the stage "${id}"`)
    const shape = { stages: stageDefs, routes, flows: flowDefs as never, components: componentDefs }
    // what each stage can lose, worked out once, over ways walked once: the lost boxes and the warnings both read it
    const known = new Map<string, readonly Loss[]>()
    const walked = lossesIn(shape)
    const losses = (stage: string) => {
      if (!known.has(stage)) known.set(stage, walked(stage))
      return known.get(stage)!
    }
    const counted = this.lostFed(boxes, boxById, root.edges, stageDefs, losses)
    this.unseenLosses(flows, stageOf, counted, shape, losses, componentDefs)
    const used = new Set(Object.values(stageDefs).map((d) => (d as { component?: string }).component))
    for (const [id, c] of Object.entries(componentDefs)) {
      const fills = c.fills != null ? this.prop(componentBlocks.get(id)!, 'fills') : undefined
      // a stock fills over time: a stage that ran it would turn units away at a level, not at a rate
      if (fills && used.has(id))
        this.report.error(
          'bad-box',
          fills.key,
          `"${id}" fills over time, so no stage runs it`,
          'write the stock as a component of its own: component disk "Disk" { fills: … }',
        )
      const fails = this.prop(componentBlocks.get(id)!, 'fails')
      if (fails && !used.has(id))
        this.report.error(
          'unused-component',
          fails.key,
          `"${id}" fails a share of the units a stage works on, and no stage runs it`,
        )
      if (this.prop(componentBlocks.get(id)!, 'on') || used.has(id) || this.plainBoxes.has(id) || fills) continue
      if (c.held != null || c.through != null)
        this.report.error(
          'unused-component',
          componentNames.get(id)!,
          `the component "${id}" is held on no stage`,
          'on: stage',
        )
      else if (c.demand == null)
        this.report.error(
          'unused-component',
          componentNames.get(id)!,
          `the component "${id}" needs "demand: …": no stage uses it`,
          COMPONENT_PROPS.demand!.doc,
        )
    }
    this.units(root, componentBlocks, used)
    this.pastPeak(root)
    this.inputs()

    const connections: Record<string, Record<string, unknown>> = {}
    const connectionNames = new Map<string, Span>()
    const clusterMembers = new Map<string, unknown>()
    for (const b of byKind('connection')) {
      const id = b.args.id
      if (!id) continue
      const errors = this.report.list.length
      this.declare('connection', id.name, id, b, connectionNames)
      if (componentNames.has(id.name))
        this.report.error('duplicate', id, `"${id.name}" names a component too: give the connection its own name`)
      // a name refused above (taken, or one every object has) builds nothing
      if (this.report.list.length > errors) continue
      // a key or a leader on a cluster's queue: the cluster's members unless it names its own, compiled once a cluster
      const membersOf = (stage: string) => {
        const box = stageOf.get(stage)?.box
        if (box?.block.keyword !== 'cluster') return undefined
        if (!clusterMembers.has(box.id))
          clusterMembers.set(box.id, this.dynProp<number>(box.block, 'members', 'number'))
        return clusterMembers.get(box.id)
      }
      const def = this.connection(b, resolveStage, flowNames, membersOf)
      if (!def) continue
      this.connectionAt.set(id.name, id)
      connections[id.name] = def
    }

    const calibration: Record<string, Fit> = {}
    for (const f of fits) {
      const fit = f.args.id && this.fits.get(f.args.id.name)
      if (fit) calibration[this.text(f.args.label) ?? f.args.id!.name] = fit
    }

    // a failure domain and the boxes across it: the members of a pool are its pods (its autoscaler's max), of a
    // cluster its members, and a node runs one in each part
    const domains: Record<string, { name: string; count: number }> = {}
    for (const b of byKind('domain')) {
      if (!b.args.id) continue
      const count = this.constProp<number>(b, 'count')
      if (count == null) continue
      if (!(Number.isInteger(count) && count >= 2))
        this.report.error(
          'out-of-range',
          this.prop(b, 'count')!.value,
          'a domain has a whole number of parts from 2 up',
        )
      else domains[b.args.id.name] = { name: this.text(b.args.label) ?? b.args.id.name, count }
    }
    if (Object.keys(domains).length && params.some((x) => x.args.id?.name === 'down'))
      this.report.error(
        'duplicate',
        params.find((x) => x.args.id?.name === 'down')!.args.id!,
        '"down" is the Outage control the domains give the model',
        'give the parameter another name',
      )
    for (const box of boxes) {
      const domain = this.named(box.block, 'across', [...this.domainIds.keys()], 'domain')
      if (!domain || !Object.hasOwn(domains, domain)) continue
      if (!box.component) {
        this.report.error(
          'bad-box',
          this.prop(box.block, 'across')!.key,
          'across is for a box with a component: its members carry its capacity',
        )
        continue
      }
      // a box whose stage is a pool counts its pods, whatever its keyword
      const pool = box.stages
        .map((x) => stageDefs[x.id] as { kind?: string; pods?: unknown; autoscale?: { max: unknown } } | undefined)
        .find((x) => x?.kind === 'workers')
      const members = pool
        ? pool.autoscale
          ? pool.autoscale.max
          : pool.pods
        : box.block.keyword === 'cluster'
          ? this.dynProp<number>(box.block, 'members', 'number')
          : domains[domain]!.count
      if (members == null) {
        this.report.error(
          'bad-box',
          this.prop(box.block, 'across')!.key,
          'across needs the members of the box: its pods',
        )
        continue
      }
      ;(componentDefs[box.component.id] as Record<string, unknown>).across = { domain, members }
    }

    this.apart(componentDefs, byKind('subsystem'))
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
    if (Object.keys(peaks).length) model.peaks = peaks
    if (Object.keys(scenarios).length) model.scenarios = scenarios
    if (growth) model.growth = growth
    if (Object.keys(domains).length) model.domains = domains
    if (expects.length) model.expect = expects
    if (story.length) model.story = story
    if (Object.keys(derived).length) model.derived = derived
    if (Object.keys(calibration).length) model.calibration = calibration
    if (Object.keys(connections).length) model.connections = connections
    const snap = this.snapshot?.snapshot
    if (snap) {
      // a number read nowhere else shows that it fell back: listed missing, with why, like a capacity's line does
      // only what this definition measures: a measure taken out leaves nothing behind in its checks
      const kept = Object.entries(snap.measurements).filter(([k]) => this.measureIds.has(k))
      const absent = this.measures.filter((m) => this.numbers.has(m.id) && !Object.hasOwn(snap.measurements, m.id))
      model.snapshot = {
        ...snap,
        measurements: Object.fromEntries([
          ...kept,
          ...absent.map((m) => [m.id, { unit: m.unit, missing: this.snapshot!.unread(m.id)! }] as const),
        ]),
      }
    }
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
    const tiers: Record<string, TierDef> = {}
    for (const b of byKind('tier')) {
      if (!b.args.id) continue
      const tier: TierDef = { label: this.text(b.args.label) ?? b.args.id.name }
      for (const k of ['fill', 'fillDark'] as const) {
        const p = this.prop(b, k)
        const c = p && this.color(p.value, false)
        if (c) tier[k] = c
      }
      tiers[b.args.id.name] = tier
    }
    const nodes: Record<string, AnyNodeDef> = {}
    for (const box of boxes) {
      nodes[box.id] = this.node(box)
      const tier = this.named(box.block, 'tier', [...tierNames.keys()], 'tier')
      if (tier) nodes[box.id]!.tier = tier
    }
    // what is left of a subsystem written out is its first line: the frame around the boxes named `<id>.…`
    const subsystems: Record<string, SubsystemDef> = {}
    for (const b of byKind('subsystem'))
      if (b.args.id) subsystems[b.args.id.name] = { label: this.text(b.args.label) ?? b.args.id.name }
    const edges: EdgeDef[] = []
    for (const e of root.edges) edges.push(...this.edges(e, boxById))
    // a delay is the model's: of the hop between two stages, or into a stage for the flows that start at the box
    const delays: Record<string, unknown>[] = []
    for (const { from, to, delay, at } of this.delays) {
      if (!Object.hasOwn(stageDefs, to)) {
        this.report.error('bad-edge', at, `a delay is the time into a stage, and "${to}" does nothing with a flow`)
        continue
      }
      const starting = Object.keys(flowViews).filter((f) => flowViews[f]!.from === from && routes[f]?.[0] === to)
      const hop = (f: string) =>
        waysOf(shape, f).ways.some((w) => w.some((s, i) => s === to && w[i - 1] === from)) || waysOf(shape, f).open
      // an edge can be both: a hop of one flow's route, and where another flow starts
      const between = Object.hasOwn(stageDefs, from) && Object.keys(routes).some(hop)
      if (between) delays.push({ from, to, delay })
      if (starting.length) delays.push({ to, delay, flows: starting })
      if (!between && !starting.length)
        this.report.warning(
          'unused-delay',
          at,
          `no flow goes from "${from}" straight to "${to}": the delay counts for none`,
          'a delay goes on a hop of a route, or on the edge from a flow\'s "from" box to its first stage',
        )
    }
    if (delays.length) model.delays = delays
    // the flow runs through the tiers in their order: an edge back is drawn against it
    const tierOf = (id: string) => {
      const t = nodes[id]?.tier
      return t == null ? undefined : Object.keys(tiers).indexOf(t)
    }
    for (const e of root.edges)
      e.chain.forEach((to, i) => {
        const from = e.chain[i - 1]
        const [a, b] = from ? [tierOf(from.name), tierOf(to.name)] : []
        if (from && a != null && b != null && a > b)
          this.report.warning(
            'tier-order',
            to,
            `${from.name} -> ${to.name} runs back from the tier "${nodes[from.name]!.tier}" to "${nodes[to.name]!.tier}"`,
          )
      })
    if (!flows.length) this.report.error('missing-part', { from: 0, to: 0 }, 'a definition needs at least one flow')

    const options: DefinitionOptions = { assumptions: [] }
    // how the page looks and plays: in view { … } from 1.2, at the top before it
    const views = byKind('view')
    for (const extra of views.slice(1)) this.report.error('duplicate', extra.at, 'only one view block is allowed')
    // the direction's old name, `layout: right`: it has its own message, below
    const topLayout = this.prop(root, 'layout')
    const oldWay = topLayout && (DIRECTIONS as readonly string[]).includes(this.word(topLayout) ?? '')
    for (const k of VIEW_KEYS) {
      const top = this.prop(root, k)
      if (!top || (k === 'layout' && oldWay)) continue
      const spec = SCHEMA['']!.props[k]!
      if (views[0]?.props.has(k))
        this.report.error('duplicate', top.key, `"${k}" is set here and in view`, 'remove one of them')
      // gone from the view too (grid): the message that says so is the one to act on
      else if (spec.until) continue
      else if (!before(this.versionOf(top.key), parseVersion(spec.movedIn ?? versionText(VIEW_BLOCK))!))
        this.strict(ONE, 'deprecated', top.key, `${k} is now in view { … }`, 'loadmap fmt moves it', { view: k })
    }
    const look = (k: string) => (views[0]?.props.has(k) ? views[0] : root)
    const speed = this.constProp<number>(look('speed'), 'speed')
    if (speed != null) options.speed = speed
    const transition = this.constProp<number>(look('transition'), 'transition')
    // a shared link could ask for a move that never ends
    if (transition != null && (transition < 0 || transition > MAX_TRANSITION))
      this.report.error(
        'out-of-range',
        this.prop(look('transition'), 'transition')!.value,
        `transition is ${transition} seconds; 0 to ${MAX_TRANSITION}`,
      )
    else if (transition != null) options.transition = transition
    const direction = this.prop(look('direction'), 'direction')
    const runs = direction && this.enumValue(direction, SCHEMA['']!.props.direction!)
    if (runs) options.direction = runs === 'auto' ? 'auto' : runs === 'down' ? 'DOWN' : 'RIGHT'
    const rows = this.constProp<number>(look('rows'), 'rows')
    const written = this.prop(look('rows'), 'rows')?.value
    // a count: not a share or a multiple that happens to come out whole (200%)
    const unit = written?.t === 'num' && written.unit
    if (rows != null && (unit || !(Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS)))
      this.report.error(
        'out-of-range',
        written!,
        unit
          ? `rows takes no unit; a whole number, 1 to ${MAX_ROWS}`
          : `rows is ${rows}; a whole number, 1 to ${MAX_ROWS}`,
      )
    else if (rows != null) options.rows = rows
    const layout = oldWay ? topLayout : this.prop(look('layout'), 'layout')
    const way = layout && this.word(layout)
    let arrange: 'compact' | 'stable' | undefined
    // the direction's old name: a definition written before keeps its direction, and `loadmap fmt` renames it
    if (layout && oldWay) {
      const moved = !before(this.versionOf(layout.key), ONE)
      if (direction)
        this.strict(
          ONE,
          'deprecated',
          layout.key,
          `layout: ${way} is ignored: direction sets the direction`,
          'remove it',
          {
            remove: 'layout',
          },
        )
      else {
        this.strict(
          ONE,
          'deprecated',
          layout.key,
          moved ? `layout: ${way} is now direction: ${way} in view { … }` : `layout: ${way} is now direction: ${way}`,
          'loadmap fmt rewrites it',
          moved ? { view: 'layout' } : { to: 'direction' },
        )
        options.direction = way === 'down' ? 'DOWN' : 'RIGHT'
      }
      // the view's own layout: line still says how the boxes are laid out
      const own = views[0] && this.prop(views[0], 'layout')
      if (own) arrange = this.enumValue(own, SCHEMA['']!.props.layout!) as typeof arrange
    } else if (layout) arrange = this.enumValue(layout, SCHEMA['']!.props.layout!) as typeof arrange
    const panels = this.prop(look('fullScreen'), 'fullScreen')
    if (panels)
      options.fullScreen = this.words(panels, SCHEMA['']!.props.fullScreen!) as DefinitionOptions['fullScreen']
    const mode = this.prop(look('fullScreenMode'), 'fullScreenMode')
    if (mode)
      options.fullScreenMode = this.enumValue(
        mode,
        SCHEMA['']!.props.fullScreenMode!,
      ) as DefinitionOptions['fullScreenMode']
    const grid = this.constProp<boolean>(look('grid'), 'grid')
    if (grid != null) options.grid = grid
    const closed = views[0] && this.closed(views[0])
    if (closed) options.closed = closed
    const lanes = this.constProp<'filled' | 'striped'>(look('lanes'), 'lanes')
    for (const a of root.props.get('assume') ?? []) {
      const v = this.constant(a.value, 'string')
      if (typeof v === 'string') options.assumptions.push(v)
    }

    if (this.report.failed) return undefined
    const view = {
      nodes,
      edges,
      flows: flowViews,
      ...(Object.keys(tiers).length ? { tiers } : {}),
      ...(Object.keys(subsystems).length ? { subsystems } : {}),
      ...(arrange ? { layout: arrange } : {}),
      ...(lanes ? { lanes } : {}),
    }
    return this.build(model, view, options, byKind('preset'), byKind('scenario'))
  }

  /** Hands the parts to core and layout, then runs the model once per preset and scenario so formula errors show now. */
  private build(
    modelDef: Record<string, unknown>,
    viewDef: {
      nodes: Record<string, AnyNodeDef>
      edges: EdgeDef[]
      flows: Record<string, FlowView>
      tiers?: Record<string, TierDef>
      subsystems?: Record<string, SubsystemDef>
      layout?: 'compact' | 'stable'
      lanes?: 'filled' | 'striped'
    },
    options: DefinitionOptions,
    presets: Block[],
    scenarios: Block[],
  ): Definition | undefined {
    const top = { from: 0, to: 0 }
    let model: Model
    let view: View
    try {
      model = defineModel(modelDef as any)
      // with a hop unjoined the definition fails, but the presets and scenarios still run, to report their errors now;
      // a definition stamped before hops needed edges draws as it did, its dots straight across
      const hops = this.hopsJoined(model, viewDef)
      view =
        hops === 'joined'
          ? defineView(model, viewDef as any)
          : hops === 'warned'
            ? defineViewUnjoined(model, viewDef as any)
            : { model, def: viewDef as any }
    } catch (err) {
      this.runError(err, top)
      return undefined
    }
    const runs: { values: Record<string, unknown>; at: Span; where: string }[] = [
      { values: {}, at: top, where: 'at the defaults' },
    ]
    for (const b of presets) {
      const label = this.text(b.args.label)
      const v = label != null && (modelDef.presets as Record<string, Record<string, unknown>> | undefined)?.[label]
      if (v) runs.push({ values: v, at: b.at, where: `in the preset "${label}"` })
    }
    for (const b of scenarios) {
      const label = this.text(b.args.label)
      const v = label != null && model.scenarios.find((s) => s.label === label)?.values
      if (v) runs.push({ values: v, at: b.at, where: `in the scenario "${label}"` })
    }
    for (const [i, { values, at, where }] of runs.entries()) {
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
        const hidden = viewDef.edges.filter((e) => e.when && !e.when(ev.ctx))
        if (hidden.length) this.hiddenHops(model, viewDef, hidden, values, where)
        let ratesFine = true
        for (const f of model.flowIds) {
          const rate = ev.flows[f] as number
          if (!(rate >= 0 && Number.isFinite(rate))) ratesFine = false
          const rateAt = this.flowRate.get(f) ?? at
          const message = `the rate of "${f}" is ${rate} ${where}`
          if (!Number.isFinite(rate)) this.report.warning('bad-rate', rateAt, message)
          else if (rate < 0)
            this.strict(STRICT_FORMULAS, 'bad-rate', rateAt, message, 'a rate is units per second, from 0 up')
        }
        this.ranges(ev, ratesFine, where)
      } catch (err) {
        this.runError(err, at, i === 0)
      }
    }
    if (this.report.failed) return undefined
    return { model, view, options }
  }

  /**
   * A component's demand and capacity where the definition was evaluated (`where`: at the defaults, in a preset or a
   * scenario): a demand that is not finite says so, as a rate does (a verdict "holds up to 0×" would hide it), and
   * one below 0 or a capacity of 0 or less is refused. With a rate already wrong, the demands it feeds are not blamed.
   */
  private ranges(ev: Evaluation, ratesFine: boolean, where: string) {
    for (const [id, b] of this.componentBlocks) {
      const c = ev.components[id]
      if (!c) continue
      const demand = c.demand
      if (ratesFine && demand != null && !(demand >= 0 && Number.isFinite(demand))) {
        const at = this.prop(b, 'demand')?.value ?? b.at
        const message = `the demand of "${id}" is ${demand} ${where}`
        if (!Number.isFinite(demand)) this.report.warning('bad-demand', at, message)
        else this.strict(STRICT_FORMULAS, 'bad-demand', at, message, 'a demand is from 0 up')
      }
      const capacity = this.prop(b, 'capacity')
      // NaN is no figure (a published run that does not match, measured data missing), which says so itself
      if (capacity && c.capacity && c.capacity.value <= 0)
        this.strict(
          STRICT_FORMULAS,
          'out-of-range',
          capacity.value,
          `the capacity of "${id}" is ${c.capacity.value} ${where}`,
          'a capacity is above 0',
        )
    }
  }

  /**
   * Each lost box takes what the boxes with an edge into it lose, of what it takes: their stages that lose so. Nothing
   * feeding it, a box that loses nothing it takes, a loss two lost boxes take and an edge out of it are errors at their line.
   */
  private lostFed(
    boxes: readonly Box[],
    boxById: Map<string, Box>,
    edges: readonly Edge[],
    stageDefs: Record<string, StageDef>,
    losses: (stage: string) => readonly Loss[],
  ): Map<string, string> {
    const taken = new Map<string, string>()
    for (const box of boxes)
      for (const s of box.stages) {
        const def = stageDefs[s.id]
        if (def?.kind !== 'lost') continue
        const takes = def.takes ?? (SCHEMA.lost!.props.takes!.values as readonly Loss[])
        const from: string[] = []
        let fed = false
        for (const e of edges)
          e.chain.forEach((n, i) => {
            const next = e.chain[i + 1]
            if (n.name === box.id && next)
              this.report.error('bad-lost', next, `nothing leaves the lost box "${s.id}": what reaches it is lost`)
            if (next?.name !== box.id) return
            fed = true
            const src = boxById.get(n.name)
            if (!src) return
            const losing = src.stages.map((x) => x.id).filter((x) => losses(x).some((r) => takes.includes(r)))
            if (!losing.length) {
              this.report.error(
                'bad-lost',
                n,
                `"${n.name}" loses nothing the lost box "${s.id}" takes`,
                'a pass, limit, cache or split turns units away, a queue with a drop rule drops them, the last stage of a flow with a timeout times them out',
              )
              return
            }
            for (const x of losing)
              for (const r of losses(x).filter((r) => takes.includes(r))) {
                const other = taken.get(`${x}\u0000${r}`)
                if (other && other !== s.id)
                  this.report.error('bad-lost', n, `what "${x}" loses as ${r} already goes to the lost box "${other}"`)
                taken.set(`${x}\u0000${r}`, s.id)
              }
            from.push(...losing)
          })
        if (!fed)
          this.report.error(
            'bad-lost',
            s.block.args.id ?? s.block.at,
            `nothing feeds the lost box "${s.id}"`,
            `draw an edge into ${box.id} from the box whose losses it takes`,
          )
        ;(def as { from: readonly string[] }).from = [...new Set(from)]
      }
    return taken
  }

  /**
   * A warning at each loss the definition plans that no lost box counts: a limiter's rejections, a flow's drops (at each
   * queue it can drop in) and its timeouts (at each end of its ways). A pass, cache or split past capacity loses too,
   * but every one of them could: the bars and the `over` line already say so.
   */
  private unseenLosses(
    flows: readonly Block[],
    stageOf: Map<string, { block: Block; box: Box }>,
    counted: Map<string, string>,
    shape: Parameters<typeof lossesIn>[0],
    losses: (stage: string) => readonly Loss[],
    components: Record<string, unknown>,
  ) {
    const seen = (stage: string, loss: Loss) => counted.has(`${stage}\u0000${loss}`)
    // one warning for a stage and a loss, however many flows lose there: one lost box counts them all
    const warned = new Set<string>()
    const first = (stage: string, loss: Loss) => {
      const key = `${stage}\u0000${loss}`
      if (warned.has(key) || seen(stage, loss)) return false
      warned.add(key)
      return true
    }
    for (const [id, s] of stageOf)
      if (s.block.keyword === 'limit' && losses(id).includes('rejected') && first(id, 'rejected'))
        this.report.warning(
          'unseen-loss',
          s.block.at,
          `what "${id}" turns away vanishes: give it a lost box that counts it`,
          undefined,
          { stage: id, reason: 'rejected' },
        )
    // what a component that fails loses at each stage it runs, unless every flow through it has a fallback: that
    // serves what fails past where it falls back after
    const unserved = new Set(
      flows.flatMap((b) => {
        const f = b.args.id?.name
        if (!f || (shape.flows[f] as { fallback?: unknown } | undefined)?.fallback) return []
        const { ways, open } = waysOf(shape, f)
        return open ? Object.keys(shape.stages) : ways.flat()
      }),
    )
    for (const [id, s] of stageOf)
      if (unserved.has(id) && losses(id).includes('failed') && first(id, 'failed'))
        this.report.warning(
          'unseen-loss',
          s.block.at,
          `what "${id}" fails vanishes: give it a lost box that counts it`,
          undefined,
          { stage: id, reason: 'failed' },
        )
    for (const b of flows) {
      const f = b.args.id?.name
      if (!f) continue
      const { ways, open } = waysOf(shape, f)
      // this flow's drops: at a queue on its ways that a stage with a component reads after it
      const drop = b.children.find((c) => c.keyword === 'drop')
      const read = (w: readonly string[], i: number) => {
        const next = shape.stages[w[i + 1] ?? '']
        return next != null && 'component' in next && next.component != null
      }
      const queue =
        drop &&
        ways
          .flatMap((w) => w.filter((s, i) => shape.stages[s]?.kind === 'queue' && read(w, i)))
          .find((s) => first(s, 'dropped'))
      if (drop && queue)
        this.report.warning(
          'unseen-loss',
          drop.at,
          `units of "${f}" dropped as too old at "${queue}" vanish: give them a lost box that counts them`,
          undefined,
          { stage: queue, reason: 'dropped' },
        )
      // what a flow with a fallback fails for good is served there, not lost
      if ((shape.flows[f] as { fallback?: unknown } | undefined)?.fallback) continue
      // a timeout refused has its error instead
      const timeout = this.prop(b, 'timeout')
      const t = (shape.flows[f] as { timeout?: unknown } | undefined)?.timeout
      if (!timeout || t === undefined || (typeof t === 'number' && !(t > 0))) continue
      // nor one without latency: no stage on its way has a service, which the model refuses at this same line
      const timed = (c: unknown) => (components[c as string] as { service?: unknown } | undefined)?.service != null
      const component = (st: string) => (shape.stages[st] as { component?: string } | undefined)?.component
      if (!(open ? Object.keys(components).some(timed) : ways.flat().some((st) => timed(component(st))))) continue
      // too slow at the end of each way, or answered too slowly by a cache on it
      const late = [
        ...new Set([...ways.map((w) => w.at(-1)!), ...ways.flat().filter((s) => shape.stages[s]?.kind === 'cache')]),
      ]
      const at = late.find((s) => s && first(s, 'timedOut'))
      if (at)
        this.report.warning(
          'unseen-loss',
          timeout.key,
          `units of "${f}" too slow for their client at "${at}" vanish: give them a lost box that counts them`,
          undefined,
          { stage: at, reason: 'timedOut' },
        )
    }
  }

  /**
   * Whether an edge joins every hop a flow takes, in its direction; each one without is an error at the line that makes
   * the hop (the route, a split's way, a fan-out's branch or the flow's `from`), a warning before loadmap 1.1.
   */
  private hopsJoined(
    model: Model,
    viewDef: { nodes: Record<string, AnyNodeDef>; edges: EdgeDef[]; flows: Record<string, FlowView> },
  ): 'joined' | 'warned' | 'failed' {
    const strictFrom: Version = [1, 1]
    const gaps = unjoined(model, viewDef as never)
    for (const h of gaps) {
      const reversed = h.edge === 'reversed'
      const how = reversed ? 'but their edge points the other way' : 'and no edge joins them'
      this.strict(
        strictFrom,
        reversed ? 'reversed-edge' : 'missing-edge',
        this.hopAt(h),
        `"${h.flow}" goes from "${h.from}" to "${h.to}", ${how}`,
        `draw ${h.from} -> ${h.to}`,
        { from: h.from, to: h.to },
      )
    }
    return !gaps.length ? 'joined' : before(this.version, strictFrom) ? 'warned' : 'failed'
  }

  /** The text that makes a hop. */
  private hopAt(h: Hop): Span {
    const [a, b] = h.stages
    const flow = this.flowAt.get(h.flow) ?? { from: 0, to: 0 }
    if (a == null) return this.fromAt.get(h.flow) ?? flow
    if (h.via === 'fanout') return this.branchAt.get(`${h.flow}\u0000${b}`) ?? flow
    if (h.via === 'fallback') return this.fallbackAt.get(h.flow) ?? flow
    const chain = this.routeAt.get(h.flow) ?? []
    const i = chain.findIndex(([, s], j) => j > 0 && s === b && chain[j - 1]![1] === a)
    if (i > 0) return { from: chain[i - 1]![0].from, to: chain[i]![0].to }
    const way = this.wayAt.find(
      (w) =>
        w.flow === h.flow &&
        ((w.split === a && w.stages[0] === b) ||
          w.stages.some((s, j) => s === a && w.stages[j + 1] === b) ||
          w.stages.at(-1) === a),
    )
    return way?.at ?? flow
  }

  /** A warning at each hidden edge a flow still takes at these values: its dots would cross the diagram without it. */
  private hiddenHops(
    model: Model,
    viewDef: { nodes: Record<string, AnyNodeDef>; edges: EdgeDef[]; flows: Record<string, FlowView> },
    hidden: EdgeDef[],
    values: Record<string, unknown>,
    where: string,
  ) {
    const hops = hopsOf(model, viewDef as never, values as never).filter((h) => h.used)
    const shown = viewDef.edges.filter((e) => !hidden.includes(e))
    for (const e of hidden) {
      // another edge between the same boxes, shown here, still carries the dots
      if (shown.some((x) => x.from === e.from && x.to === e.to)) continue
      const flows = [...new Set(hops.filter((h) => h.from === e.from && h.to === e.to).map((h) => h.flow))]
      if (!flows.length) continue
      const at = this.whenAt.get(e) ?? { from: 0, to: 0 }
      const who =
        flows.length === 1
          ? `"${flows[0]}" still goes`
          : `${flows
              .slice(0, -1)
              .map((f) => `"${f}"`)
              .join(', ')} and "${flows.at(-1)}" still go`
      this.report.warning('hidden-edge', at, `${e.from} -> ${e.to} is hidden ${where}, but ${who} that way`)
    }
  }

  /**
   * What running the model threw, where it came from: its formula, else its flow, else `at`. A preset or a scenario
   * keeps `at` (`onFlow` false): the flow is fine at the defaults, the preset is what breaks it.
   */
  runError(err: unknown, at: Span, onFlow = true) {
    if (err instanceof FormulaError) return this.report.error('runtime', err.span, err.message, err.hint)
    const flow = flowOf(err)
    const { message, hint } = failure(err, flow ? `the flow "${flow}"` : 'the model')
    // a connection the model refuses: at its own line
    const named = /^loadmap: connections? "([^"]+)"/.exec((err as Error)?.message ?? '')?.[1]
    const connection = named ? this.connectionAt.get(named) : undefined
    // a preset or a scenario keeps its place: it is what breaks the flow or the connection
    this.report.error('model', (onFlow && ((flow && this.flowPlace(flow, err)) || connection)) || at, message, hint)
  }

  /** Where an error about a flow goes: the stage on its route, or the property, it is about; else the flow's id. */
  private flowPlace(flow: string, err: unknown): Span | undefined {
    const about = propOf(err)
    const b = this.flowBlock.get(flow)
    const prop = about && b ? this.prop(b, about.prop) : undefined
    const stage =
      about?.stage && about.prop === 'route'
        ? this.routeAt.get(flow)?.find(([, s]) => s === about.stage)?.[0]
        : undefined
    return stage ?? prop ?? this.flowAt.get(flow)
  }

  private flowRate = new Map<string, Span>()
  /** Each component's block: where its demand and capacity are written. */
  private componentBlocks = new Map<string, Block>()
  /** Each slider's range, which a preset, a scenario or a step stays in. */
  private sliders = new Map<string, { min: number; max: number }>()
  private flowAt = new Map<string, Span>()
  /** Each flow's fallback block: where a hop it makes is reported. */
  private fallbackAt = new Map<string, Span>()
  /** The definition has a growth line: an expect's lasts needs one. */
  private hasGrowth = false
  /** Components a quota (a limit per a window) runs: their demand counts a window, not a second. */
  private windowed = new Map<string, string>()
  private flowBlock = new Map<string, Block>()
  /** Each flow's route as written, with the stage each name resolved to: where a hop's error goes. */
  private routeAt = new Map<string, [Ident, string][]>()
  private fromAt = new Map<string, Span>()
  /** A split's ways (flow and stages) and a fan-out's branches (flow and stage), at their lines. */
  private wayAt: { split: string; flow: string; stages: string[]; at: Span }[] = []
  private branchAt = new Map<string, Span>()
  private whenAt = new WeakMap<EdgeDef, Span>()
  /** The edges that hold a delay, as written: the model takes them once the stages and flows are known. */
  private delays: { from: string; to: string; delay: number | ((v: unknown) => number); at: Span }[] = []
  private connectionAt = new Map<string, Span>()

  /** A connection's definition for core; undefined when its hop names no two stages. */
  private connection(
    b: Block,
    resolveStage: (n: Ident, what: string) => string | undefined,
    flowNames: Map<string, Span>,
    membersOf: (stage: string) => unknown,
  ): Record<string, unknown> | undefined {
    const hop = this.prop(b, 'hop')
    if (!hop) return undefined
    const chain = hop.chain ?? (hop.value.t === 'id' ? [hop.value as Ident] : [])
    if (chain.length !== 2) {
      this.report.error('bad-route', hop.value, 'a hop is two stages: from -> to')
      return undefined
    }
    const [from, to] = chain.map((n) => resolveStage(n, 'stage'))
    if (!from || !to) return undefined
    const def: Record<string, unknown> = { from, to }
    for (const k of ['assign', 'owner', 'capacityPer']) {
      const v = this.constProp<string>(b, k)
      if (v != null) def[k] = v
    }
    for (const k of ['parts', 'members', 'open']) {
      const v = this.dynProp<number>(b, k, 'number')
      if (v !== undefined) def[k] = v
    }
    const ruleProp = this.prop(b, 'rule')
    if (ruleProp) {
      const id = this.constant(ruleProp.value, 'string')
      const rules = catalogRules(this.catalog)
      if (!this.catalog)
        this.report.error(
          'catalog-not-loaded',
          ruleProp.value,
          'the component catalog is not loaded',
          'a host awaits loadCatalog() before it compiles',
        )
      else if (typeof id === 'string') {
        const r = rules.get(id)
        if (r) def.rule = r
        else
          this.report.error(
            'unknown-name',
            ruleProp.value,
            `no connection rule "${id}" in the catalog`,
            didYouMean(id, rules.keys()),
          )
      }
    }
    const accepts = this.prop(b, 'accepts')
    if (accepts) def.accepts = this.dyn(accepts.value, 'capacity', 'ctx', checkCapacity)
    const skew = this.prop(b, 'skew')
    if (skew) def.skew = this.dyn(skew.value, 'capacity', 'ctx', checkCapacity)
    if ((def.assign === 'key' || def.assign === 'leader') && def.members === undefined) {
      const m = membersOf(to)
      if (m !== undefined) def.members = m
    }
    const flows = this.prop(b, 'flows')
    if (flows) {
      if (flows.value.t === 'array' && !flows.value.items.length)
        this.report.error(
          'bad-value',
          flows.value,
          'an empty list covers no flow',
          'leave flows out for every flow on the hop',
        )
      const list = this.listed(flows, flowNames, 'flow', '[orders, events]')
      if (list) def.flows = list.names
    }
    return def
  }
  private plainBoxes = new Set<string>()
  /** The unit each published figure counts in, by its id: where a demand written in bytes is brought to. */
  private publishedUnits = new Map<string, string>()

  // -- units ---------------------------------------------------------------------------------------------------

  /**
   * A demand written with a size (`flows.alerts * 1.5KB`) counts bytes; its capacity says the size it counts in
   * ("MB/s"), so the demand is brought to that. Nothing is guessed: the size is a suffix in the text and the unit the
   * capacity's own, so a size against a capacity that names none is an error, not a warning.
   */
  private inCapacityUnit(
    b: Block,
    demand: (ctx: unknown) => number,
    key: 'demand' | 'fills' = 'demand',
  ): (ctx: unknown) => number {
    const prop = this.prop(b, key)
    const size = prop && sizePower(prop.value, this.unitNames)
    if (!prop || !size) return demand
    if (size.mixed) {
      this.report.error(
        'unit-mismatch',
        size.mixed,
        'a size and a plain number are mixed here',
        'give both a size (1.5KB + 500KB), or multiply: flows.x * 1.5KB',
      )
      return demand
    }
    if (size.power === 0) return demand
    const capacity = this.prop(b, 'capacity')
    const call = capacity && capacityCall(capacity.value, this.unitNames)?.args[1]
    // a published figure's unit is the catalog's: `capacity: brokersRef`, in MB/s
    const unit =
      call?.t === 'str'
        ? call
        : capacity?.value.t === 'id' && this.publishedUnits.has(capacity.value.name)
          ? { t: 'str' as const, value: this.publishedUnits.get(capacity.value.name)! }
          : call
    const scale = size.power === 1 && unit?.t === 'str' ? sizeScale(unit.value) : undefined
    if (!scale) {
      this.report.error(
        'unit-mismatch',
        prop.value,
        size.power !== 1
          ? `the ${key} multiplies sizes together: it counts no bytes`
          : unit?.t === 'str'
            ? `the ${key} is a size, in bytes; the capacity is in "${unit.value}"`
            : `the ${key} is a size, in bytes; its capacity names no unit to bring it to`,
        'give the capacity a size, "MB/s" or "GB", or divide by the size of one unit: … / 1KB',
      )
      return demand
    }
    return placed(prop.value, (ctx: unknown) => demand(ctx) / scale)
  }

  /**
   * Where the text says what a value counts and two of those disagree: a demand and its capacity (per second against a
   * count, or two counts in different words), and a property against the unit the schema gives it (`held: 80%`). A
   * formula of bare numbers says nothing, so it is never warned about.
   */
  private units(root: Block, components: ReadonlyMap<string, Block>, used: ReadonlySet<string | undefined>) {
    const names = this.unitNames

    for (const [id, b] of components) {
      const capacity = this.prop(b, 'capacity')
      if (!capacity) continue
      const literal = capacityCall(capacity.value, names)?.args[1]
      if (literal?.t === 'str' && !literal.value.trim())
        this.report.warning(
          'empty-unit',
          literal,
          "a capacity's unit is empty",
          'name what it counts: "req/s", "cores"',
        )
      const value = capacityCall(capacity.value, names)?.args[0]
      if (value && sizePower(value, names).power !== 0 && literal?.t === 'str')
        this.report.error(
          'unit-mismatch',
          value,
          "a capacity's size goes in its unit",
          `write the number as its unit counts it: estimated(20, "MB/s", …)`,
        )
      const cap = unitOf(capacity.value, names)
      const demand = this.prop(b, 'demand')
      const said = demand?.as && parseUnit(demand.as.unit)
      const found = demand && unitOf(demand.value, names)
      if (said && found && disagree(found, said))
        this.report.warning(
          'unit-mismatch',
          demand.as!,
          `"as" says "${said.word}", but the formula is ${describe(found)}`,
        )
      if (!cap?.word || cap.time === undefined) continue
      if (demand) {
        const d = said ?? found
        if (!d || !disagree(d, cap)) continue
        // never `as`: on a formula whose unit is known it only says the same thing wrong
        const hint = said
          ? `say the capacity's unit: as "${cap.word}", or give the capacity the demand's`
          : d.time === -1 && cap.time === 0
            ? cap.word.includes('/')
              ? 'give the capacity per second: 6000 a minute is 100 a second, "req/s"'
              : 'multiply by what each unit costs: flows.x * 2ms is CPU seconds a second; slots such as connections take held: 20ms'
            : d.time === 0 && cap.time === -1
              ? 'a capacity a second takes the units a second: leave out what makes the demand a count'
              : 'count both in one unit'
        this.report.warning(
          'unit-mismatch',
          demand.as ?? demand.value,
          `the demand is ${describe(d)}, the capacity ${describe(cap)}`,
          hint,
        )
      } else if (this.prop(b, 'fills')) {
        if (cap.time !== 0)
          this.report.warning(
            'unit-mismatch',
            capacity.value,
            `a stock's capacity is what it holds, a count; the capacity is ${describe(cap)}`,
            'say what it holds: configured(500, "GB", "volume size")',
          )
      } else if (this.prop(b, 'held') || this.prop(b, 'through') || b.children.some((c) => c.keyword === 'held')) {
        if (cap.time !== 0)
          this.report.warning(
            'unit-mismatch',
            capacity.value,
            `a held component's demand is the slots in use, a count; the capacity is ${describe(cap)}`,
            'count the slots: configured(200, "connections", "pool size")',
          )
      } else if (this.windowed.has(id)) {
        const said = /\/\s*(h|hr|hour|d|day|mo|month|min|minute)s?$/i.exec(cap.word)?.[1]?.toLowerCase()
        const named =
          said == null
            ? undefined
            : said.startsWith('h')
              ? 'hour'
              : said.startsWith('d')
                ? 'day'
                : said.startsWith('mo')
                  ? 'month'
                  : 'minute'
        const per = this.windowed.get(id)
        if (named && named !== per)
          this.report.warning(
            'unit-mismatch',
            capacity.value,
            `the quota is per ${per}; the capacity counts ${named === 'hour' ? 'an' : 'a'} ${named}`,
            `give what a ${per} allows: "requests/${per}"`,
          )
        else if (cap.time === -1)
          this.report.warning(
            'unit-mismatch',
            capacity.value,
            `a quota's capacity is what its window allows, a count; the capacity is ${describe(cap)}`,
            'count the window: configured(5_000_000, "requests/day", "the plan")',
          )
      } else if (used.has(id) && cap.time !== -1)
        this.report.warning(
          'unit-mismatch',
          capacity.value,
          `without a demand line the demand is what reaches its stages, per second; the capacity is ${describe(cap)}`,
          'add demand: …, such as flows.orders * 2ms for the CPU seconds each order takes',
        )
    }

    const walk = (b: Block) => {
      for (const [k, props] of b.props) {
        const spec = own(b.spec.props, k) ?? b.spec.open?.spec
        // a preset's or a step's `load` is the one open name whose unit is known
        const unit = spec?.unit ?? (k === 'load' && b.spec.open?.names === 'values' ? 'multiple' : undefined)
        if (!unit) continue
        const want = PROPERTY_UNITS[unit]
        for (const p of props) {
          const u = unitOf(p.value, names)
          if (u && wrongMark(u, want.unit))
            this.strict(
              STRICT_SUFFIXES,
              'unit-mismatch',
              p.value,
              `${k} is ${want.words}, and this is ${describe(u)}`,
              unit === 'multiple'
                ? `${want.hint}; a utilization goes in thresholds { target: … }`
                : `${want.hint}; a load multiple goes in expect { underTarget: … }`,
            )
          else if (u && disagree(u, want.unit))
            this.report.warning(
              'unit-mismatch',
              p.value,
              `${k} is ${want.words}, and this is ${describe(u)}`,
              want.hint,
            )
        }
      }
      b.children.forEach(walk)
    }
    walk(root)
  }

  // -- shape ---------------------------------------------------------------------------------------------------

  private shape(keyword: string, spec: BlockSpec, stmts: readonly Stmt[], at: Span, decl?: Decl): Block {
    const b: Block = {
      keyword,
      spec,
      at,
      decl,
      args: {},
      props: new Map(),
      children: [],
      edges: [],
      rows: [],
      said: new Set(),
    }
    if (decl) this.args(b, decl)
    const here = keyword ? `in ${keyword}` : 'at the top'
    for (const s of stmts) {
      if (s.kind === 'prop') {
        let k = s.key.name
        const renamed = own(spec.props, k) ? undefined : propNamed(spec.props, k)
        if (renamed) {
          // the old name: read under the new one; a file stamped before the new name has nothing else to write
          k = renamed.name
          const since = parseVersion(renamed.spec.since ?? '1.0')!
          // beside the new name a rename would set it twice: the error that says so is the one to act on
          const both = stmts.some((x) => x.kind === 'prop' && x.key.name === k)
          if (!before(this.versionOf(s.key), since) && !both)
            this.strict(ONE, 'deprecated', s.key, `${s.key.name} is now ${k}`, 'loadmap fmt rewrites it', { to: k })
        }
        const gone = own(spec.props, k)
        if (gone?.until)
          this.removed(
            gone,
            s.key,
            `"${k}" is no longer a property ${keyword ? `of ${keyword}` : 'of the top level'}`,
            {
              gone: k,
              in: keyword,
            },
          )
        if (!spec.open && !own(spec.props, k)) {
          const hint = spec.children.includes(k)
            ? `write it as a block: ${k} { … }`
            : didYouMean(k, [...Object.keys(spec.props), ...spec.children])
          this.report.error('unknown-property', s.key, `unknown property "${k}" ${here}`, hint)
          continue
        }
        const list = b.props.get(k) ?? []
        if (list.length && !(own(spec.props, k)?.repeat ?? false)) {
          const first = list[0]!.key.name
          const twice =
            first === s.key.name
              ? `"${k}" is set twice ${here}`
              : `"${first}" and "${s.key.name}" are one property ${here}`
          this.report.error('duplicate', s.key, twice, 'remove one of them')
        }
        list.push(s)
        b.props.set(k, list)
      } else if (s.kind === 'decl') {
        const k = s.keyword.name
        const childSpec = own(SCHEMA, k)
        if (!spec.children.includes(k) || !childSpec || k === '') {
          if (own(spec.props, k)) {
            this.report.error('misplaced', s.keyword, `"${k}" is a property: write "${k}: …"`)
            // written, if with the wrong mark: the block must not also say it is missing
            b.said.add(k)
          } else if (childSpec) this.report.error('misplaced', s.keyword, `"${k}" cannot go ${here}`, where(k))
          else {
            const meant = closest(k, [...spec.children, ...Object.keys(spec.props)])
            this.report.error(
              'unknown-statement',
              s.keyword,
              `unknown statement "${k}" ${here}`,
              didYouMean(k, [...spec.children, ...Object.keys(spec.props)]),
            )
            // a misspelt keyword that declares (`nod api`): the uses of what it would have declared are this one
            // mistake, not each an unknown name
            const id = s.args[0]
            const declares = meant != null && SCHEMA[meant]?.args[0]?.name === 'id'
            if (declares && id?.t === 'id') this.report.quiet(id.name)
          }
          continue
        }
        if (childSpec.until)
          this.removed(childSpec, s.keyword, `"${k}" is no longer a statement`, { gone: k, in: keyword })
        b.children.push(this.shape(k, childSpec, s.body ?? [], s.keyword, s))
      } else if (s.kind === 'edge') {
        if (!spec.edges) this.report.error('misplaced', s.chain[0]!, `an "a -> b" line cannot go ${here}`)
        else b.edges.push(s)
      } else if (!spec.rows) this.report.error('misplaced', s, `a row of numbers can only go in "points"`)
      else b.rows.push(s)
    }
    if (decl)
      for (const [k, p] of Object.entries(spec.props))
        if (p.required && !this.written(b, k))
          this.report.error('missing-property', at, `"${keyword}" needs "${k}: …"`, p.doc, { key: k })
    return b
  }

  private args(b: Block, d: Decl) {
    const { filled, bad, missing } = matchArgs(b.spec.args, d.args)
    for (const a of bad)
      this.report.error('syntax', a, `unexpected ${this.slice(a)} after "${b.keyword}"`, usage(b.keyword))
    for (const [slot, a] of filled) {
      if (a.t === 'tpl' && !slot.dynamic && !a.parts.length) {
        ;(b.args as Record<string, Expr>)[slot.name] = { t: 'str', value: a.quasis[0]!, from: a.from, to: a.to }
        continue
      }
      if (a.t === 'tpl' && !slot.dynamic)
        this.report.error('wrong-type', a, `the ${slot.name} of "${b.keyword}" must be a plain text`)
      if (a.t === 'id') b.args[slot.name as 'id' | 'x' | 'y' | 'component'] = { name: a.name, from: a.from, to: a.to }
      else (b.args as Record<string, Expr>)[slot.name] = a
    }
    if (missing) this.report.error('missing-part', b.at, `"${b.keyword}" needs its ${missing.name}`, usage(b.keyword))
    if (b.spec.init === true && !d.init)
      this.report.error('missing-part', b.at, `"${b.keyword}" needs "= formula"`, usage(b.keyword))
    if (!b.spec.init && d.init) this.report.error('misplaced', d.init, `"${b.keyword}" takes no "="`)
  }

  /**
   * One id for two kinds of thing reads two ways: `${alertPods}` is the parameter and `focus: alertPods` the box. So
   * does an id that is also a keyword (`param merge` beside `merge { when: merge }`). A box, its stage and its
   * component share an id by design; every other pair is told, on the later of the two.
   */
  private shadowed(boxes: readonly Box[], loose: readonly Block[]) {
    const WORDS: Partial<Record<DslSymbol['kind'], string>> = {
      param: 'a parameter',
      let: 'a let',
      fit: 'a fit',
      published: 'a published figure',
      measure: 'a measure',
      metric: 'a metric',
      flow: 'a flow',
      node: 'a box',
      stage: 'a stage',
      component: 'a component',
      tier: 'a tier',
    }
    // the box each stage and component belongs to: its own names are one thing said three ways
    const family = new Map<number, string>()
    for (const box of boxes) {
      family.set(box.block.args.id!.from, box.id)
      for (const s of box.stages) family.set((s.block.args.id ?? s.block.at).from, box.id)
      const c = box.component
      if (c) family.set((c.own ? box.block.args.id! : (c.block.args.id ?? c.block.at)).from, box.id)
    }
    for (const b of loose) if (b.args.id) family.set(b.args.id.from, `component ${b.args.id.name}`)
    const seen = new Map<string, DslSymbol[]>()
    const marked = new Set<number>()
    for (const s of [...this.symbols].sort((a, b) => a.span.from - b.span.from)) {
      const word = WORDS[s.kind]
      if (!word) continue
      const text = this.source.slice(s.span.from, s.span.to)
      // a stage or a component without an id of its own has its box's: the box is where it is said
      if (text !== s.id || marked.has(s.span.from)) continue
      const earlier = seen.get(s.id) ?? []
      seen.set(s.id, [...earlier, s])
      const first = earlier.find(
        (e) =>
          e.kind !== s.kind && (family.get(e.span.from) ?? e.span.from) !== (family.get(s.span.from) ?? s.span.from),
      )
      if (first) {
        marked.add(s.span.from)
        this.report.warning(
          'shadowed-name',
          s.span,
          `"${s.id}" is already ${WORDS[first.kind]} (line ${this.report.position(first.span.from).line})`,
          `give ${word.replace(/^an? /, 'the ')} its own id, or rename ${WORDS[first.kind]!.replace(/^an? /, 'the ')}`,
        )
      } else if (!earlier.length && s.id !== '' && Object.hasOwn(SCHEMA, s.id))
        this.report.warning(
          'shadowed-name',
          s.span,
          `"${s.id}" is also a keyword of the language`,
          `pick an id that is no statement: ${s.id}Tier, main${s.id[0]!.toUpperCase()}${s.id.slice(1)}`,
        )
    }
  }

  /**
   * `30%+1`: a `%` straight after a number is a share everywhere but before a value or a sign, where it is the
   * remainder. One space decided which, so from 1.2 it is written as what it means.
   */
  private gluedPercents(body: readonly Stmt[]) {
    for (const e of formulasOf(body)) {
      if (e.t !== 'bin' || !e.glued) continue
      const text = (x: Span) => this.source.slice(x.from, x.to)
      const [left, right] = [text(e.left), text(e.right)]
      // its own span takes in the parentheses around it, which a fix must leave
      const at = { from: e.left.from, to: e.right.to }
      const signed = e.right.t === 'unary' && e.right.op !== '!' ? e.right : undefined
      const share = signed && `${left}% ${signed.op} ${text(signed.arg)}`
      this.strict(
        STRICT_PERCENT,
        'glued-percent',
        at,
        `"${text(at)}" is the remainder of ${left} divided by ${right}, not a share`,
        share ? `write mod(${left}, ${right}), or ${share} for the share` : `write mod(${left}, ${right})`,
        { mod: `mod(${left}, ${right})`, ...(share && { share }) },
      )
    }
  }

  /**
   * One spelling each, from 1.5: `%` between two values was the remainder, which `mod(a, b)` says; `===` is `==`, and
   * `derived.x` is `x`. The last two only warn: both still read as they always did.
   */
  private spellings(body: readonly Stmt[]) {
    const text = (x: Span) => this.source.slice(x.from, x.to)
    for (const e of formulasOf(body)) {
      if (e.t === 'bin' && e.op === '%' && !e.glued) {
        const mod = modText(this.source, e)
        this.strict(
          ONE,
          'remainder',
          { from: e.left.from, to: e.right.to },
          `"%" between two values is the remainder: ${mod}`,
          `write ${mod}`,
          { mod },
        )
      } else if (e.t === 'bin' && e.triple) {
        const to = e.op
        this.report.warning('deprecated', e.triple, `${text(e.triple)} is now ${to}`, 'loadmap fmt rewrites it', { to })
      } else if (e.t === 'member' && e.object.name === 'derived' && !e.flow) {
        const to = text(e.prop)
        this.report.warning('deprecated', e, `derived.${to} is now ${to}`, 'loadmap fmt rewrites it', { to })
      }
    }
  }

  /**
   * A statement or property a version dropped (`until` in the schema): an error from that version, a warning that says
   * so before it, while it still reads as it did.
   */
  private removed(spec: { until?: string; instead?: string }, at: Span, message: string, data: Record<string, string>) {
    const until = parseVersion(spec.until!)!
    if (!before(this.versionOf(at), until)) this.report.error('removed', at, message, spec.instead, data)
    else
      this.report.warning('removed', at, `${message} (an error from loadmap ${versionText(until)})`, spec.instead, data)
  }

  /**
   * A check a language version made strict: an error in a definition stamped with that version or later, a warning
   * that says so before it, so a file that compiled under its stamp still does (docs/dsl.md, "Versions").
   */
  private strict(since: Version, code: Code, at: Span, message: string, hint?: string, data?: Record<string, string>) {
    if (!before(this.versionOf(at), since)) this.report.error(code, at, message, hint, data)
    else this.report.warning(code, at, `${message} (an error from loadmap ${versionText(since)})`, hint, data)
  }

  private declare(
    kind: DslSymbol['kind'],
    id: string,
    span: Span,
    b: Block,
    taken: Map<string, Span>,
    detail?: string,
  ) {
    if (FORBIDDEN.has(id)) this.report.error('reserved-name', span, `"${id}" cannot be used as a name`)
    if (taken.has(id)) this.report.error('duplicate', span, `"${id}" is declared twice`, 'rename one of them')
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
        this.report.error(
          'duplicate',
          n.at,
          `"${id}" already has a component`,
          'one component per box; put others at the top',
        )
      else component = { block: n, id: n.args.id?.name ?? id, own: false }
    }
    if (b.keyword === 'node' && stages.length > 1) {
      this.report.error(
        'bad-box',
        stageBlocks[1]!.at,
        'a node runs at most one stage; a cluster can hold several queues',
      )
      // the rest without an id of their own would take the box's: declared twice, which is this one mistake again
      const named = stages.slice(1).filter((s) => s.block.args.id)
      stages.splice(1, stages.length, ...named)
    }
    if (b.keyword === 'cluster' && !stages.length)
      this.report.error('missing-part', b.at, 'a cluster needs a queue', 'queue topic { partitions { orders: 12 } }')
    if (b.keyword === 'pool') {
      // from 1.5 the pool is its workers stage: its lines are written on it
      const direct =
        POOL_LINES.find((k) => b.props.has(k)) ??
        (b.children.some((c) => c.keyword === 'autoscale') ? 'autoscale' : undefined)
      if (!stages.length && (direct || !before(this.versionOf(b.at), ONE)))
        stages.push({
          block: {
            ...b,
            keyword: 'workers',
            args: b.props.has('stageLabel') ? { label: this.prop(b, 'stageLabel')!.value } : {},
            children: b.children.filter((c) => c.keyword === 'autoscale'),
            pool: true,
          },
          id,
        })
      else if (stages.length && direct)
        this.report.error(
          'duplicate',
          (b.props.get(direct)?.[0]?.key ?? b.children.find((c) => c.keyword === direct)?.at)!,
          `"${direct}" is set on the pool, which also has a workers block`,
          'write every line of the workers block on the pool',
        )
      else if (stages.length !== 1)
        this.report.error('bad-box', b.at, 'a pool needs exactly one workers stage', 'workers { pods: 3; perPod: 8 }')
    }
    const ids = new Set<string>()
    for (const s of stages) {
      if (ids.has(s.id))
        this.report.error('duplicate', s.block.at, `"${id}" has two stages called "${s.id}"`, 'give each an id')
      ids.add(s.id)
    }
    return { block: b, id, stages, component }
  }

  /** A box with only a component's optional lines (`describe`, `name`, …) was meant as a plain box: one error, the fix. */
  private plainBox(b: Block) {
    const [k, p] = Object.keys(COMPONENT_PROPS)
      .flatMap((k) => (b.props.has(k) ? [[k, this.prop(b, k)!] as const] : []))
      .sort((x, y) => x[1].key.from - y[1].key.from)[0]!
    let hint = 'give the box capacity and over lines, or drop it'
    const sub = b.args.sub
    const noSub = (!sub || (sub.t === 'str' && sub.value === '')) && !b.props.has('sub')
    if (k === 'describe' && p.value.t === 'str' && noSub)
      hint = `for a line under a plain box, put it on the first line: ${b.keyword} ${b.args.id!.name} ${b.args.label ? this.slice(b.args.label) : JSON.stringify(b.args.id!.name)} ${this.slice(p.value)}`
    this.report.error('misplaced', p.key, `"${k}" belongs to a component, and this box has no capacity`, hint)
  }

  // -- values --------------------------------------------------------------------------------------------------

  private slice(s: Span) {
    return this.source.slice(s.from, s.to)
  }

  /**
   * A `published` statement: its component of the pinned edition, the conditions as formulas of the parameters, and
   * the capacity `published()` gives for them. Only the catalog loadmap ships resolves: a shared link names no URL.
   */
  private published(b: Block): ((ctx: any) => unknown) | undefined {
    const comp = b.args.component
    if (!b.args.id || !comp) return undefined
    const editions = this.catalog
    if (!editions) {
      this.report.error(
        'catalog-not-loaded',
        comp,
        'the component catalog is not loaded',
        'a host awaits loadCatalog() before it compiles',
      )
      return undefined
    }
    const at = this.prop(b, 'edition')
    const edition = this.text(at?.value)
    if (!at || edition == null) return undefined
    if (!Object.hasOwn(editions, edition)) {
      const known = Object.keys(editions)
      this.report.error(
        'unknown-name',
        at.value,
        `no catalog edition "${edition}"`,
        `this loadmap has ${known.join(', ')}; a later edition needs a later loadmap`,
      )
      return undefined
    }
    const c = catalogComponent(editions, edition, comp.name)
    if (!c) {
      const all = Object.values(editions[edition]!.components)
      const tagged = all.find((x) => x.tags.some((t) => t.toLowerCase() === comp.name.toLowerCase()))
      this.report.error(
        'unknown-name',
        comp,
        `no component "${comp.name}" in the catalog`,
        tagged
          ? `${tagged.id} (${tagged.name}) covers ${comp.name}`
          : didYouMean(
              comp.name,
              all.map((x) => x.id),
            ),
      )
      return undefined
    }
    const latest = latestEdition(editions)
    if (latest !== edition && JSON.stringify(c.figures) !== JSON.stringify(editions[latest]!.components[c.id]?.figures))
      this.report.warning(
        'newer-edition',
        at.value,
        `edition ${latest} of the catalog has other figures for ${c.name}`,
        `edition: "${latest}"`,
      )

    const runs: [string, (ctx: any) => unknown][] = []
    const constants: Record<string, unknown> = {}
    let allConstant = true
    for (const [k, props] of b.props) {
      if (own(b.spec.props, k) && k !== 'version') continue
      const p = props[0]!
      if (k !== 'version' && !Object.hasOwn(c.conditions, k)) {
        const names = Object.keys(c.conditions)
        this.report.error(
          'unknown-name',
          p.key,
          `${c.name} has no condition "${k}"`,
          didYouMean(k, names) ??
            (names.length ? `its conditions: ${names.join(', ')}` : `${c.name} has no conditions`),
        )
        continue
      }
      const f = this.formula(p.value, 'values', k === 'version' ? 'string' : undefined)
      runs.push([k, placed(p.value, f.run)])
      if (f.constant) constants[k] = f.run(undefined)
      else allConstant = false
    }
    const figure = this.constProp<string>(b, 'figure')
    // a documented default is a figure too, taken by its name only
    const named = [...c.figures, ...(c.defaults ?? [])]
    if (figure != null && !named.some((f) => f.id === figure)) {
      this.report.error(
        'unknown-name',
        this.prop(b, 'figure')!.value,
        `${c.name} has no figure "${figure}"`,
        didYouMean(
          figure,
          named.map((f) => f.id),
        ) ?? named.map((f) => f.id).join(', '),
      )
      return undefined
    }
    // the unit a demand in bytes is brought to (`at.topic * 1KB` against MB/s): the one every figure it may take has
    const units = new Set(
      (figure != null
        ? named.filter((f) => f.id === figure)
        : c.figures.filter((f) => f.measure === 'capacity' || f.measure === 'limit')
      ).map((f) => f.unit),
    )
    if (units.size === 1) this.publishedUnits.set(b.args.id.name, [...units][0]!)
    const margin = this.constProp<number>(b, 'margin')
    if (margin != null && !(margin >= 0 && margin < 1)) {
      this.report.error(
        'out-of-range',
        this.prop(b, 'margin')!.value,
        'margin is a share from 0 to below 1: 0.3 is 30 %',
      )
      return undefined
    }
    // a documented limit is exact: refused here, not where a parameter happens to reach one
    if (
      margin &&
      named.some((f) => f.measure === 'limit' && (figure == null ? c.figures.includes(f) : f.id === figure))
    ) {
      this.report.error(
        'bad-value',
        this.prop(b, 'margin')!.value,
        `${c.name} has documented limits: exact, so they take no margin`,
      )
      return undefined
    }
    const fixed: PublishedConfig = {
      ...(figure != null && { figure }),
      ...(margin != null && { margin }),
    }
    // every condition fixed in the text: say now that no published run matches
    if (allConstant) {
      try {
        const cap = published(c, { ...(constants as PublishedConfig), ...fixed })
        if (cap.missing != null)
          this.report.warning(
            'no-benchmark',
            comp,
            `no published benchmark ${cap.missing}`,
            'the component is not ranked',
          )
        // the same for every load and every value: matched once
        return () => cap
      } catch (err) {
        this.runError(err, comp, false)
        return undefined
      }
    }
    return (ctx) => {
      const config: PublishedConfig = { ...fixed }
      for (const [k, run] of runs) config[k] = run(ctx) as PublishedConfig[string]
      return published(c, config)
    }
  }

  /**
   * A measure's value: the snapshot's, or its fallback. Records the query `loadmap pull` reads, with the measure's
   * arguments filled in; nothing here reads anything.
   */
  private measure(b: Block, metrics: ReadonlyMap<string, Block>): unknown {
    const id = b.args.id
    const name = b.args.metric
    if (!id || !name) return undefined
    const metric = metrics.get(name.name)
    if (!metric) {
      this.report.error(
        'unknown-name',
        name,
        `no metric "${name.name}"`,
        didYouMean(name.name, [...metrics.keys()]) ?? `metric ${name.name} { prometheus { query: "…" } }`,
      )
      return undefined
    }
    const fb = this.prop(b, 'fallback')
    if (!fb) return undefined
    const fallback = this.constant(fb.value, 'any')
    if (fallback === undefined) return undefined
    const capacity = isCapacity(fallback)
    if (!capacity && typeof fallback !== 'number') {
      this.report.error(
        'wrong-type',
        fb.value,
        'a fallback is a capacity or a number',
        'fallback: estimated(1_000, "req/s", "…")',
      )
      return undefined
    }
    const unitAt = this.prop(b, 'unit')
    if (capacity && unitAt)
      this.report.error('bad-metric', unitAt.key, 'a capacity has its own unit', `"${fallback.unit}"`)

    const args = new Map<string, { value: string; at: Span }>()
    for (const [k, props] of b.props) {
      if (own(b.spec.props, k)) continue
      const v = this.constant(props[0]!.value, 'any')
      if (typeof v !== 'string' && typeof v !== 'number') {
        if (v !== undefined) this.report.error('wrong-type', props[0]!.value, 'an argument is a word or a number')
        continue
      }
      args.set(k, { value: String(v), at: props[0]!.key })
    }
    const q = this.metricQuery(metric)
    if (!q) return undefined
    const used = q.names
    const missing = [...used].filter((a) => !args.has(a))
    if (missing.length)
      this.report.error(
        'bad-metric',
        id,
        `the query of "${name.name}" needs ${missing.map((a) => `{{ args.${a} }}`).join(' and ')}`,
        missing.map((a) => `${a}: "…"`).join('; '),
      )
    for (const [k, a] of args)
      if (!used.has(k))
        this.report.error(
          'bad-metric',
          a.at,
          `the query of "${name.name}" has no {{ args.${k} }}`,
          didYouMean(k, [...used]),
        )
    if (missing.length) return undefined
    const query = q.fill(new Map([...args].map(([k, a]) => [k, a.value])))

    const label = this.text(metric.args.label)
    this.measures.push({
      id: id.name,
      metric: name.name,
      ...(label != null && { label }),
      provider: q.provider,
      query,
      ...(q.stat && { stat: q.stat }),
      ...(q.minSamples != null && { minSamples: q.minSamples }),
      unit: capacity ? fallback.unit : (this.constProp<string>(b, 'unit') ?? ''),
    })
    if (!capacity) this.numbers.add(id.name)
    if (!this.snapshot) return fallback
    try {
      return capacity ? this.snapshot.capacity(id.name, fallback) : this.snapshot.value(id.name, fallback as number)
    } catch (err) {
      this.runError(err, id, false)
      return undefined
    }
  }

  private metricQueries = new Map<Block, ReturnType<Compiler['readMetric']>>()

  /** A metric's provider, query and window rules, checked once however many measures use it. */
  private metricQuery(b: Block) {
    if (!this.metricQueries.has(b)) this.metricQueries.set(b, this.readMetric(b))
    return this.metricQueries.get(b)
  }

  private readMetric(b: Block) {
    // every statement a metric holds is a provider
    const providers = b.children.filter((c) => SCHEMA.metric!.children.includes(c.keyword))
    if (providers.length !== 1) {
      this.report.error(
        'bad-metric',
        b.args.id ?? b.at,
        providers.length ? 'a metric reads from one provider' : 'a metric needs a provider to read from',
        usage('prometheus'),
      )
      return undefined
    }
    const p = providers[0]!
    // every text of the provider's block may name the measure's arguments
    const texts = new Map<string, { text: string; at: Property }>()
    for (const [k, spec] of Object.entries(p.spec.props)) {
      const at = this.prop(p, k)
      const text = spec.value === 'string' ? this.constProp<string>(p, k) : undefined
      if (!at || text == null) continue
      texts.set(k, { text, at })
      for (const m of text.matchAll(/\{\{(.*?)\}\}/g))
        if (!new RegExp(`^${TEMPLATE.source}$`).test(m[0]))
          this.report.error(
            'bad-metric',
            at.value,
            `"${m[0]}" is not an argument`,
            'write {{ args.name }}: each measure gives name',
          )
    }
    const minSamples = this.constProp<number>(b, 'minSamples')
    if (minSamples != null && !(Number.isInteger(minSamples) && minSamples >= 0)) {
      const p = this.prop(b, 'minSamples')!
      this.report.error('out-of-range', p.value, `${p.key.name} is a whole number of samples from 0`)
      return undefined
    }
    const read = { prometheus: () => this.prometheus(texts), elasticsearch: () => this.elasticsearch(p, texts) }
    if (!own(read, p.keyword)) throw new Error(`loadmap: no reader for the provider "${p.keyword}"`)
    const fill = read[p.keyword as keyof typeof read]()
    if (!fill) return undefined
    return {
      provider: p.keyword as MeasureQuery['provider'],
      names: new Set([...texts.values()].flatMap((t) => templateArgs(t.text))),
      fill,
      stat: this.constProp<Stat>(b, 'stat'),
      minSamples,
    }
  }

  private prometheus(texts: ReadonlyMap<string, { text: string }>): Fill | undefined {
    const query = texts.get('query')?.text
    if (query == null) return undefined
    return (args) => query.replace(TEMPLATE, (_, a: string) => args.get(a) ?? '')
  }

  /**
   * The request an Elasticsearch metric sends, as one JSON text (the query a snapshot's origin shows): the index, the
   * time field, what is counted or aggregated at each step, and which documents. An argument goes into the query JSON
   * escaped, so a measure's word never changes its shape.
   */
  private elasticsearch(p: Block, texts: ReadonlyMap<string, { text: string; at: Property }>): Fill | undefined {
    const index = texts.get('index')
    if (!index) return undefined
    // the provider's rule, on the text without its arguments: "logs-{{ args.env }}" is a pattern
    const parts = index.text.replace(TEMPLATE, 'x').split(',')
    if (parts.some((s) => !s || s === '.' || s === '..' || /[\s/?#]/.test(s))) {
      this.report.error(
        'bad-metric',
        index.at.value,
        'an index is a name or a pattern',
        '"logs-*", or names joined by commas',
      )
      return undefined
    }
    const agg = this.constProp<string>(p, 'agg') ?? 'rate'
    const field = texts.get('field')
    const counts = agg === 'rate' || agg === 'count'
    if (!counts && !field) {
      this.report.error('bad-metric', this.prop(p, 'agg')!.value, `${agg} reads a field`, 'field: "duration_ms"')
      return undefined
    }
    if (counts && field) {
      this.report.error('bad-metric', field.at.key, `${agg} counts documents: it takes no field`)
      return undefined
    }
    const filter = texts.get('query')
    if (filter) {
      let v: unknown
      try {
        v = JSON.parse(filter.text.replace(TEMPLATE, 'x'))
      } catch {
        v = undefined
      }
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        this.report.error(
          'bad-metric',
          filter.at.value,
          'the query is Elasticsearch query JSON, an argument inside its texts',
          `'{"term": {"service": "{{ args.service }}"}}'`,
        )
        return undefined
      }
    }
    const time = texts.get('time')?.text ?? '@timestamp'
    return (args) => {
      const plain = (s: string) => s.replace(TEMPLATE, (_, a: string) => args.get(a) ?? '')
      const escaped = (s: string) =>
        s.replace(TEMPLATE, (_, a: string) => JSON.stringify(args.get(a) ?? '').slice(1, -1))
      return JSON.stringify({
        index: plain(index.text),
        time: plain(time),
        agg,
        ...(field && { field: plain(field.text) }),
        ...(filter && { query: JSON.parse(escaped(filter.text)) }),
      })
    }
  }

  /** Whether a block has a property, its value compiled or not: one that did not parse is still written. */
  private written(b: Block, key: string): boolean {
    return b.props.has(key) || b.said.has(key) || !!b.decl?.broken?.includes(key)
  }

  private prop(b: Block, key: string): Property | undefined {
    return b.props.get(key)?.[0]
  }

  private formula(e: Expr, scope: Scope, want?: Type): Formula {
    const f = compileFormula(e, this.names, scope, this.report, (code, at, message, hint) =>
      this.strict(STRICT_FORMULAS, code, at, message, hint),
    )
    if (want && want !== 'any' && f.type !== want && f.type !== 'any') {
      // a number reads fine where a text is wanted: it is shown as written
      if (want === 'string' && f.type === 'number') {
        const run = f.run
        return { ...f, type: 'string', run: (c, l) => String(run(c, l)) }
      }
      if (want === 'capacity' && f.type === 'number')
        this.report.error(
          'bare-capacity',
          e,
          'a capacity says where it came from',
          `write measured(${this.slice(e)}, "unit", "source") or estimated(…)`,
        )
      else this.report.error('wrong-type', e, `expected ${typeWord(want)}, this is ${typeWord(f.type)}`)
      // failed, as a formula that does not compile: what reads its value would only say the same thing again
      return { type: 'any', constant: false, run: () => undefined }
    }
    return f
  }

  /** A condition (`when`, `enabled`): true or false; a number or a text read as one is refused from loadmap 1.1. */
  private condition(key: string, e: Expr, scope: Scope): Formula {
    const f = this.formula(e, scope)
    const issue = notCondition(e, f.type, this.source, `"${key}" takes`)
    if (issue) this.strict(STRICT_FORMULAS, 'wrong-type', e, issue.message, issue.hint)
    return f
  }

  /** A value that must not depend on the model. */
  private constant(e: Expr, want: Type): unknown {
    const f = this.formula(e, 'const', want)
    try {
      return f.run(undefined)
    } catch (err) {
      const { message, hint } = failure(err)
      this.report.error('runtime', e, message, hint)
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
        this.report.error('bad-value', e, (err as Error).message)
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

  /** An enum's word as written, bare or quoted. */
  private word(p: Property): string {
    return p.value.t === 'str' ? p.value.value : this.slice(p.value).replace(/\s+/g, '')
  }

  private enumValue(p: Property, spec: PropSpec): string | undefined {
    const raw = this.word(p)
    if (spec.values?.includes(raw)) return raw
    this.report.error(
      'bad-value',
      p.value,
      `"${raw}" is not one of ${spec.values!.join(', ')}`,
      didYouMean(raw, spec.values ?? []),
    )
    return undefined
  }

  private words(p: Property, spec: PropSpec): string[] | undefined {
    const values = spec.values ?? []
    if (p.value.t !== 'array') {
      this.report.error('wrong-type', p.value, `a list: [${values.slice(0, 2).join(', ')}]`)
      return undefined
    }
    const out: string[] = []
    let broken = false
    for (const e of p.value.items) {
      const word = e.t === 'str' ? e.value : e.t === 'id' ? e.name : this.slice(e)
      if (values.includes(word)) out.push(word)
      else {
        this.report.error('bad-value', e, `"${word}" is not one of ${values.join(', ')}`, didYouMean(word, values))
        broken = true
      }
    }
    // a list with a mistake in it is left out, as if not written: what it would have left out raises nothing more
    return broken ? undefined : out
  }

  /**
   * Copies of one subsystem name their components alike ("Workers" in each region): each such name takes the names of
   * the subsystems around it that tell the copies apart, "EU region › Workers", and its short form "the workers in EU
   * region", so the verdict and the limits say which copy runs out. A name no other component has stays as written.
   */
  private apart(defs: Record<string, Record<string, unknown>>, subsystems: Block[]) {
    const label = new Map<string, string>()
    for (const b of subsystems) if (b.args.id) label.set(b.args.id.name, this.text(b.args.label) ?? b.args.id.name)
    // the subsystems around a component, the outermost first: each by its name, and by its own id in it
    const around = (id: string) => {
      const out: { name: string; id: string }[] = []
      for (let dot = id.lastIndexOf('.'); dot > 0; dot = id.lastIndexOf('.', dot - 1)) {
        const s = id.slice(0, dot)
        if (label.has(s)) out.unshift({ name: label.get(s)!, id: s.slice(s.lastIndexOf('.') + 1) })
      }
      return out
    }
    const named = new Map<string, string[]>()
    for (const [id, d] of Object.entries(defs))
      if (typeof d.name === 'string') named.set(d.name, [...(named.get(d.name) ?? []), id])
    for (const [name, ids] of named) {
      if (ids.length < 2) continue
      const paths = ids.map(around)
      // a place every copy has alike tells none of them apart; copies that still read alike (one subsystem's name
      // taken by both from the library) are told apart by their ids
      const tags = (by: 'name' | 'id') =>
        paths.map((path) =>
          path
            .filter((_, i) => !paths.every((p) => p[i] != null && p[i][by] === paths[0]![i]![by]))
            .map((p) => p[by])
            .join(' › '),
        )
      const byName = tags('name')
      const tag = new Set(byName).size === ids.length ? byName : tags('id')
      for (const [k, id] of ids.entries()) {
        if (!tag[k]) continue
        const d = defs[id]!
        d.short = `${typeof d.short === 'string' ? d.short : name} in ${tag[k]}`
        d.name = `${tag[k]} › ${name}`
      }
    }
  }

  /**
   * `closed: [eu, us.orders]`: the subsystems drawn closed, each by its id. Undefined without the line, and for a list
   * with a mistake in it, which is left out as if not written.
   */
  private closed(b: Block): string[] | undefined {
    const p = this.prop(b, 'closed')
    const list = p && this.listed(p, this.subsystemIds, 'subsystem', '[eu, us]')
    return list?.whole ? list.names : undefined
  }

  /**
   * A list of names of one kind (`[orders, events]`): the ones it knows, each once, and whether that is every one
   * written. Undefined, with an error, for what is no list.
   */
  private listed(
    p: Property,
    known: { has(name: string): boolean; keys(): Iterable<string> },
    what: string,
    example: string,
  ): { names: string[]; whole: boolean } | undefined {
    if (p.value.t !== 'array') {
      this.report.error('wrong-type', p.value, `a list of ${what}s: ${example}`)
      return undefined
    }
    const names: string[] = []
    let whole = true
    for (const e of p.value.items) {
      const name = e.t === 'id' ? e.name : this.slice(e)
      if (e.t === 'id' && known.has(name) && !names.includes(name)) {
        names.push(name)
        continue
      }
      whole = false
      if (names.includes(name)) this.report.error('duplicate', e, `"${name}" is listed twice`)
      else this.report.error('unknown-name', e, `unknown ${what} "${name}"`, didYouMean(name, known.keys()))
    }
    return { names, whole }
  }

  /** A CSS colour in quotes, or with `themes` a theme colour by name; undefined (and an error) for anything else. */
  private color(e: Expr, themes = true): string | undefined {
    const or = themes ? ' or a theme colour' : ''
    if (e.t === 'id' && themes) {
      if ((COLORS as readonly string[]).includes(e.name)) return e.name
      this.report.error(
        'bad-value',
        e,
        `"${e.name}" is not a theme colour`,
        didYouMean(e.name, COLORS) ?? 'or quote a CSS colour',
      )
    } else if (e.t === 'str') {
      if (CSS_COLOR.test(e.value.trim())) return e.value.trim()
      this.report.error('bad-value', e, `"${e.value}" is not a colour`, `use #rrggbb, rgb(…), hsl(…)${or}`)
    } else this.report.error('wrong-type', e, `a colour is a CSS colour in quotes${or}`)
    return undefined
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
    if (enabled) o.enabled = placed(enabled.value, this.condition('enabled', enabled.value, 'values').run)
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
        if (b.props.has(k))
          this.report.error('bad-param', this.prop(b, k)!.key, `"${k}" is for a slider; this param has options`)
      const list = this.options(options)
      if (!list) return undefined
      if (!list.includes(value as never)) {
        this.report.error(
          'bad-param',
          dflt.value,
          `the default ${this.slice(dflt.value)} is not one of the options`,
          list.join(', '),
        )
        return undefined
      }
      return p.select({ ...o, options: list, default: value } as any)
    }
    if (b.props.has('min') || b.props.has('max')) {
      for (const k of ['min', 'max'])
        if (!this.written(b, k))
          this.report.error('missing-property', b.at, `a slider needs "${k}: …"`, undefined, { key: k })
      const r: Record<string, unknown> = { ...o }
      for (const k of ['min', 'max', 'step']) {
        const v = this.constProp<number>(b, k)
        if (v != null) r[k] = v
      }
      if (typeof r.min === 'number' && typeof r.max === 'number')
        this.sliders.set(b.args.id!.name, { min: r.min, max: r.max })
      if (typeof value !== 'number') this.report.error('wrong-type', dflt.value, 'the default of a slider is a number')
      return p.range({ ...r, default: value } as any)
    }
    if (typeof value === 'boolean') return p.switch({ ...o, default: value } as any)
    this.report.error(
      'bad-param',
      b.at,
      `"${b.args.id!.name}" is neither a select, a slider nor a switch`,
      'give it options: [...], min and max, or a default of true or false',
    )
    return undefined
  }

  private options(prop: Property): (number | string)[] | undefined {
    if (prop.value.t !== 'array' || !prop.value.items.length) {
      this.report.error('wrong-type', prop.value, 'options are a list: [2, 3, 4] or ["a", "b"]')
      return undefined
    }
    const list = prop.value.items.map((e) => this.constant(e, 'any'))
    const kind = typeof list[0]
    if (!list.every((v) => (typeof v === 'number' || typeof v === 'string') && typeof v === kind)) {
      this.report.error('wrong-type', prop.value, 'options are all numbers or all texts')
      return undefined
    }
    return list as (number | string)[]
  }

  /** A preset's values, or a scenario's: the same, but a scenario leaves the load to the slider. */
  private preset(b: Block, params: Block[], kind: 'preset' | 'scenario' = 'preset'): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const known = new Map(params.filter((x) => x.args.id).map((x) => [x.args.id!.name, x]))
    for (const [k, props] of b.props) {
      // a step's own properties; its other lines are values. A parameter named lasts or down keeps its value, as
      // before 1.7
      if (own(b.spec.props, k) && !((k === 'lasts' || k === 'down') && known.has(k))) continue
      const prop = props[0]!
      const v = this.constant(prop.value, 'any')
      if (k === 'load' && kind === 'scenario') {
        this.report.error(
          'bad-scenario',
          prop.key,
          'a scenario leaves the load to the slider',
          'use a preset for a load',
        )
        continue
      }
      if (k !== 'load' && !known.has(k)) {
        const names = [...(kind === 'preset' ? ['load'] : []), ...known.keys()]
        this.report.error('unknown-name', prop.key, `unknown parameter "${k}"`, didYouMean(k, names))
        continue
      }
      const type = this.names.params.get(k)
      if (type && type !== 'any' && typeof v !== type) {
        this.report.error('wrong-type', prop.value, `"${k}" takes ${typeWord(type)}`)
        continue
      }
      const block = known.get(k)
      const list = block && optionLiterals(block)
      if (list && !list.includes(v as never))
        this.report.error('bad-value', prop.value, `${String(v)} is not an option of "${k}"`, list.join(', '))
      const range = this.sliders.get(k)
      if (range && typeof v === 'number' && !(v >= range.min && v <= range.max))
        this.strict(STRICT_FORMULAS, 'out-of-range', prop.value, `"${k}" goes from ${range.min} to ${range.max}`)
      out[k] = v
    }
    if (!known.has('down')) {
      const down = this.named(b, 'down', [...this.domainIds.keys()], 'domain')
      if (down) out.down = down
    }
    return out
  }

  /** An `expect` line as the model takes it: names checked here, so a mistake points at its word. */
  private expectation(
    b: Block,
    scenarios: Record<string, unknown>,
    components: Map<string, Span>,
    flows: Map<string, Span>,
  ): Record<string, unknown> | undefined {
    const e: Record<string, unknown> = {}
    const label = this.text(b.args.label)
    if (label != null) e.label = label
    const scenario = this.named(b, 'scenario', Object.keys(scenarios), 'scenario')
    const component = this.named(b, 'component', [...components.keys()], 'component')
    const flow = this.named(b, 'flow', [...flows.keys()], 'flow')
    const down = this.named(b, 'down', [...this.domainIds.keys()], 'domain')
    if (scenario === null || component === null || flow === null || down === null) return undefined
    if (scenario != null) e.scenario = scenario
    if (down != null) e.down = down
    if (component != null) e.component = component
    // a flow's latency: one percentile under a time, at the values or up to underTarget
    const qs = ['p50', 'p95', 'p99'].filter((q) => b.props.has(q))
    // what is lost: a share, of one flow or of every flow, at the values or up to underTarget
    if (b.props.has('lost')) {
      for (const k of ['component', 'notFull', 'lasts', ...qs]) {
        const p = this.prop(b, k)
        if (p) this.report.error('bad-expect', p.key, `an expect on what is lost takes no ${p.key.name}`)
      }
      const v = this.constProp<number>(b, 'lost')
      // not a constant: said where it was read
      if (v == null) return undefined
      if (!(v >= 0 && v < 1)) {
        this.report.error(
          'out-of-range',
          this.prop(b, 'lost')!.value,
          'lost is a share from 0, below 100%',
          'lost: 0.1%',
        )
        return undefined
      }
      if (flow != null) e.flow = flow
      e.lost = v
    } else if (flow != null || qs.length) {
      if (flow == null) {
        this.report.error(
          'bad-expect',
          this.prop(b, qs[0]!)!.key,
          `${qs[0]} is the latency of a flow: name it`,
          'flow: orders',
        )
        return undefined
      }
      if (qs.length !== 1) {
        this.report.error('bad-expect', b.at, `the latency of "${flow}" takes one of p50, p95 or p99`, `p99: 0.5`)
        return undefined
      }
      for (const k of ['component', 'notFull']) {
        const p = this.prop(b, k)
        if (p) this.report.error('bad-expect', p.key, `an expect on the latency of "${flow}" takes no ${p.key.name}`)
      }
      const v = this.constProp<number>(b, qs[0]!)
      if (!(v != null && v > 0 && Number.isFinite(v))) {
        this.report.error('out-of-range', this.prop(b, qs[0]!)!.value, `${qs[0]} is a time in seconds above 0`)
        return undefined
      }
      e.flow = flow
      e[qs[0]!] = v
    }
    for (const k of ['underTarget', 'notFull']) {
      const v = this.constProp<number>(b, k)
      if (v == null) continue
      const p = this.prop(b, k)!
      if (!(v > 0 && Number.isFinite(v)))
        this.report.error('out-of-range', p.value, `${p.key.name} is a load multiple above 0`)
      else e[k] = v
    }
    const lasts = this.constProp<number>(b, 'lasts')
    if (lasts != null) {
      const p = this.prop(b, 'lasts')!
      if (!(lasts > 0 && Number.isFinite(lasts))) this.report.error('out-of-range', p.value, 'lasts is a time above 0')
      else if (this.prop(b, 'notFull'))
        this.report.error('bad-expect', p.key, 'lasts and notFull say one thing: give one of them')
      else if (!this.hasGrowth)
        this.report.error(
          'bad-expect',
          p.key,
          'lasts is a time: the model needs growth to turn it into a load',
          'growth { rate: 0.05; per: month; asOf: "2026-11-01" }',
        )
      else e.lasts = lasts
    }
    const severity = this.constProp<'warn' | 'fail'>(b, 'severity')
    if (severity) e.severity = severity
    if (e.flow != null || e.lost != null) return e
    if (!b.props.has('underTarget') && !b.props.has('notFull') && !b.props.has('lasts')) {
      // in the words of the definition's version: before 1.1 there are only the old names, and no ×
      const old = before(this.version, parseVersion(SCHEMA.expect!.props.underTarget!.since!)!)
      this.report.error(
        'bad-expect',
        b.at,
        old
          ? 'an expect needs a target or a full multiple'
          : before(this.version, parseVersion(SCHEMA.expect!.props.lasts!.since!)!)
            ? 'an expect needs underTarget or notFull: a load multiple'
            : 'an expect needs underTarget or notFull (a load multiple), or lasts (a time)',
        old ? 'expect { target: 8 }' : 'expect { underTarget: 8× }',
      )
      return undefined
    }
    return e.underTarget != null || e.notFull != null || e.lasts != null ? e : undefined
  }

  /** A property naming a scenario or a component: undefined when absent, null when wrong (reported). */
  private named(b: Block, key: string, known: readonly string[], what: string): string | null | undefined {
    const p = this.prop(b, key)
    if (!p) return undefined
    const v = p.value.t === 'id' ? p.value.name : p.value.t === 'str' ? p.value.value : undefined
    // a scenario by its id, written bare: the label it stands for
    const byId = what === 'scenario' && p.value.t === 'id' ? this.scenarioIds.get(p.value.name) : undefined
    if (byId != null) return byId
    const ids = what === 'scenario' ? [...this.scenarioIds.keys()] : []
    if (v == null) this.report.error('wrong-type', p.value, `${key} is the name of a ${what}`)
    else if (!known.includes(v))
      this.report.error('unknown-name', p.value, `unknown ${what} "${v}"`, didYouMean(v, [...ids, ...known]))
    else return v
    return null
  }

  /** A story step as the model takes it. */
  private step(
    b: Block,
    scenarios: Record<string, unknown>,
    components: Map<string, Span>,
    params: Block[],
    load: { min: number; max: number } | undefined,
  ): Record<string, unknown> | undefined {
    const text = this.text(b.args.label)
    // a parameter named like a step's own property cannot be set here: say so rather than read it as the property
    for (const k of Object.keys(b.spec.props)) {
      const at = b.props.get(k)?.[0]
      if (at && params.some((x) => x.args.id?.name === k))
        this.report.error(
          'bad-step',
          at.key,
          `"${k}" in a step is the step's own ${k}, not the parameter "${k}"`,
          'rename the parameter to set it in a step',
        )
    }
    const scenario = this.named(b, 'scenario', Object.keys(scenarios), 'scenario')
    const focus = this.named(b, 'focus', [...components.keys()], 'component')
    const closed = this.closed(b)
    const title = this.constProp<string>(b, 'title')
    if (title != null && !title.trim())
      this.report.error('bad-value', this.prop(b, 'title')!.value, 'a title needs a few words')
    const seconds = this.constProp<number>(b, 'seconds')
    if (seconds != null && !(seconds > 0 && Number.isFinite(seconds)))
      this.report.error('out-of-range', this.prop(b, 'seconds')!.value, 'seconds is a duration above 0')
    const set = this.preset(b, params)
    const l = this.prop(b, 'load')
    if (l && load && typeof set.load === 'number' && !(set.load >= load.min && set.load <= load.max))
      this.report.error('out-of-range', l.value, `the load goes from ${load.min} to ${load.max}`)
    if (text == null || scenario === null || focus === null) return undefined
    return {
      text,
      ...(title?.trim() ? { title } : {}),
      ...(scenario != null ? { scenario } : {}),
      ...(focus != null ? { focus } : {}),
      ...(closed ? { closed } : {}),
      ...(seconds != null && seconds > 0 ? { seconds } : {}),
      ...(Object.keys(set).length ? { set } : {}),
    }
  }

  private growth(b: Block): { rate: number; per: string; asOf: string } | undefined {
    const rate = this.constProp<number>(b, 'rate')
    const per = this.constProp<string>(b, 'per')
    const asOf = this.constProp<string>(b, 'asOf')
    if (rate != null && !(rate > 0))
      this.report.error('out-of-range', this.prop(b, 'rate')!.value, 'growth needs a rate above 0')
    if (asOf != null && !parseAsOf(asOf))
      this.report.error('bad-value', this.prop(b, 'asOf')!.value, `"${asOf}" is not a date`, 'a day like "2026-11-01"')
    if (rate == null || per == null || asOf == null) return undefined
    return { rate, per, asOf }
  }

  private fit(b: Block) {
    const id = b.args.id
    if (!id) return
    this.fits.set(id.name, null)
    const pts = b.children.filter((c) => c.keyword === 'points')
    if (pts.length !== 1) {
      this.report.error(
        'bad-fit',
        b.at,
        pts.length ? 'a fit has one points block' : 'a fit needs its points',
        usage('points'),
      )
      return
    }
    const block = pts[0]!
    const { x, y } = block.args
    if (!x || !y) return
    if (x.name === y.name) this.report.error('bad-fit', y, 'x and y need different names')
    const points: Record<string, number>[] = []
    for (const r of block.rows) {
      if (r.values.length !== 2) {
        this.report.error('bad-fit', r, `a row is two numbers: ${x.name} and ${y.name}`)
        continue
      }
      const [a, c] = r.values.map((v) => this.constant(v, 'number')) as [number, number]
      points.push({ [x.name]: a, [y.name]: c })
    }
    const source = this.constProp<string>(b, 'source')
    const through = this.constProp<'origin'>(b, 'through')
    if (this.constProp<string>(b, 'curve') === 'usl') {
      if (through)
        this.report.error('bad-fit', this.prop(b, 'through')!.key, 'a scaling curve has no idle part to drop')
      // the measures named are checked as any fit's are, then refused: a curve fits its points only
      this.fitSeries(b)
      if (this.prop(b, 'x') || this.prop(b, 'y'))
        this.report.error(
          'bad-fit',
          (this.prop(b, 'x') ?? this.prop(b, 'y'))!.key,
          'a scaling curve fits its points only',
        )
      try {
        this.fits.set(id.name, fitScaling(points, { x: x.name, y: y.name, ...(source != null ? { source } : {}) }))
      } catch (err) {
        this.report.error('bad-fit', block.at, (err as Error).message.replace(/^loadmap: /, ''))
      }
      return
    }
    try {
      const o: Parameters<typeof fitLinear>[1] = { x: x.name, y: y.name }
      if (source != null) o.source = source
      if (through) o.through = through
      const fit = fitLinear(points, o)
      this.fits.set(id.name, fit)
      const series = this.fitSeries(b)
      if (series && this.snapshot)
        this.fits.set(id.name, this.snapshot.fit(series.x, series.y, fit, through ? { through } : {}))
    } catch (err) {
      this.report.error('bad-fit', block.at, (err as Error).message.replace(/^loadmap: /, ''))
    }
  }

  /**
   * A scaling curve called with a parameter that reaches past its peak, `apiScale(pods)` with 64 pods where 44 give the
   * most: past there more pods give less, which the reader should see said rather than find.
   */
  private pastPeak(root: Block) {
    const curves = new Map<string, ScalingFit>()
    for (const [id, f] of this.fits) if (f && 'curve' in f && Number.isFinite(f.peak)) curves.set(id, f)
    if (!curves.size) return
    const top = new Map<string, number>()
    for (const [id, r] of this.sliders) top.set(id, r.max)
    for (const p of root.children.filter((c) => c.keyword === 'param')) {
      const list = optionLiterals(p)?.filter((v): v is number => typeof v === 'number')
      if (p.args.id && list?.length) top.set(p.args.id.name, Math.max(...list))
    }
    const seen = (e: Expr) => {
      if (e.t === 'call' && curves.has(e.callee.name)) {
        const arg = e.args[0]
        const f = curves.get(e.callee.name)!
        const best = bestSize(f)
        // a parameter at its largest, or a size written out
        const most = arg?.t === 'id' ? top.get(arg.name) : arg?.t === 'num' ? arg.value : undefined
        const word = arg?.t === 'id' ? `"${arg.name}" reaches` : 'the size is'
        if (arg && most != null && most > best)
          this.report.warning(
            'past-peak',
            arg,
            `${word} ${fmt(most)}, past the ${best} where ${e.callee.name} gives the most: past it more gives less`,
            `keep the size at or under ${best}, or measure past it`,
          )
      }
      for (const c of childrenOf(e, true)) seen(c)
    }
    const walk = (b: Block) => {
      for (const props of b.props.values()) for (const p of props) seen(p.value)
      for (const c of b.children) walk(c)
    }
    walk(root)
  }

  /** The measures a fit reads its series from, when it names both: its points are then the fallback. */
  private fitSeries(b: Block): { x: string; y: string } | undefined {
    const name = (k: 'x' | 'y') => {
      const p = this.prop(b, k)
      if (!p) return undefined
      if (p.value.t !== 'id' || !this.measureIds.has(p.value.name)) {
        const word = p.value.t === 'id' ? `"${p.value.name}"` : 'this'
        this.report.error(
          'unknown-name',
          p.value,
          `${word} is not a measure`,
          didYouMean(p.value.t === 'id' ? p.value.name : '', [...this.measureIds]),
        )
        return null
      }
      return p.value.name
    }
    const x = name('x')
    const y = name('y')
    if (x === undefined && y === undefined) return undefined
    if (x === undefined || y === undefined)
      this.report.error(
        'bad-fit',
        b.args.id ?? b.at,
        'a fit reads its series from two measures: x and y',
        'x: rate; y: cores',
      )
    return x && y ? { x, y } : undefined
  }

  private overload(b: Block): Overload | ((ctx: any) => Overload) | undefined {
    const rules = b.children.filter((c) => c.keyword === 'drop' || c.keyword === 'merge')
    if (!rules.length) return undefined
    const seen = new Set<string>()
    type Key = 'drop' | 'merge'
    const parts: { key: Key; when?: (c: any) => unknown; fields: [string, unknown][] }[] = []
    const props: Record<Key, readonly string[]> = { drop: ['olderThan', 'reason'], merge: ['share', 'reason'] }
    for (const r of rules) {
      const key = r.keyword as Key
      if (seen.has(key)) this.report.error('duplicate', r.at, `"${key}" is set twice in this flow`)
      seen.add(key)
      const fields: [string, unknown][] = []
      for (const k of props[key]) {
        const v = this.dynProp(r, k, k === 'reason' ? 'string' : 'number')
        if (v !== undefined) fields.push([k, v])
      }
      const when = this.prop(r, 'when')
      parts.push({ key, fields, when: when && placed(when.value, this.condition('when', when.value, 'ctx').run) })
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

  /** A flow's retry rule: it reads only the load and the parameters, since retries change every other number. */
  private retry(b: Block): RetryRule | ((values: any) => RetryRule | undefined) | undefined {
    const r = b.children.filter((c) => c.keyword === 'retry')
    if (!r.length) return undefined
    if (r.length > 1) this.report.error('duplicate', r[1]!.at, '"retry" is set twice in this flow')
    const rule = r[0]!
    const times = this.dynProp<number>(rule, 'times', 'number')
    const budget = this.dynProp<number>(rule, 'budget', 'number')
    const w = this.prop(rule, 'when')
    const when = w && placed(w.value, this.condition('when', w.value, 'values').run)
    const at = (v: any): RetryRule | undefined => {
      if (when && !when(v)) return undefined
      const out: RetryRule = { times: (typeof times === 'function' ? times(v) : times) ?? 0 }
      if (budget !== undefined) out.budget = typeof budget === 'function' ? budget(v) : budget
      return out
    }
    return !when && typeof times !== 'function' && typeof budget !== 'function' ? at(undefined) : at
  }

  private component(b: Block, flows: Map<string, Span>, box?: Block) {
    const o: Record<string, unknown> = {}
    const name = this.constProp<string>(b, 'name') ?? this.text(b.args.label) ?? this.text(box?.args.label)
    if (name == null) {
      const label = box?.args.label ?? b.args.label
      if (label) this.report.error('bad-box', label, 'a computed label cannot name the component', 'add name: "…"')
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
      ['service', 'number'],
      ['fills', 'number'],
    ] as const) {
      const prop = this.prop(b, k)
      if (!prop) continue
      if (k === 'when') {
        o.when = placed(prop.value, this.condition('when', prop.value, 'ctx').run)
        continue
      }
      const check =
        k === 'capacity'
          ? checkCapacity
          : k === 'service'
            ? (v: unknown) => {
                if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
                  throw new Error(`a service time is seconds from 0 up, not ${String(v)}`)
              }
            : undefined
      const v = this.dyn(prop.value, want, 'ctx', check)
      // the model takes demand and fills as functions only: a constant (demand: 0) becomes one
      o[k] = (k === 'demand' || k === 'fills') && v !== undefined && typeof v !== 'function' ? () => v : v
    }
    const fails = this.dynProp<number>(b, 'fails', 'number', (v) => {
      if (typeof v !== 'number' || !(v >= 0 && v < 1))
        throw new Error(`fails is a share from 0, below 100%, not ${String(v)}`)
    })
    if (fails !== undefined) o.fails = fails
    if (typeof o.demand === 'function') o.demand = this.inCapacityUnit(b, o.demand as (ctx: unknown) => number)
    if (typeof o.fills === 'function') o.fills = this.inCapacityUnit(b, o.fills as (ctx: unknown) => number, 'fills')
    const keeps = this.prop(b, 'keeps')
    if (keeps)
      o.keeps = this.dyn(keeps.value, 'number', 'values', (v) => {
        if (typeof v !== 'number' || !(v >= 0 && Number.isFinite(v)))
          throw new Error(`a stock keeps seconds from 0 up, not ${String(v)}`)
      })
    const level = this.prop(b, 'level')
    if (level) {
      o.level = this.dyn(level.value, 'capacity', 'values', checkCapacity)
      const said = capacityCall(level.value, this.unitNames)?.args[1]
      const cap = this.prop(b, 'capacity')
      const unit = cap && capacityCall(cap.value, this.unitNames)?.args[1]
      if (said?.t === 'str' && unit?.t === 'str' && said.value.trim() !== unit.value.trim())
        this.report.error(
          'unit-mismatch',
          said,
          `the level is in "${said.value}", the capacity in "${unit.value}"`,
          'give both one unit',
        )
    }
    for (const k of ['keeps', 'level'] as const) {
      const p = this.prop(b, k)
      if (p && !this.prop(b, 'fills'))
        this.report.error(
          'missing-property',
          p.key,
          `${k} is a stock's: give it fills too`,
          COMPONENT_PROPS.fills!.doc,
          {
            key: 'fills',
          },
        )
    }
    if (keeps && level)
      this.report.error('bad-box', level.key, 'a stock keeps what it gains or grows from a level: drop one of them')
    const run = b.children.find((c) => c.keyword === 'runs')
    if (run) {
      const time = (v: unknown) => {
        if (typeof v !== 'number' || !(v > 0 && Number.isFinite(v)))
          throw new Error(`a run's time is seconds above 0, not ${String(v)}`)
      }
      const every = this.dynProp<number>(run, 'every', 'number', time)
      const within = this.dynProp<number>(run, 'within', 'number', time)
      if (typeof every === 'number' && typeof within === 'number' && within > every)
        this.report.error(
          'out-of-range',
          this.prop(run, 'within')!.value,
          'a run takes at most the time between two runs: within is at most every',
        )
      else if (every !== undefined && within !== undefined) {
        const at = (v: unknown) => ({
          every: typeof every === 'function' ? every(v) : every,
          within: typeof within === 'function' ? within(v) : within,
        })
        o.runs = typeof every === 'number' && typeof within === 'number' ? { every, within } : at
      }
    }
    const held = this.held(b, flows)
    if (held !== undefined) o.held = held
    if (held !== undefined || this.prop(b, 'through')) {
      const demand = this.prop(b, 'demand')
      if (demand)
        this.report.error('bad-box', demand.key, 'a component that is held works out its demand: drop one of them')
    }
    const at = box ? (box.args.id ?? box.at) : b.at
    const missing = ['capacity', 'over'].filter((k) => !(k in o) && !this.written(b, k))
    // none of the lines that make one: the box was not meant as a component
    const nested = b.children.some((c) => c.keyword === 'component')
    if (b === box && !nested && missing.length === 2 && !('demand' in o)) {
      // its own component carries the box's id
      this.plainBoxes.add(b.args.id!.name)
      this.plainBox(b)
      return o
    }
    // without a demand line the component handles what reaches its stages: checked once the stages are known
    for (const k of missing)
      this.report.error('missing-property', at, `the component needs "${k}: …"`, COMPONENT_PROPS[k]!.doc, {
        key: k,
      })
    return o
  }

  /** How long a unit holds one of the component's slots: `held: 0.02` for every flow, or `held { orders: 0.02 }`. */
  private held(b: Block, flows: Map<string, Span>) {
    const prop = this.prop(b, 'held')
    const block = b.children.find((c) => c.keyword === 'held')
    if (prop && block)
      this.report.error(
        'duplicate',
        block.at,
        'held is set twice',
        'held: 0.02 for every flow, or a held block per flow',
      )
    const time = (v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
        throw new Error(`a time held is seconds from 0 up, not ${String(v)}`)
    }
    if (prop) return this.dyn<number>(prop.value, 'number', 'ctx', time)
    if (!block) return undefined
    const entries: [string, number | ((c: any) => number)][] = []
    for (const [f, props] of block.props) {
      const p = props[0]!
      if (!flows.has(f)) {
        this.report.error('unknown-name', p.key, `unknown flow "${f}"`, didYouMean(f, flows.keys()))
        continue
      }
      entries.push([f, this.dyn<number>(p.value, 'number', 'ctx', time)])
    }
    const at = (ctx: any): Record<string, number> =>
      Object.fromEntries(entries.map(([k, v]) => [k, typeof v === 'function' ? v(ctx) : v]))
    return entries.every(([, v]) => typeof v === 'number') ? at(undefined) : at
  }

  private stage(
    b: Block,
    box: Box,
    components: Map<string, Span>,
    resolve: (n: Ident, what: string) => string | undefined,
    flows: Map<string, Span>,
    reached: Set<string>,
    id: string,
  ): StageDef | undefined {
    const label = this.text(b.args.label)
    const base = label != null ? { label } : {}
    let component = box.component?.id
    const named = this.prop(b, 'component')
    if (named) {
      const n = named.value
      if (n.t === 'id' && components.has(n.name)) component = n.name
      else
        this.report.error(
          'unknown-name',
          n,
          `unknown component "${this.slice(n)}"`,
          didYouMean(this.slice(n), components.keys()),
        )
    }
    const needs = () => {
      this.report.error(
        'missing-part',
        b.at,
        `a ${b.keyword} stage needs a component`,
        'give the box demand and capacity lines, or name one: component: db',
      )
      return undefined
    }
    switch (b.keyword) {
      case 'pass': {
        const shed = this.constProp<'even' | 'priority'>(b, 'shed')
        return component ? pass(component, { ...base, ...(shed ? { shed } : {}) }) : needs()
      }
      case 'limit': {
        const per = this.constProp<'hour' | 'day' | 'month'>(b, 'per')
        if (per && component) this.windowed.set(component, per)
        return component ? limit(component, { ...base, ...(per ? { per } : {}) }) : needs()
      }
      case 'cache': {
        const hit = this.dynProp<number>(b, 'hit', 'number')
        return cache({ ...base, hit: hit ?? 0, ...(component ? { component } : {}) })
      }
      case 'store':
        return component ? store(component, base) : needs()
      case 'sink':
        return sink(base)
      case 'lost': {
        const p = this.prop(b, 'takes')
        const takes = p && this.words(p, SCHEMA.lost!.props.takes!)
        // what feeds it comes from the edges into its box, once every stage is known
        return lost({ ...base, from: [], ...(takes ? { takes: takes as Loss[] } : {}) })
      }
      case 'workers': {
        if (!component) return needs()
        const perPod = this.dynProp<number>(b, 'perPod', 'number', this.count('perPod'))
        const placement = this.constProp<'round-robin' | 'in-order'>(b, 'placement')
        const rest = { ...base, perPod: perPod ?? 0, ...(placement ? { placement } : {}) }
        if (b.pool && !this.prop(b, 'perPod'))
          this.report.error('missing-property', b.at, '"pool" needs "perPod: …"', 'Workers per pod.', { key: 'perPod' })
        const scale = b.children.find((c) => c.keyword === 'autoscale')
        if (scale) {
          if (this.prop(b, 'pods'))
            this.report.error(
              'bad-box',
              this.prop(b, 'pods')!.key,
              'an autoscaled pool has no fixed pods',
              'leave out pods',
            )
          const min = this.dynProp<number>(scale, 'min', 'number') ?? 1
          // max is the pods drawn: the same bound as pods
          const max = this.dynProp<number>(scale, 'max', 'number', this.count('pods')) ?? 1
          const target = this.dynProp<number>(scale, 'target', 'number') ?? 1
          return workers(component, { ...rest, autoscale: { min, max, target } })
        }
        const pods = this.dynProp<number>(b, 'pods', 'number', this.count('pods'))
        if (!this.prop(b, 'pods'))
          this.report.error(
            'missing-part',
            b.at,
            b.pool ? 'a pool needs pods, or autoscale' : 'a workers stage needs pods, or autoscale',
            'pods: 3, or autoscale { min: 2; max: 10; target: 0.7 }',
          )
        return workers(component, { ...rest, pods: pods ?? 0 })
      }
      case 'queue': {
        const block = b.children.find((c) => c.keyword === 'partitions')
        if (!block) {
          this.report.error('missing-part', b.at, 'a queue needs its partitions', 'partitions { orders: 12 }')
          return undefined
        }
        const entries: [string, number | ((c: any) => number)][] = []
        for (const [f, props] of block.props) {
          const prop = props[0]!
          if (!flows.has(f)) {
            this.report.error('unknown-name', prop.key, `unknown flow "${f}"`, didYouMean(f, flows.keys()))
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
            this.report.error('bad-route', e, 'a branch is one "flow -> stage: copies" line')
            continue
          }
          const [f, s] = e.chain as [Ident, Ident]
          if (!flows.has(f.name))
            this.report.error('unknown-name', f, `unknown flow "${f.name}"`, didYouMean(f.name, flows.keys()))
          const stage = resolve(s, 'stage')
          if (stage) reached.add(stage)
          if (stage) this.branchAt.set(`${f.name}\u0000${stage}`, e)
          if (e.colon) {
            this.report.error(
              'bad-route',
              e.colon,
              'a branch takes its copies after ":", not a block',
              `${f.name} -> ${s.name}: 1`,
            )
            continue
          }
          if (!e.value) this.report.error('bad-route', e, 'how many copies per unit?', `${f.name} -> ${s.name}: 1`)
          if (e.body) this.report.error('bad-route', e.bodySpan ?? e, 'a branch has no block')
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
        // out.<stage>: what reaches it of each flow, times that branch's copies
        const sent = this.sent.get(id)
        if (sent)
          sent.run = (ctx) =>
            branches.reduce(
              (sum, [f, , share]) => sum + ctx.at[id][f] * (typeof share === 'function' ? share(ctx) : share),
              0,
            )
        const fixed = branches.every(([, , v]) => typeof v === 'number')
        return fanout({ ...base, to: fixed ? build(undefined) : build, ...(component ? { component } : {}) })
      }
      case 'split': {
        const ways: [string, string[], number | ((c: any) => number), Edge][] = []
        // a flow with a way that did not compile has its error already: its shares are not added up
        const broken = new Set<string>()
        for (const e of b.edges) {
          if (e.chain.length < 2) {
            this.report.error('bad-route', e, 'a way is one "flow -> stage -> …: share" line')
            continue
          }
          const [f, ...through] = e.chain as [Ident, ...Ident[]]
          if (!flows.has(f.name))
            this.report.error('unknown-name', f, `unknown flow "${f.name}"`, didYouMean(f.name, flows.keys()))
          const stages = through.map((n) => resolve(n, 'stage'))
          for (const s of stages) if (s) reached.add(s)
          if (stages.every((s) => s)) this.wayAt.push({ split: id, flow: f.name, stages: stages as string[], at: e })
          if (e.colon) {
            broken.add(f.name)
            this.report.error(
              'bad-route',
              e.colon,
              'a way takes its share after ":", not a block',
              `${f.name} -> ${through[0]!.name}: 0.5`,
            )
            continue
          }
          if (!e.value)
            this.report.error(
              'bad-route',
              e,
              'what share of the flow goes this way?',
              `${f.name} -> ${through[0]!.name}: 0.5`,
            )
          if (e.body) this.report.error('bad-route', e.bodySpan ?? e, 'a way has no block')
          if (e.value && flows.has(f.name) && stages.every((s) => s))
            ways.push([f.name, stages as string[], this.dyn<number>(e.value, 'number'), e])
          else broken.add(f.name)
        }
        const build = (ctx: any) => {
          const to: Record<string, SplitBranch[]> = {}
          for (const [f, stages, share] of ways) {
            const list = to[f] ?? []
            list.push({ stages, share: typeof share === 'function' ? share(ctx) : share })
            to[f] = list
          }
          return to
        }
        const fixed = ways.every(([, , v]) => typeof v === 'number')
        if (fixed)
          // shares written as numbers are checked now; formulas when the model runs
          for (const [f, list] of Object.entries(build(undefined))) {
            const sum = list.reduce((a, w) => a + w.share, 0)
            if (!broken.has(f) && Math.abs(sum - 1) > 1e-9) {
              const first = ways.find(([g]) => g === f)![3]
              this.report.error(
                'bad-route',
                first,
                `the shares of "${f}" add up to ${Math.round(sum * 1000) / 1000}, not 1`,
                'every unit goes one way',
              )
            }
          }
        return split({ ...base, to: fixed ? build(undefined) : build, ...(component ? { component } : {}) })
      }
    }
    return undefined
  }

  // -- view ----------------------------------------------------------------------------------------------------

  private node(box: Box): AnyNodeDef {
    const b = box.block
    const label = this.label(b.args.label) ?? box.id
    const subProp = this.prop(b, 'sub')
    if (subProp && b.args.sub)
      this.report.error('duplicate', subProp.key, 'the sub-line is set twice: on the first line and here')
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
    if (e.colon)
      this.report.error(
        'colon-before-block',
        e.colon,
        'drop the ":" before a { … } block',
        `${e.chain.map((c) => c.name).join(' -> ')}${e.chain.length > 2 ? '' : ': "…"'} { when: … }`,
      )
    for (const n of e.chain)
      if (!boxes.has(n.name))
        this.report.error('unknown-name', n, `unknown node "${n.name}"`, didYouMean(n.name, boxes.keys()))
    const props = new Map<string, Property>()
    // what its version's edge holds: `label` too, before 1.5
    const version = this.versionOf(e.chain[0]!)
    const held = Object.entries(EDGE_PROPS)
      .filter(([, p]) => !p.until || before(version, parseVersion(p.until)!))
      .filter(([, p]) => !p.since || !before(version, parseVersion(p.since)!))
      .map(([k]) => k)
    for (const s of e.body ?? []) {
      if (s.kind !== 'prop' || !own(EDGE_PROPS, s.key.name)) {
        const at = s.kind === 'prop' ? s.key : s.kind === 'decl' ? s.keyword : s
        this.report.error(
          'unknown-property',
          at,
          `an edge holds only ${held.join(' and ')}`,
          didYouMean(this.slice(at), held),
        )
        continue
      }
      const gone = own(EDGE_PROPS, s.key.name)!
      if (gone.until)
        this.removed(gone, s.key, `"${s.key.name}" is no longer a property of an edge`, { gone: s.key.name, in: '->' })
      if (props.has(s.key.name)) this.report.error('duplicate', s.key, `"${s.key.name}" is set twice on this edge`)
      props.set(s.key.name, s)
    }
    const labelExpr = e.value ?? props.get('label')?.value
    if (e.value && props.has('label')) this.report.error('duplicate', props.get('label')!.key, 'the label is set twice')
    if (labelExpr && e.chain.length > 2)
      this.report.error('bad-edge', labelExpr, 'a label goes on a single edge: a -> b: "…"')
    const written = this.label(labelExpr)
    const when = props.get('when')
    const wait = props.get('delay')
    if (wait && e.chain.length > 2)
      this.report.error('bad-edge', wait.key, 'a delay goes on a single edge: a -> b { … }')
    const delay =
      wait && e.chain.length === 2
        ? this.dyn<number>(wait.value, 'number', 'values', (v) => {
            if (typeof v !== 'number' || !(v >= 0 && Number.isFinite(v)))
              throw new Error(`a delay is seconds from 0 up, not ${String(v)}`)
          })
        : undefined
    if (delay !== undefined) this.delays.push({ from: e.chain[0]!.name, to: e.chain[1]!.name, delay, at: wait!.key })
    // the edge says its delay after its label: "HTTPS · 80 ms"
    const said = (l: string | undefined, s: number) => (l ? `${l} · ${duration(s)}` : duration(s))
    const label =
      delay === undefined
        ? written
        : typeof delay === 'number' && typeof written !== 'function'
          ? said(written, delay)
          : (ctx: any) =>
              said(
                typeof written === 'function' ? written(ctx) : written,
                typeof delay === 'number' ? delay : delay(ctx),
              )
    const out: EdgeDef[] = []
    for (let i = 0; i + 1 < e.chain.length; i++) {
      const d: EdgeDef = { from: e.chain[i]!.name, to: e.chain[i + 1]!.name }
      if (label != null) d.label = label
      if (when) {
        d.when = placed(when.value, this.condition('when', when.value, 'ctx').run)
        this.whenAt.set(d, when.key)
      }
      out.push(d)
    }
    return out
  }
}

/** A select's options as written, a computed one undefined; undefined for a parameter without a list of options. */
function optionLiterals(b: Block): (number | string | undefined)[] | undefined {
  const items = b.props.get('options')?.[0]?.value
  return items?.t === 'array'
    ? items.items.map((e) => (e.t === 'num' || e.t === 'str' ? e.value : undefined))
    : undefined
}

const FORBIDDEN = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
// hex of 3, 4, 6 or 8 digits, or rgb() and hsl() with three numbers and an alpha: nothing a paint would fetch
const CSS_COLOR =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\(\s*([+-]?[\d.]+%?(\s*,\s*|\s+)){2}[+-]?[\d.]+%?(\s*[,/]\s*[\d.]+%?)?\s*\))$/i

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
