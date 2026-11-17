import { childrenOf, type Decl, type Edge, type Expr, type Ident, type Property, type Stmt } from './ast'
import { didYouMean, type Reporter, type Span } from './diagnostics'
import { BUILTINS, RESERVED } from './expr'
import { type NameVisitor, walkFormula, walkNames } from './names'
import { BOXES, COMPONENT_PROPS, own, POOL_LINES, propNamed, SCHEMA, STAGES } from './schema'

/** Subsystems inside subsystems, this deep at most, and this many boxes in one definition once they are written out. */
export const MAX_NESTING = 4
export const MAX_BOXES = 256

/**
 * Where a statement is read: the model (with its parts), or one library. A name means what its own file says it
 * means, wherever the statement ends up.
 */
export interface Env {
  /** Undefined in the model. */
  library?: {
    path: string
    /**
     * The id, in the model, of a value this library declares or imports (a let, a fit, a measure, a published figure;
     * a metric; a tier), brought along on first use. Undefined when the library has no such name.
     */
    value(name: string, space: 'formula' | 'metric' | 'tier'): string | undefined
  }
  /** A box or a subsystem by the name this file knows it under: its own, or an imported one. */
  template(name: string): Template | undefined
  templates(): Iterable<string>
}

export interface Template {
  decl: Decl
  /** The file it is written in. */
  env: Env
}

/** An input set with a formula, and the default it stands in for. */
export interface InputCheck {
  input: string
  default: Expr
  value: Expr
}

const LITERAL = new Set(['num', 'bool', 'str', 'tpl'])

/** A name a library's own file settled: nothing renames it again further out. */
const DONE = '$settled'
type Node = Span & { name?: string; t?: string; [DONE]?: true }

const isBox = (s: Stmt): s is Decl => s.kind === 'decl' && (BOXES as readonly string[]).includes(s.keyword.name)
const isInput = (s: Stmt): s is Decl => s.kind === 'decl' && s.keyword.name === 'input'
const isWith = (s: Stmt): s is Decl => s.kind === 'decl' && s.keyword.name === 'with'
const idOf = (d: Decl) => (d.args[0]?.t === 'id' ? d.args[0].name : undefined)
const propOf = (d: Decl, key: string) => d.body?.find((st): st is Property => st.kind === 'prop' && st.key.name === key)

/** A copy all the way down: a rewrite never touches what the text parsed to. */
function clone<T>(node: T): T {
  if (Array.isArray(node)) return node.map(clone) as T
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) out[k] = clone(v)
  return out as T
}

/** The tables a box's own lines read it through: its stage (`at`, `out`) and its component (`demand`, `util`). */
const SELF_TABLES = new Set(['at', 'out', 'demand', 'util'])

/**
 * A statement with every `at.<from>`, `out.<from>`, `demand.<from>` and `util.<from>` in its formulas naming `to`: a
 * copy, the statement itself is left as the text has it.
 */
export function renamed<T>(node: T, from: string, to: string): T {
  if (Array.isArray(node)) return node.map((x) => renamed(x, from, to)) as T
  if (node === null || typeof node !== 'object') return node
  const o = node as Record<string, unknown>
  const table = o.t === 'member' ? (o.object as Ident).name : undefined
  if (table && SELF_TABLES.has(table) && (o.prop as Ident).name === from)
    return { ...o, prop: { ...(o.prop as Ident), name: to } } as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = renamed(v, from, to)
  return out as T
}

/** What an input was given: a formula of the file that set it, or the name of a flow there. */
type Given = { kind: 'value'; value: Expr } | { kind: 'flow'; name: string }

/** A subsystem's route: the stages a flow passes when its route names the subsystem, and the boxes its edges end at. */
interface Path {
  stages: Ident[]
  entry?: string
  exit?: string
}

/** What a subsystem holds, written out, in the names of the file that asked for it. */
interface Content {
  stmts: Stmt[]
  inputs: Decl[]
  /** Its name on the board: its own, else that of the subsystem it is like. */
  label?: Expr
}

