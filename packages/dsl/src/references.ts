import { childrenOf, type Expr, type Ident, type Stmt } from './ast'
import { type CompileOptions, compile, type DslSymbol, declarations } from './compile'
import { Reporter, type Span } from './diagnostics'
import type { EditResult, TextChange } from './edit'
import { RESERVED } from './expr'
import { parse } from './parser'
import { type BlockSpec, BOXES, EDGE_PROPS, own, SCHEMA, STAGES } from './schema'

/** Where names live: a name is unique in its space, and a reference finds its declaration there. */
type Space = 'formula' | 'flow' | 'node' | 'stage' | 'component' | 'tier' | 'scenario' | 'metric'

interface Ref extends Span {
  space: Space
  name: string
  /** Where it is declared. */
  decl?: boolean
  /** A scenario's label in quotes: the span is inside them. */
  quoted?: boolean
}

const NAME = /^[A-Za-z_]\w*$/

/** The index of the last text asked about: an editor asks again on every cursor move over the same text. */
let last: NameIndex | undefined
const indexOf = (source: string) => {
  if (last?.source !== source) last = new NameIndex(source)
  return last
}

/** Where the name at `offset` is declared; null when it is not a name the definition declares. */
export function definition(source: string, offset: number): Span | null {
  const i = indexOf(source)
  const at = i.at(offset)
  const d = at && i.refs.find((r) => r.decl && i.entity(r) === i.entity(at))
  return d ? { from: d.from, to: d.to } : null
}

/** Every place the name at `offset` is written, its declaration included, in order; null when there is no such name. */
export function references(source: string, offset: number): Span[] | null {
  const i = indexOf(source)
  const refs = i.at(offset) && i.of(i.at(offset)!)
  return refs?.length ? refs.map(({ from, to }) => ({ from, to })) : null
}

/**
 * The name at `offset` renamed everywhere it is written: a box's id with the stage and the component that take it, a
 * scenario's label quoted where it must be. Refused when the new name is not one, is reserved or taken, or when the
 * result would not compile where the text did.
 */
