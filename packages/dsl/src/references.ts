import type { Stmt } from './ast'
import { type CompileOptions, compile, type DslSymbol, declarations } from './compile'
import { Reporter, type Span } from './diagnostics'
import type { EditResult, TextChange } from './edit'
import { RESERVED } from './expr'
import { type Space, walkNames } from './names'
import { parse } from './parser'
import { type BlockSpec, BOXES, SCHEMA } from './schema'

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
    // its id, where it is declared bare: a name, never a text
    if (i.of(at).some((r) => r.decl && !r.quoted) && !NAME.test(name))
      return { error: `"${name}" is not a name: a scenario's id is letters, digits and _, not starting with a digit` }
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
    // a connection's id must not be a component's, and the other way round (a box's id is its component's)
    if (at.space === 'connection') return new Set(ids('connection', 'component'))
    if (key.startsWith('box:')) return new Set(ids('node', 'stage', 'component', 'connection'))
    if (at.space === 'stage') return new Set(ids('node', 'stage', 'component'))
    if (at.space === 'component') return new Set(ids('component', 'connection'))
    if (at.space === 'formula') return new Set([...ids('param', 'let', 'fit', 'published', 'measure'), 'load'])
    return new Set(ids(at.space as DslSymbol['kind']))
  }

  private stages?: Set<string>
  private isStage(name: string) {
    this.stages ??= new Set(this.symbols.filter((s) => s.kind === 'stage').map((s) => s.id))
    return this.stages.has(name)
  }

  private add(space: Space, id: Span, name: string, decl = false, quoted = false) {
    this.refs.push({ space, name, from: id.from, to: id.to, decl, quoted })
  }

  private visit(list: readonly Stmt[], spec: BlockSpec, branches: boolean) {
    walkNames(list, spec, (space, node, name, decl, quoted) => this.add(space, node, name, decl, quoted), branches)
  }
}