/**
 * Writes out every `like` and every subsystem, on the statements, before anything reads them: the rest of the compiler
 * sees boxes written in full, each with its own id, and never learns that some came from another file.
 */
export class Expander {
  /**
   * Each input a box of the model set with a formula, beside its default: the compiler, which knows the model's
   * names, checks that the two are one type and one unit.
   */
  readonly checks: InputCheck[] = []
  private boxes = 0
  private tooMany = false
  /** The boxes of a loop of `like`s, said once: each is then left as it is written. */
  private looped = new Set<Decl>()

  constructor(
    readonly report: Reporter,
    /** The functions the host page gave: names a library may call. */
    private readonly hosted: ReadonlySet<string> = new Set(),
  ) {}

  /** The statements of a file's top with its boxes and subsystems written out, then the names that reach into them. */
  top(stmts: readonly Stmt[], env: Env): Stmt[] {
    const out = this.body(stmts, env, 0)
    stageNames(out)
    return out
  }

  /** The statements of a file's top, or of a subsystem, with every `like` and every subsystem in them written out. */
  body(stmts: readonly Stmt[], env: Env, depth: number, keyword = ''): Stmt[] {
    const out: Stmt[] = []
    const paths = new Map<string, Path>()
    for (const s of stmts) {
      // by its keyword: a guard that says "a box" would leave no statement for the lines after it
      const d = s.kind === 'decl' ? s : undefined
      const k = d?.keyword.name
      // past the most boxes a definition has, nothing more is written out: a few lines must not make millions
      if (this.tooMany && d && (k === 'subsystem' || (BOXES as readonly string[]).includes(k!))) continue
      if (d && (BOXES as readonly string[]).includes(k!)) {
        out.push(this.box(d, env, []))
        this.count(d.keyword)
      } else if (d && k === 'subsystem') out.push(...this.subsystem(d, env, depth, paths))
      else if (d && (k === 'input' || k === 'with'))
        this.report.error(
          'misplaced',
          d.keyword,
          k === 'input'
            ? 'an input goes in a box or a subsystem of a library'
            : '"with" goes in the box or the subsystem that is like another',
        )
      else out.push(s)
    }
    return paths.size ? through(out, paths, this.report, keyword) : out
  }

  private count(at: Span) {
    if (++this.boxes <= MAX_BOXES || this.tooMany) return
    this.tooMany = true
    this.report.error('too-large', at, `a definition has at most ${MAX_BOXES} boxes, its subsystems written out`)
  }

