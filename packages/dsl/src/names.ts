import { childrenOf, type Decl, type Expr, type Property, type Stmt } from './ast'
import type { Span } from './diagnostics'
import { type BlockSpec, BOXES, EDGE_PROPS, own, propNamed, SCHEMA, STAGES } from './schema'

/** Where names live: a name is unique in its space, and a reference finds its declaration there. */
export type Space = 'formula' | 'flow' | 'node' | 'stage' | 'component' | 'tier' | 'scenario' | 'metric' | 'connection'

/**
 * Called for every name the statements write. `node` is the piece of the syntax tree that holds it (an id, a formula
 * that is one name) unless the name is a text in quotes: a rewrite may set its `name`.
 */
export type NameVisitor = (
  space: Space,
  node: Span & { name?: string },
  name: string,
  decl: boolean,
  quoted: boolean,
  /** The name may be of this space or a formula's: the value of an input, a flow's name or a value. */
  loose?: boolean,
) => void

/** Every name in the statements of a block, each with the space it lives in. */
export function walkNames(
  list: readonly Stmt[],
  spec: BlockSpec,
  visit: NameVisitor,
  branches = false,
  edgeBody = false,
) {
  new Walk(visit).visit(list, spec, branches, edgeBody)
}

/** Every name in one formula. */
export function walkFormula(e: Expr, visit: NameVisitor) {
  new Walk(visit).expr(e)
}

class Walk {
  constructor(private readonly visitor: NameVisitor) {}

  private add(space: Space, id: Span & { name?: string }, name: string, decl = false, quoted = false, loose = false) {
    this.visitor(space, id, name, decl, quoted, loose)
  }

  private scenario(e: Expr, decl = false) {
    if (e.t === 'id') this.add('scenario', e, e.name, decl)
    else if (e.t === 'str') this.add('scenario', { from: e.from + 1, to: e.to - 1 }, e.value, decl, true)
  }