export function rename(source: string, offset: number, name: string, options?: CompileOptions): EditResult {
  const i = indexOf(source)
  const at = i.at(offset)
  if (!at || (!i.of(at).length && !(at.space === 'formula' && at.name === 'load')))
    return { error: 'nothing to rename here' }
  if (at.space === 'formula' && at.name === 'load') return { error: 'the load keeps its name' }
  if (at.space === 'scenario') {
    if (!name.trim() || /["\n\\]/.test(name)) return { error: 'a scenario label is a line of text without quotes' }
  } else if (!NAME.test(name))
    return { error: `"${name}" is not a name: letters, digits and _, not starting with a digit` }
  else if (RESERVED.has(name) || name === 'prototype') return { error: `"${name}" is reserved` }
  if (name === at.name) return { source, changes: [] }
  if (i.taken(at).has(name)) return { error: `"${name}" is taken` }

  const changes: TextChange[] = i.of(at).map((r) => ({
    from: r.from,
    to: r.to,
    insert: r.space !== 'scenario' || r.quoted || NAME.test(name) ? name : JSON.stringify(name),
  }))
  let out = ''
  let pos = 0
  for (const c of changes) {
    out += source.slice(pos, c.from) + c.insert
    pos = c.to
  }
  out += source.slice(pos)
  if (compile(source, options).ok) {
    const after = compile(out, options)
    if (!after.ok) return { error: `the result would not compile: ${after.diagnostics[0]?.message ?? 'an error'}` }
  }
  return { source: out, changes }
}

class NameIndex {
  readonly refs: Ref[] = []
  readonly symbols: DslSymbol[]
  private boxes = new Set<string>()
  /** Stages and components that take their box's id. */
  private derived = new Set<string>()

  constructor(readonly source: string) {
    const { doc } = parse(source, new Reporter(source))
    this.symbols = declarations(source, doc)
    for (const s of doc.body)
      if (s.kind === 'decl' && (BOXES as readonly string[]).includes(s.keyword.name) && s.args[0]?.t === 'id')
        this.boxes.add(s.args[0].name)
    // a stage or component without an id of its own: its symbol points at its keyword (where its statement starts), or
    // for a box's own component lines at the box's id
    for (const s of this.symbols)
      if ((s.kind === 'stage' || s.kind === 'component') && this.boxes.has(s.id)) {
        const box = this.symbols.find((b) => b.kind === 'node' && b.id === s.id)
        if (s.span.from === s.decl.from || box?.span.from === s.span.from) this.derived.add(`${s.kind}:${s.id}`)
      }
    this.visit(doc.body, SCHEMA['']!, false)
    this.refs.sort((a, b) => a.from - b.from)
  }

  at(offset: number): Ref | undefined {
    return this.refs.find((r) => r.from <= offset && offset <= r.to)
  }

  /** Which thing a reference names: a box, the stage and the component that take its id are one. */
  entity(r: Ref): string {
    if (r.space === 'node' || (r.space === 'stage' && !this.isStage(r.name) && this.boxes.has(r.name)))
      return `box:${r.name}`
    if ((r.space === 'stage' || r.space === 'component') && this.derived.has(`${r.space}:${r.name}`))
      return `box:${r.name}`
    return `${r.space}:${r.name}`
  }

  of(at: Ref): Ref[] {
    const key = this.entity(at)
    // only names something declares: a typo is not a name to rename
    const refs = this.refs.filter((r) => this.entity(r) === key)
    return refs.some((r) => r.decl) ? refs : []
  }

  /** The names a new one must not take: those of its space, and for a box, of every space its id is in. */
  taken(at: Ref): Set<string> {
    const ids = (...kinds: DslSymbol['kind'][]) => this.symbols.filter((s) => kinds.includes(s.kind)).map((s) => s.id)
    const key = this.entity(at)
    if (key.startsWith('box:') || at.space === 'stage') return new Set(ids('node', 'stage', 'component'))
    if (at.space === 'formula') return new Set([...ids('param', 'let', 'fit', 'published', 'measure'), 'load'])
    return new Set(ids(at.space as DslSymbol['kind']))
  }

  private stages?: Set<string>
  private isStage(name: string) {
    this.stages ??= new Set(this.symbols.filter((s) => s.kind === 'stage').map((s) => s.id))
    return this.stages.has(name)
  }

  private add(space: Space, id: Ident | (Span & { name?: string }), name: string, decl = false, quoted = false) {
    this.refs.push({ space, name, from: id.from, to: id.to, decl, quoted })
  }

  private scenario(e: Expr, decl = false) {
    if (e.t === 'id') this.add('scenario', e, e.name, decl)
    else if (e.t === 'str') this.add('scenario', { from: e.from + 1, to: e.to - 1 }, e.value, decl, true)
  }

  private visit(list: readonly Stmt[], spec: BlockSpec, branches: boolean, edgeBody = false) {
    for (const s of list) {
      if (s.kind === 'prop') {
        const prop = edgeBody ? own(EDGE_PROPS, s.key.name) : own(spec.props, s.key.name)
        if (!prop && spec.open) {
          const k = s.key.name
          if (spec.open.names === 'flows') this.add('flow', s.key, k)
          // a catalog condition or a metric's argument is no name of the definition
          else if (k !== 'load' && spec.open.names !== 'conditions' && spec.open.names !== 'arguments')
            this.add('formula', s.key, k)
          this.expr(s.value)
          continue
        }
        switch (prop?.value) {
          case 'route':
            for (const n of s.chain ??
              (s.value.t === 'id' ? [{ name: s.value.name, from: s.value.from, to: s.value.to }] : []))
              this.add('stage', n, n.name)
            break
          case 'node':
          case 'component':
          case 'flow':
          case 'tier':
            if (s.value.t === 'id') this.add(prop.value, s.value, s.value.name)
            break
          case 'measure':
            if (s.value.t === 'id') this.add('formula', s.value, s.value.name)
            break
          case 'scenario':
            this.scenario(s.value)
            break
          default:
            this.expr(s.value)
        }
      } else if (s.kind === 'decl') {
        const k = s.keyword.name
        const id = s.args[0]?.t === 'id' ? s.args[0] : undefined
        if (id) {
          if (k === 'param' || k === 'let' || k === 'fit' || k === 'published' || k === 'measure')
            this.add('formula', id, id.name, true)
          else if (k === 'flow' || k === 'tier' || k === 'component' || k === 'metric') this.add(k, id, id.name, true)
          else if ((BOXES as readonly string[]).includes(k)) this.add('node', id, id.name, true)
          else if ((STAGES as readonly string[]).includes(k)) this.add('stage', id, id.name, true)
        }
        const metric = s.args[1]
        if (k === 'measure' && metric?.t === 'id') this.add('metric', metric, metric.name)
        if (k === 'scenario' && s.args[0]) this.scenario(s.args[0], true)
        for (const a of s.args) if (a.t === 'tpl') this.expr(a)
        if (s.init) this.expr(s.init)
        const inner = own(SCHEMA, k)
        if (s.body && inner) this.visit(s.body, inner, inner.edges === 'branches')
      } else if (s.kind === 'edge') {
        if (branches) {
          const [flow, ...stages] = s.chain
          if (flow) this.add('flow', flow, flow.name)
          for (const n of stages) this.add('stage', n, n.name)
        } else for (const n of s.chain) this.add('node', n, n.name)
        if (s.value) this.expr(s.value)
        if (s.body) this.visit(s.body, spec, false, true)
      }
    }
  }

  private expr(e: Expr) {
    if (e.t === 'id') this.add('formula', e, e.name)
    else if (e.t === 'call') this.add('formula', e.callee, e.callee.name)
    else if (e.t === 'member') {
      const table = e.object.name
      if (table === 'flows') this.add('flow', e.prop, e.prop.name)
      else if (table === 'at') {
        this.add('stage', e.prop, e.prop.name)
        if (e.flow) this.add('flow', e.flow, e.flow.name)
      } else if (table === 'demand' || table === 'util') this.add('component', e.prop, e.prop.name)
      else if (table === 'derived') this.add('formula', e.prop, e.prop.name)
    }
    for (const c of childrenOf(e, true)) this.expr(c)
  }
}