  /**
   * `like: db`: the box takes every line and stage of `db` it does not write itself. A line here replaces the same line
   * there, and a stage here replaces its stages. `db` is a box of this file, or a prototype a library gave: its inputs
   * are then set in `with { … }`.
   */
  private box(d: Decl, env: Env, trail: readonly Decl[]): Decl {
    const like = propOf(d, 'like')
    const withs = (d.body ?? []).filter(isWith)
    const inputs = (d.body ?? []).filter(isInput)
    // a box written out as itself has no inputs; one another box is like keeps them, for that box to set
    const drawn = trail.length === 0
    if (drawn)
      for (const i of inputs)
        this.report.error(
          'misplaced',
          i.keyword,
          env.library
            ? 'an input goes at the top of the subsystem'
            : 'an input goes in a box or a subsystem of a library',
        )
    const stripped =
      withs.length || (drawn && inputs.length)
        ? { ...d, body: (d.body ?? []).filter((s) => !isWith(s) && !(drawn && isInput(s))) }
        : { ...d, body: d.body ?? [] }
    if (!like) {
      for (const w of withs)
        this.report.error('misplaced', w.keyword, '"with" sets the inputs of the box this one is like')
      return withs.length || (drawn && inputs.length) ? stripped : d
    }
    const self = idOf(d) ?? ''
    if (this.looped.has(d)) return stripped
    const name = like.value.t === 'id' ? like.value.name : undefined
    const found = name == null ? undefined : env.template(name)
    if (name == null || !found) {
      const text = this.report.source.slice(like.value.from, like.value.to)
      this.report.error('unknown-name', like.value, `unknown box "${text}"`, didYouMean(text, env.templates()))
      return stripped
    }
    const proto = found.decl
    if (proto === d || trail.includes(proto)) {
      const loop = [...trail.map((t) => idOf(t) ?? ''), self, name].filter(Boolean).join(' → ')
      this.report.error('bad-box', like.value, `a box cannot be like itself: ${loop}`)
      for (const t of [...trail, d]) this.looped.add(t)
      return stripped
    }
    if (proto.keyword.name !== d.keyword.name) {
      this.report.error(
        'bad-box',
        like.value,
        `a ${d.keyword.name} is like another ${d.keyword.name}: "${name}" is a ${proto.keyword.name}`,
      )
      return stripped
    }
    // the other box in full, in its own file's names, its inputs still open
    const base = this.box(proto, found.env, [...trail, d])
    const theirs = (base.body ?? []).filter(isInput)
    const rest = (base.body ?? []).filter((s) => !isInput(s))
    const given = this.given(d, withs, theirs, found.env, `"${name}"`, env)
    const settled = theirs.length || found.env !== env ? this.settle(rest, proto.keyword.name, found.env, given) : rest
    const mine = stripped.body
    // a pool that writes its workers on itself (1.5) like one that wrote them in a block: the block's lines are pool
    // lines, so a line written here replaces the same line there
    const direct = mine.some(
      (st) =>
        (st.kind === 'prop' && POOL_LINES.includes(st.key.name)) ||
        (st.kind === 'decl' && st.keyword.name === 'autoscale'),
    )
    const lines = direct && proto.keyword.name === 'pool' ? settled.flatMap(poolLines) : settled
    const props = new Set(mine.flatMap((st) => (st.kind === 'prop' ? [st.key.name] : [])))
    const kinds = new Set(mine.flatMap((st) => (st.kind === 'decl' ? [st.keyword.name] : [])))
    const stages: readonly string[] = STAGES
    const ownStage = [...kinds].some((k) => stages.includes(k))
    // a pool's pods are fixed or autoscaled: either written here replaces the other there
    const scaled = (st: Stmt) =>
      (st.kind === 'prop' && st.key.name === 'pods' && kinds.has('autoscale')) ||
      (st.kind === 'decl' && st.keyword.name === 'autoscale' && props.has('pods'))
    const taken = lines.filter((st) =>
      scaled(st)
        ? false
        : st.kind === 'prop'
          ? st.key.name !== 'like' && !props.has(st.key.name)
          : st.kind !== 'decl' || !(kinds.has(st.keyword.name) || (ownStage && stages.includes(st.keyword.name))),
    )
    // an id of its own on a stage or a component there would be declared again here
    const named = taken.find((st): st is Decl => st.kind === 'decl' && st.args[0]?.t === 'id')
    if (named) {
      const id = (named.args[0] as Ident).name
      this.report.error(
        'bad-box',
        like.value,
        `"${name}" names its ${named.keyword.name} "${id}": a box like it would declare "${id}" again`,
        `write the ${named.keyword.name} here too, with an id of its own, or make "${name}" a subsystem`,
      )
      return stripped
    }
    // a line taken that reads the other box by its name (at.db.orders, out.push) reads this one here
    const theirName = idOf(proto) ?? name
    // written in full now: it is like nothing any more
    const own = mine.filter((st) => !(st.kind === 'prop' && st.key.name === 'like'))
    return { ...stripped, body: [...taken.map((st) => renamed(st, theirName, self)), ...own] }
  }