  visit(list: readonly Stmt[], spec: BlockSpec, branches: boolean, edgeBody = false) {
    for (const s of list) {
      if (s.kind === 'prop') {
        const prop = edgeBody ? own(EDGE_PROPS, s.key.name) : propNamed(spec.props, s.key.name)?.spec
        if (!prop && spec.open) {
          const k = s.key.name
          if (spec.open.names === 'flows') this.add('flow', s.key, k)
          // an input's name is the prototype's, an imported name its library's: not a name of this text
          else if (spec.open.names === 'inputs' || spec.open.names === 'imports') {
            if (spec.open.names === 'inputs') {
              // one name alone may be the flow an `input flow` takes: a rename of the flow reaches it
              if (s.value.t === 'id') this.add('flow', s.value, s.value.name, false, false, true)
              this.expr(s.value)
            }
            continue
          }
          // a catalog condition or a metric's argument is no name of the definition
          else if (k !== 'load' && spec.open.names !== 'conditions' && spec.open.names !== 'arguments')
            this.add('formula', s.key, k)
          this.expr(s.value)
          continue
        }
        switch (prop?.value) {
          case 'route':
            // one name is the value itself: a rewrite sets it there
            if (s.chain) for (const n of s.chain) this.add('stage', n, n.name)
            else if (s.value.t === 'id') this.add('stage', s.value, s.value.name)
            break
          case 'node':
          case 'component':
          case 'flow':
          case 'tier':
            if (s.value.t === 'id') this.add(prop.value, s.value, s.value.name)
            break
          case 'flows':
            if (s.value.t === 'array') for (const e of s.value.items) if (e.t === 'id') this.add('flow', e, e.name)
            break
          case 'subsystems':
            if (s.value.t === 'array') for (const e of s.value.items) if (e.t === 'id') this.add('node', e, e.name)
            break
          case 'measure':
            if (s.value.t === 'id') this.add('formula', s.value, s.value.name)
            break
          case 'scenario':
            this.scenario(s.value)
            break
          // a word of the language (`shape: cylinder`, `fullScreen: [verdict]`), not a name of the definition
          case 'enum':
          case 'names':
            break
          default:
            this.expr(s.value)
        }
      } else if (s.kind === 'decl') {
        const k = s.keyword.name
        // the head of a file names files; what an import brings is declared here under the name it gives it, whatever
        // it is in its library: a value, a metric, a tier, a box
        if (k === 'import')
          for (const n of s.body ?? []) {
            const local = n.kind === 'decl' && !n.args.length ? n.keyword : n.kind === 'prop' ? n.key : undefined
            if (local)
              for (const space of ['formula', 'node', 'tier', 'metric'] as const)
                this.add(space, local, local.name, true)
          }
        if (k === 'import' || k === 'include' || k === 'part' || k === 'library' || k === 'extends') continue
        if (k === 'input') {
          // `input pods`, or `input flow main`: a name the lines of its box read, a flow's where it says so
          const [first, second] = s.args
          if (first?.t === 'id' && second?.t === 'id' && first.name === 'flow')
            this.add('flow', second, second.name, true)
          else if (first?.t === 'id') this.add('formula', first, first.name, true)
          if (s.init) this.expr(s.init)
          continue
        }
        const id = s.args[0]?.t === 'id' ? s.args[0] : undefined
        if (id) {
          if (k === 'param' || k === 'let' || k === 'fit' || k === 'published' || k === 'measure')
            this.add('formula', id, id.name, true)
          // a connection that gives accepts (or its old name, max) is a limit: expect, focus and formulas name it as a component
          else if (k === 'connection')
            this.add(
              s.body?.some(
                (p) => p.kind === 'prop' && propNamed(SCHEMA.connection!.props, p.key.name)?.name === 'accepts',
              )
                ? 'component'
                : k,
              id,
              id.name,
              true,
            )
          else if (k === 'flow' || k === 'tier' || k === 'component' || k === 'metric') this.add(k, id, id.name, true)
          else if ((BOXES as readonly string[]).includes(k) || k === 'subsystem') this.add('node', id, id.name, true)
          else if ((STAGES as readonly string[]).includes(k)) this.add('stage', id, id.name, true)
        }
        const metric = s.args[1]
        if (k === 'measure' && metric?.t === 'id') this.add('metric', metric, metric.name)
        // its id, when it has one, and its label: a step or an expect names it by either
        if (k === 'scenario') for (const a of s.args.slice(0, 2)) this.scenario(a, true)
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

  expr(e: Expr) {
    if (e.t === 'id') this.add('formula', e, e.name)
    else if (e.t === 'call') this.add('formula', e.callee, e.callee.name)
    else if (e.t === 'member') {
      const table = e.object.name
      if (table === 'flows') this.add('flow', e.prop, e.prop.name)
      else if (table === 'at') {
        this.add('stage', e.prop, e.prop.name)
        if (e.flow) this.add('flow', e.flow, e.flow.name)
      } else if (table === 'out') this.add('stage', e.prop, e.prop.name)
      else if (table === 'demand' || table === 'util') this.add('component', e.prop, e.prop.name)
      else if (table === 'derived') this.add('formula', e.prop, e.prop.name)
    }
    for (const c of childrenOf(e, true)) this.expr(c)
  }
}

/**
 * For a box that says `like:`, the other box and what this one takes from it, by the names of its lines and stages,
 * as the compiler takes them (expand.ts): a line written here replaces the same line there, a stage written here
 * replaces its stages, and what the other takes from a third comes along. `taken` is empty when the other is not a box
 * of these statements (a prototype a library gave).
 */
export function likeness(body: readonly Stmt[], id: string): { from: string; taken: string[] } | undefined {
  const stages: readonly string[] = STAGES
  const box = (name: string) =>
    body.find(
      (s): s is Decl =>
        s.kind === 'decl' &&
        (BOXES as readonly string[]).includes(s.keyword.name) &&
        s.args[0]?.t === 'id' &&
        s.args[0].name === name,
    )
  const named = (s: Stmt) => (s.kind === 'prop' ? s.key.name : s.kind === 'decl' ? s.keyword.name : '')
  const skip = (name: string) => !name || name === 'like' || name === 'input' || name === 'with'
  /** Every line and stage a box has, its own and what it takes: by name. */
  const full = (d: Decl, seen: readonly Decl[]): string[] => {
    const own = (d.body ?? []).map(named).filter((k) => !skip(k))
    const like = d.body?.find((s): s is Property => s.kind === 'prop' && s.key.name === 'like')
    const other = like?.value.t === 'id' ? box(like.value.name) : undefined
    if (!other || seen.includes(other) || other.keyword.name !== d.keyword.name) return own
    const ownStage = own.some((k) => stages.includes(k))
    // a pool's pods are fixed or autoscaled: either written here replaces the other there
    const scaled = (k: string) =>
      (k === 'pods' && own.includes('autoscale')) || (k === 'autoscale' && own.includes('pods'))
    const theirs = full(other, [...seen, d]).filter(
      (k) => !own.includes(k) && !(ownStage && stages.includes(k)) && !scaled(k),
    )
    return [...theirs, ...own]
  }
  const mine = box(id)
  const like = mine?.body?.find((s): s is Property => s.kind === 'prop' && s.key.name === 'like')
  if (!mine || like?.value.t !== 'id') return undefined
  const own = new Set((mine.body ?? []).map(named))
  return { from: like.value.name, taken: [...new Set(full(mine, []).filter((k) => !own.has(k)))] }
}