  /**
   * What each input of a prototype or a subsystem is given: the value in `with`, else its default, each checked
   * against the other. An input left open, set twice or not there is said at the box that is like it.
   */
  private given(
    d: Decl,
    withs: readonly Decl[],
    inputs: readonly Decl[],
    theirs: Env,
    what: string,
    /** Where the box that sets them is written. */
    here: Env,
  ): Map<string, Given> {
    const out = new Map<string, Given>()
    const set = new Map<string, Property>()
    for (const w of withs.slice(1)) this.report.error('duplicate', w.keyword, 'one "with" block is enough')
    for (const st of withs[0]?.body ?? []) {
      if (st.kind !== 'prop') {
        this.report.error('syntax', st, 'a "with" block holds "input: value" lines')
        continue
      }
      if (set.has(st.key.name)) this.report.error('duplicate', st.key, `"${st.key.name}" is set twice`)
      set.set(st.key.name, st)
    }
    const names = new Map<string, Decl>()
    for (const i of inputs) {
      const [first, second] = i.args
      const flow = first?.t === 'id' && first.name === 'flow' && second?.t === 'id'
      const id = flow ? (second as Ident & { t: 'id' }).name : first?.t === 'id' ? first.name : undefined
      if (id == null) continue
      names.set(id, i)
      const value = set.get(id)
      if (flow) {
        if (i.init) this.report.error('bad-input', i.init, 'a flow input has no default: the model says which flow')
        if (value?.value.t === 'id') out.set(id, { kind: 'flow', name: value.value.name })
        else if (value) this.report.error('bad-input', value.value, `"${id}" takes the name of a flow`)
        else
          this.report.error(
            'bad-input',
            withs[0]?.keyword ?? d.keyword,
            `${what} needs its flow "${id}"`,
            `with { ${id}: … }`,
            { input: id },
          )
        continue
      }
      if (value) {
        this.fits(i, value)
        // a formula of the model against the default: said once the model's names are known
        if (i.init && !here.library && !(LITERAL.has(i.init.t) && LITERAL.has(value.value.t))) {
          // the default as the library means it: its own names by their ids in the model
          const init = clone(i.init)
          this.settleFormula(init, theirs)
          this.checks.push({ input: id, default: init, value: value.value })
        }
        out.set(id, { kind: 'value', value: value.value })
      } else if (i.init) {
        // the default is the library's own formula: its names are settled there
        const init = clone(i.init)
        this.settleFormula(init, theirs)
        out.set(id, { kind: 'value', value: init })
      } else
        this.report.error(
          'bad-input',
          withs[0]?.keyword ?? d.keyword,
          `${what} needs its input "${id}"`,
          `with { ${id}: … }`,
          { input: id },
        )
    }
    for (const [k, p] of set)
      if (!names.has(k))
        this.report.error(
          'bad-input',
          p.key,
          names.size ? `${what} has no input "${k}"` : `${what} has no inputs`,
          didYouMean(k, names.keys()),
        )
    return out
  }

  /** A value against its input's default, where both say what they are: a text for a number, 5s for a share. */
  private fits(input: Decl, value: Property) {
    const [d, v] = [input.init, value.value]
    if (!d) return
    const kind = (e: Expr) =>
      e.t === 'num'
        ? 'a number'
        : e.t === 'bool'
          ? 'true or false'
          : e.t === 'str' || e.t === 'tpl'
            ? 'a text'
            : undefined
    const [want, got] = [kind(d), kind(v)]
    const id = (input.args[0] as Ident).name
    if (want && got && want !== got) {
      this.report.error('wrong-type', v, `"${id}" takes ${want}, as its default is; this is ${got}`)
      return
    }
    if (d.t !== 'num' || v.t !== 'num') return
    const unit = (u: string | undefined) =>
      u == null
        ? undefined
        : u === '%'
          ? 'a share'
          : u === '×' || u === 'x'
            ? 'a load multiple'
            : /^(ms|s|min|h)$/.test(u)
              ? 'a time'
              : 'a size'
    const [du, vu] = [unit(d.unit), unit(v.unit)]
    if (du && vu && du !== vu)
      this.report.warning(
        'unit-mismatch',
        v,
        `"${id}" is ${du} (its default is ${this.report.source.slice(d.from, d.to)}); this is ${vu}`,
      )
  }

  /** Statements of a library's top (a let, a fit, a measure) with their names settled, as the model takes them. */
  settled(stmts: readonly Stmt[], env: Env): Stmt[] {
    return this.settle(stmts, '', env, new Map())
  }

  /** A formula of a library with its names settled: the library's values by their id in the model. */
  private settleFormula(e: Expr, env: Env) {
    if (!env.library) return
    walkFormula(e, this.settler(env, new Map(), []))
  }

  /**
   * The lines of a prototype as the box that is like it takes them: each input replaced by the formula it was given,
   * each name of the library by its id in the model. Copies; what a library reads beyond its inputs and its own names
   * is an error in the library.
   */
  private settle(stmts: readonly Stmt[], keyword: string, env: Env, given: ReadonlyMap<string, Given>): Stmt[] {
    const out = clone(stmts) as Stmt[]
    const swaps: [Node, Expr][] = []
    const spec = own(SCHEMA, keyword) ?? SCHEMA['']!
    // the lets a subsystem declares are its own names, not its library's
    const inner = new Set<string>()
    walkNames(out, spec, (space, _node, name, decl) => {
      if (decl && space === 'formula') inner.add(name)
    })
    walkNames(out, spec, this.settler(env, given, swaps, inner))
    for (const [node, value] of swaps) {
      for (const k of Object.keys(node)) delete (node as unknown as Record<string, unknown>)[k]
      Object.assign(node, clone(value))
    }
    chains(out)
    return out
  }

  private settler(
    env: Env,
    given: ReadonlyMap<string, Given>,
    swaps: [Node, Expr][],
    inner?: ReadonlySet<string>,
  ): NameVisitor {
    const lib = env.library
    // the flows handed on to a subsystem inside (`with { main: main }`): named once, not read again as a value
    const handed = new Set<object>()
    return (space, raw, name, decl, _quoted, loose) => {
      const node = raw as Node
      if (node[DONE] || node.name == null || handed.has(node)) return
      if (space === 'formula') {
        const g = given.get(name)
        if (g?.kind === 'value' && !decl) {
          if (node.t === 'id') swaps.push([node, g.value])
          else
            this.report.error(
              'bad-input',
              node,
              `the input "${name}" is a value: it cannot be called or read as a table`,
            )
          return
        }
        if (inner?.has(name) || decl || !lib) return
        const id = lib.value(name, 'formula')
        if (id != null) node.name = id
        else if (
          !(own(BUILTINS, name) || RESERVED.has(name) || this.hosted.has(name) || name === 'i' || name === 'value')
        )
          this.report.error(
            'unknown-name',
            node,
            name === 'load'
              ? 'a library does not read the load: take what depends on it as an input'
              : `unknown name "${name}": a library reads its inputs and its own names`,
            `take it in: input ${name}`,
          )
        node[DONE] = true
      } else if (space === 'flow') {
        const g = given.get(name)
        if (g?.kind === 'flow') {
          node.name = g.name
          if (loose) handed.add(node)
        } else if (lib && !decl && !loose) {
          this.report.error('wrong-scope', node, `a library names no flow of a model: take it as "input flow ${name}"`)
          node[DONE] = true
        }
      } else if ((space === 'tier' || space === 'metric') && lib && !decl) {
        const id = lib.value(name, space)
        if (id != null) {
          node.name = id
          node[DONE] = true
        }
      }
    }
  }

  /**
   * A subsystem written out: its boxes, components, connections, edges and lets as statements of the place it stands
   * in, each named `<id>.<name>`. Its route, when it has one, is kept for the routes and edges that name the subsystem.
   * What stays of it is its first line, `subsystem <id> "<name>"` with no block: the frame the board draws around the
   * boxes named `<id>.…`. A flat copy of a model (`loadmap bundle`) holds that line, and it is read back as it stands.
   */
  private subsystem(d: Decl, env: Env, depth: number, paths: Map<string, Path>): Stmt[] {
    const self = idOf(d)
    if (self == null) {
      this.report.error('missing-part', d.keyword, '"subsystem" needs its id', 'subsystem orderLine "Orders" { … }')
      return []
    }
    if (depth >= MAX_NESTING) {
      this.report.error('too-large', d.keyword, `subsystems nest at most ${MAX_NESTING} deep`)
      return []
    }
    if (!d.body) {
      paths.set(self, { stages: [] })
      return [clone(d)]
    }
    const content = this.content(d, env, depth, [])
    if (!content) return []
    for (const i of content.inputs)
      this.report.error(
        'misplaced',
        i.keyword,
        env.library
          ? 'an input goes at the top of a subsystem of a library'
          : 'an input goes in a subsystem of a library',
      )
    const stmts = content.stmts
    // every name it declares, as it is known outside: its lets, and its boxes with their stages and components
    const lets = new Set<string>()
    const ids = new Set<string>()
    walkNames(stmts, SCHEMA.subsystem!, (space, _node, name, decl) => {
      if (!decl) return
      if (space === 'formula') lets.add(name)
      else if (space === 'node' || space === 'stage' || space === 'component' || space === 'connection') ids.add(name)
    })
    walkNames(stmts, SCHEMA.subsystem!, (space, raw, name) => {
      const node = raw as Node
      if (node[DONE] || node.name == null) return
      const mine =
        space === 'formula'
          ? lets.has(name)
          : (space === 'node' || space === 'stage' || space === 'component' || space === 'connection') && ids.has(name)
      if (mine) node.name = `${self}.${name}`
    })
    chains(stmts)
    const tier = propOf(d, 'tier')
    const { body: _, bodySpan: __, ...head } = d
    // one that holds no box leaves no line: nothing to draw a frame around, and nothing a few lines can multiply
    const holds = stmts.some((s) => s.kind === 'decl' && (s.keyword.name === 'subsystem' || isBox(s)))
    const out: Stmt[] = holds ? [clone({ ...head, args: [d.args[0]!, ...(content.label ? [content.label] : [])] })] : []
    let route: Property | undefined
    for (const s of stmts) {
      if (s.kind === 'prop') {
        if (s.key.name === 'route') route = s
        continue
      }
      if (isBox(s)) {
        // the tier of the subsystem is that of every box in it that names none
        if (tier && !propOf(s, 'tier')) s.body = [...(s.body ?? []), clone(tier)]
      }
      out.push(s)
    }
    if (route) {
      const stages =
        route.chain ??
        (route.value.t === 'id' ? [{ name: route.value.name, from: route.value.from, to: route.value.to }] : [])
      const boxOf = (stage: string | undefined) =>
        stage == null
          ? undefined
          : out.find(
              (s): s is Decl =>
                isBox(s) &&
                (idOf(s) === stage ||
                  (s.body ?? []).some(
                    (c) =>
                      c.kind === 'decl' && (STAGES as readonly string[]).includes(c.keyword.name) && idOf(c) === stage,
                  )),
            )
      const [first, last] = [boxOf(stages[0]?.name), boxOf(stages.at(-1)?.name)]
      for (const [stage, box] of [
        [stages[0], first],
        [stages.at(-1), last],
      ] as const)
        if (stage && !box)
          this.report.error(
            'bad-route',
            stage,
            `"${stage.name.startsWith(`${self}.`) ? stage.name.slice(self.length + 1) : stage.name}" is no stage of this subsystem`,
          )
      paths.set(self, { stages, entry: first && idOf(first), exit: last && idOf(last) })
    } else paths.set(self, { stages: [] })
    return out
  }

  /**
   * What a subsystem holds, in the names of `env`: its own statements with their boxes and subsystems written out,
   * after those of the subsystem it is like, that one's inputs set from this one's `with`.
   */
  private content(d: Decl, env: Env, depth: number, trail: readonly Decl[]): Content | undefined {
    if (this.tooMany) return undefined
    const like = propOf(d, 'like')
    const body = d.body ?? []
    const withs = body.filter(isWith)
    const inputs = body.filter(isInput)
    const own_ = body.filter(
      (s) => !isWith(s) && !isInput(s) && !(s.kind === 'prop' && (s.key.name === 'like' || s.key.name === 'tier')),
    )
    for (const s of own_)
      if (s.kind === 'prop' && s.key.name !== 'route')
        this.report.error(
          'unknown-property',
          s.key,
          `unknown property "${s.key.name}" in subsystem`,
          didYouMean(s.key.name, ['like', 'tier', 'route']),
        )
      else if (s.kind === 'decl' && !SCHEMA.subsystem!.children.includes(s.keyword.name))
        this.report.error(
          'misplaced',
          s.keyword,
          `"${s.keyword.name}" cannot go in a subsystem: it holds boxes, components, connections, edges and lets`,
        )
      else if (s.kind === 'row') this.report.error('misplaced', s, 'a row of numbers can only go in "points"')
    const kept = own_.filter(
      (s) =>
        s.kind === 'edge' ||
        (s.kind === 'prop' && s.key.name === 'route') ||
        (s.kind === 'decl' && SCHEMA.subsystem!.children.includes(s.keyword.name)),
    )
    const mine = this.body(kept, env, depth + 1, 'subsystem')
    if (!like) {
      for (const w of withs)
        this.report.error('misplaced', w.keyword, '"with" sets the inputs of the subsystem this one is like')
      return { stmts: clone(mine), inputs, label: d.args[1] }
    }
    const name = like.value.t === 'id' ? like.value.name : undefined
    const found = name == null ? undefined : env.template(name)
    if (name == null || !found) {
      const text = this.report.source.slice(like.value.from, like.value.to)
      this.report.error('unknown-name', like.value, `unknown subsystem "${text}"`, didYouMean(text, env.templates()))
      return undefined
    }
    if (found.decl.keyword.name !== 'subsystem') {
      this.report.error(
        'bad-box',
        like.value,
        `a subsystem is like another subsystem: "${name}" is a ${found.decl.keyword.name}`,
      )
      return undefined
    }
    if (found.decl === d || trail.includes(found.decl)) {
      const loop = [...trail.map((t) => idOf(t) ?? ''), idOf(d) ?? '', name].filter(Boolean).join(' → ')
      this.report.error('bad-box', like.value, `a subsystem cannot be like itself: ${loop}`)
      return undefined
    }
    const base = this.content(found.decl, found.env, depth, [...trail, d])
    if (!base) return undefined
    const given = this.given(d, withs, base.inputs, found.env, `"${name}"`, env)
    const theirs =
      base.inputs.length || found.env !== env ? this.settle(base.stmts, 'subsystem', found.env, given) : base.stmts
    return { stmts: [...theirs, ...clone(mine)], inputs, label: d.args[1] ?? base.label }
  }
}

/** A route's first name is also its value: after a rewrite the two say the same again. */
function chains(stmts: readonly Stmt[]) {
  for (const s of stmts) {
    if (s.kind === 'prop' && s.chain?.[0] && s.value.t === 'id') s.value.name = s.chain[0].name
    else if (s.kind !== 'prop' && s.kind !== 'row' && s.body) chains(s.body)
  }
}

/**
 * Routes and edges that name a subsystem, written out: a route passes the stages of the subsystem's own route, an edge
 * to it ends at the box of the first, an edge from it starts at the box of the last.
 */
function through(written: Stmt[], paths: ReadonlyMap<string, Path>, report: Reporter, keyword: string): Stmt[] {
  // copies: the routes are rewritten, and the text's own statements stay as they parsed
  const stmts = written.map((s) => (s.kind === 'decl' || s.kind === 'prop' ? clone(s) : s))
  const noRoute = (n: Ident) =>
    report.error(
      'bad-route',
      n,
      `"${n.name}" is a subsystem without a route of its own: name the box in it`,
      `${n.name}.<box>, or "route: a -> b" in the subsystem`,
    )
  const routes = (list: Stmt[], keyword: string) => {
    for (const s of list) {
      if (s.kind === 'prop') {
        const spec = propNamed(own(SCHEMA, keyword)?.props ?? {}, s.key.name)?.spec ?? own(COMPONENT_PROPS, s.key.name)
        if (spec?.value !== 'route' && !s.chain) continue
        const names =
          s.chain ?? (s.value.t === 'id' ? [{ name: s.value.name, from: s.value.from, to: s.value.to }] : [])
        if (!names.some((n) => paths.has(n.name))) continue
        const chain = names.flatMap((n) => {
          const p = paths.get(n.name)
          if (!p) return [n]
          if (!p.stages.length) noRoute(n)
          // each stage where the subsystem is named: that is where a mistake about it shows
          return p.stages.map((st) => ({ name: st.name, from: n.from, to: n.to }))
        })
        if (!chain.length) continue
        s.chain = chain
        s.value = { t: 'id', name: chain[0]!.name, from: chain[0]!.from, to: chain[0]!.to }
      } else if (s.kind === 'decl' && s.body) routes(s.body, s.keyword.name)
    }
  }
  routes(stmts, keyword)
  const out: Stmt[] = []
  for (const s of stmts) {
    if (s.kind !== 'edge' || !s.chain.some((n) => paths.has(n.name))) {
      out.push(s)
      continue
    }
    // a -> sub -> b: an edge into its first box, and one out of its last
    let run: Ident[] = []
    const flush = () => {
      if (run.length > 1) out.push({ ...s, chain: run } satisfies Edge)
      run = []
    }
    for (const [i, n] of s.chain.entries()) {
      const p = paths.get(n.name)
      if (!p) {
        run.push(n)
        continue
      }
      if (!p.stages.length || !p.entry || !p.exit) {
        if (!p.stages.length) noRoute(n)
        flush()
        continue
      }
      if (i > 0) run.push({ name: p.entry, from: n.from, to: n.to })
      flush()
      if (i < s.chain.length - 1) run.push({ name: p.exit, from: n.from, to: n.to })
    }
    flush()
  }
  return out
}

/**
 * `at.orderLine.topic` parses as the stage "orderLine" and the flow "topic": where the two are one stage's name and
 * the first alone is none, it is that stage.
 */
function stageNames(stmts: readonly Stmt[]) {
  const stages = new Set<string>()
  for (const s of stmts) {
    if (!isBox(s)) continue
    const id = idOf(s)
    if (id != null) stages.add(id)
    for (const c of s.body ?? []) {
      const sid = c.kind === 'decl' && (STAGES as readonly string[]).includes(c.keyword.name) ? idOf(c) : undefined
      if (sid != null) stages.add(sid)
    }
  }
  if (![...stages].some((s) => s.includes('.'))) return
  const expr = (e: Expr) => {
    if (e.t === 'member' && e.object.name === 'at' && e.flow) {
      const whole = `${e.prop.name}.${e.flow.name}`
      if (stages.has(whole) && !stages.has(e.prop.name)) {
        e.prop = { name: whole, from: e.prop.from, to: e.flow.to }
        delete e.flow
      }
    }
    for (const c of childrenOf(e, true)) expr(c)
  }
  const walk = (list: readonly Stmt[]) => {
    for (const s of list) {
      if (s.kind === 'row') continue
      if (s.kind === 'prop') expr(s.value)
      else {
        if (s.kind === 'decl') {
          for (const a of s.args) expr(a)
          if (s.init) expr(s.init)
        } else if (s.value) expr(s.value)
        if (s.body) walk(s.body)
      }
    }
  }
  walk(stmts)
}

/**
 * A pool's `workers { … }` block as the lines a pool writes from loadmap 1.5: its label as `stageLabel`, its lines
 * under their names now (`fill` is `placement`), its `autoscale { … }`. A block with an id of its own stays.
 */
function poolLines(st: Stmt): Stmt[] {
  if (st.kind !== 'decl' || st.keyword.name !== 'workers' || st.args.some((a) => a.t === 'id')) return [st]
  const label = st.args.find((a) => a.t === 'str' || a.t === 'tpl')
  const workers = SCHEMA.workers!.props
  return [
    ...(label
      ? [
          {
            kind: 'prop',
            key: { name: 'stageLabel', from: label.from, to: label.from },
            value: label,
            from: label.from,
            to: label.to,
          } as Property,
        ]
      : []),
    ...(st.body ?? []).map((x) =>
      x.kind === 'prop' ? { ...x, key: { ...x.key, name: propNamed(workers, x.key.name)?.name ?? x.key.name } } : x,
    ),
  ]
}
