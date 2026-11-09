import { type Capacity, type ComponentResult, type Evaluation, sourceText } from '@loadmap/core'
import { fmt, months, multiple, multiples, pct } from '@loadmap/core/format'
import { conditionText } from '@loadmap/core/internal'
import type { Decl, Edge, Expr, Stmt } from './ast'
import { componentOf } from './catalog'
import { type Definition, type DslSymbol, declarations } from './compile'
import { blockAt, propOf as prop } from './complete'
import { callAt, cursorAt } from './cursor'
import { Reporter } from './diagnostics'
import { BUILTINS } from './expr'
import { lex, type Token } from './lexer'
import { parse } from './parser'
import { type BlockSpec, BOXES, EDGE_PROPS, own, type PropSpec, SCHEMA, STAGES } from './schema'

export interface Hover {
  /** The word under the pointer: source[from, to). */
  from: number
  to: number
  /** What it is, as a line of the language: `flow orders "orders"`. */
  head: string
  /** Short plain sentences: what it is, then its values at the defaults when a definition is given. `code` in backticks. */
  body: string[]
}

export interface SignatureHelp {
  name: string
  /** `measured(value, unit, source)`. */
  label: string
  params: string[]
  /** The argument the cursor is in, from 0; past the last one when there are more than it takes. */
  active: number
  /** It takes any number of the last argument: `min(a, b, …)`. */
  variadic: boolean
  doc: string
}

const TABLES: Readonly<Record<string, string>> = {
  flows: '`flows.<flow>`: the units per second a flow brings, before anything on its route.',
  at: '`at.<stage>.<flow>`: what of a flow reaches a stage, per second: cache hits and what a limiter turns away are gone after them. `at.<stage>` alone: every flow.',
  demand: "`demand.<component>`: what a component must handle, in its capacity's unit.",
  util: '`util.<component>`: demand ÷ capacity, a share: 0.5 is 50 %.',
  derived: '`derived.<let>`: the value of a `let`.',
}

const KIND_WORDS: Partial<Record<PropSpec['value'], string>> = {
  number: 'a number',
  boolean: 'true or false',
  string: 'a text',
  capacity: 'measured(…), estimated(…) or configured(…)',
  route: 'a -> b -> c',
  node: 'a node',
  component: 'a component',
  scenario: 'a scenario',
  tier: 'a tier',
  measure: 'a measure',
  options: '[…]',
  value: 'a value',
}

/** One evaluation per definition: a hover reads it, never runs a formula of its own. */
const evaluations = new WeakMap<Definition, Evaluation>()

/**
 * What the word at `offset` is: a statement, a property, a name the definition declares, a builtin. With the
 * definition compiled from the text (the last one without errors will do), its values at the defaults: a flow's rate,
 * what reaches a stage, a component's utilization and where it runs out, a `let`'s value. Values come from the
 * compiled model's own evaluation, never from evaluating text. Null where there is nothing to say.
 */
export function hover(source: string, offset: number, definition?: Definition): Hover | null {
  let toks = lex(source, new Reporter(source))
  let t = toks.find((k) => k.from <= offset && offset <= k.to && k.kind !== 'eof' && k.kind !== 'newline')
  // a template's ${…} is code: its own tokens
  if (t?.kind === 'template') {
    const part = t.parts?.find((p) => p.from <= offset && offset <= p.to)
    if (!part) return null
    toks = lex(source, new Reporter(source), part.from, part.to)
    t = toks.find((k) => k.from <= offset && offset <= k.to && k.kind === 'ident')
  }
  if (!t || (t.kind !== 'ident' && t.kind !== 'string')) return null
  const { doc } = parse(source, new Reporter(source))
  return new Lookup(source, doc.body, declarations(source, doc), definition).at(t, toks)
}

/** The builtin or fit whose parentheses hold `offset`, and the argument the cursor is in. */
export function signatureHelp(source: string, offset: number): SignatureHelp | null {
  const cur = cursorAt(source, offset)
  if (cur.in === 'comment' || (cur.in === 'text' && !cur.string)) return null
  const call = callAt(cur.part ?? cur.head)
  if (!call) return null
  const b = own(BUILTINS, call.name)
  let params: string[]
  let doc: string
  let variadic = false
  if (b) {
    ;({ params, doc } = b)
    variadic = !!b.variadic
  } else {
    const { doc: d } = parse(source, new Reporter(source))
    const fit = findDecl(d.body, 'fit', call.name)
    if (!fit) return null
    params = [fitX(fit)]
    doc = `The line fitted to ${call.name}'s points: its cost at this ${params[0]}.`
  }
  const active = variadic ? Math.min(call.arg, params.length - 1) : call.arg
  return { name: call.name, label: callLabel(call.name, params, variadic), params, active, variadic, doc }
}

class Lookup {
  constructor(
    readonly source: string,
    readonly body: readonly Stmt[],
    readonly symbols: readonly DslSymbol[],
    readonly definition?: Definition,
  ) {}

  at(t: Token, toks: readonly Token[]): Hover | null {
    const out = (head: string, body: string[]) => ({ from: t.from, to: t.to, head, body })
    const cur = cursorAt(this.source, t.from)
    if (cur.in === 'comment' || cur.in === 'text') return null
    const { spec, edgeBody, path } = blockAt(this.body, t.from)
    const i = toks.indexOf(t)
    const prev = toks[i - 1]
    const next = toks[i + 1]
    const name = t.text

    // a scenario's label: where it is declared, and where a step or an expect names it
    if (t.kind === 'string') {
      const key = cur.head[0]
      const named = key?.text === 'scenario' && (cur.head.length === 1 || punct(cur.head[1], ':'))
      return named ? this.scenario(String(t.value), out) : null
    }
    // flows.x  at.s  at.s.f  demand.c  util.c  derived.x
    if (punct(prev, '.')) {
      const table = toks[i - 2]
      if (punct(toks[i - 3], '.') && toks[i - 4]?.text === 'at' && table) return this.flow(name, out, table.text)
      switch (table?.text) {
        case 'flows':
          return this.flow(name, out)
        case 'at':
          return this.stage(name, out)
        case 'demand':
        case 'util':
          return this.component(name, out)
        case 'derived':
          return this.let(name, out)
        default:
          return null
      }
    }
    if (punct(next, '.') && own(TABLES, name)) return out(`${name}.…`, [TABLES[name]!])

    const statementStart = !cur.part && !cur.head.length
    if (statementStart && punct(next, ':')) return this.key(name, spec, edgeBody, out, path)
    if (statementStart && punct(next, '->'))
      return spec.edges === 'branches' ? this.flow(name, out) : this.box(name, out)
    if (statementStart && own(SCHEMA, name) && name !== 'loadmap') return this.keyword(name, out)

    if (!cur.part) {
      const first = cur.head[0]
      const arrow = cur.head.findIndex((k) => punct(k, '->'))
      const colon = cur.head.findIndex((k) => punct(k, ':'))
      // a -> b -> |   fan-out branch: flow -> stage
      if (arrow >= 0 && (colon < 0 || arrow < colon) && first?.kind === 'ident' && !punct(cur.head[1], ':'))
        return spec.edges === 'branches' ? this.stage(name, out) : this.box(name, out)
      // key: value
      if (first && punct(cur.head[1], ':')) {
        const prop = edgeBody
          ? own(EDGE_PROPS, first.text)
          : (own(spec.props, first.text) ?? (spec.open ? spec.open.spec : undefined))
        switch (prop?.value) {
          case 'route':
            return this.stage(name, out)
          case 'node':
            return this.box(name, out)
          case 'component':
            return this.component(name, out)
          case 'tier':
            return this.tier(name, out)
          case 'measure':
            return this.measure(name, out)
          case 'scenario':
            return this.scenario(name, out)
          case 'enum':
          case 'names':
            return this.key(first.text, spec, edgeBody, out)
          case 'boolean':
            if (prop.scope === 'const') return this.key(first.text, spec, edgeBody, out)
        }
        return this.formulaName(name, out)
      }
      // published x kafka
      if (first?.text === 'published' && cur.head.length === 2) return this.catalogComponent(cur.head[1]!.text, out)
      // let x = …
      if (first?.text === 'let') return cur.head.length === 1 ? this.let(name, out) : this.formulaName(name, out)
      // what a statement declares: node db, param pods, tier data, queue topic
      if (first && own(SCHEMA, first.text) && cur.head.every((k) => k.kind !== 'punct'))
        return this.declared(first.text, name, out, path)
    }
    return this.formulaName(name, out)
  }

  keyword(k: string, out: Out): Hover {
    const s = SCHEMA[k]!
    return out(s.example || k, [s.doc])
  }

  key(key: string, spec: BlockSpec, edgeBody: boolean, out: Out, path: readonly (Decl | Edge)[] = []): Hover | null {
    if (spec === SCHEMA.published && !own(spec.props, key)) return this.condition(key, path, out)
    if (spec.open?.names === 'arguments' && !own(spec.props, key))
      return out(`${key}: an argument`, [`It fills \`{{ args.${key} }}\` in the query of the metric it measures.`])
    const prop = edgeBody ? own(EDGE_PROPS, key) : own(spec.props, key)
    if (prop) {
      const values = key === 'color' ? 'a theme colour' : prop.values?.join(' | ')
      return out(`${key}: ${values ?? KIND_WORDS[prop.value] ?? prop.value}`, [
        prop.doc,
        ...(prop.required ? ['Required.'] : []),
      ])
    }
    // the open names of a preset, scenario, step or partitions
    if (spec.open?.names === 'flows') return this.flow(key, out)
    if (spec.open) return key === 'load' ? this.load(out) : this.param(key, out)
    return null
  }

  declared(keyword: string, id: string, out: Out, path: readonly (Decl | Edge)[]): Hover | null {
    if (keyword === 'param') return this.param(id, out)
    if (keyword === 'let') return this.let(id, out)
    if (keyword === 'fit') return this.fit(id, out)
    if (keyword === 'published') return this.published(id, out)
    if (keyword === 'measure') return this.measure(id, out)
    if (keyword === 'metric') return this.metric(id, out)
    if (keyword === 'flow') return this.flow(id, out)
    if (keyword === 'tier') return this.tier(id, out)
    if (keyword === 'component') return this.component(id, out)
    if ((BOXES as readonly string[]).includes(keyword)) return this.box(id, out)
    if ((STAGES as readonly string[]).includes(keyword) && path.length) return this.stage(id, out)
    return null
  }

  formulaName(name: string, out: Out): Hover | null {
    if (name === 'load') return this.load(out)
    if (this.has('param', name)) return this.param(name, out)
    if (this.has('let', name)) return this.let(name, out)
    if (this.has('fit', name)) return this.fit(name, out)
    if (this.has('published', name)) return this.published(name, out)
    if (this.has('measure', name)) return this.measure(name, out)
    const b = own(BUILTINS, name)
    if (b) return out(callLabel(name, b.params, !!b.variadic), [b.doc])
    if (own(TABLES, name)) return out(`${name}.…`, [TABLES[name]!])
    return null
  }

  load(out: Out): Hover {
    const d = this.body.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'load')
    const body = [SCHEMA.load!.doc]
    if (d) {
      const n = (k: string) => this.number(prop(d, k))
      const max = n('max')
      const min = n('min') ?? 1
      body.push(
        `From ${multiple(min)} to ${max == null ? '…' : multiple(max)}, ${multiple(n('default') ?? min)} at first.`,
      )
    }
    return out(d ? this.line(d) : 'load', body)
  }

  param(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'param', id)
    if (!d) return null
    const text = (k: string) => {
      const e = prop(d, k)
      return e ? this.source.slice(e.from, e.to) : undefined
    }
    const options = prop(d, 'options')
    const dflt = text('default')
    const body: string[] = []
    if (options?.t === 'array') {
      const items = options.items.map((e) => this.source.slice(e.from, e.to))
      body.push(
        `A select: ${items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items.join('')}. Default ${dflt ?? '—'}.`,
      )
    } else if (prop(d, 'default')?.t === 'bool') body.push(`A switch, ${dflt === 'true' ? 'on' : 'off'} by default.`)
    else if (prop(d, 'min') || prop(d, 'max')) {
      const step = text('step')
      body.push(
        `A slider from ${text('min') ?? '…'} to ${text('max') ?? '…'}${step ? `, in steps of ${step}` : ''}. Default ${dflt ?? '—'}.`,
      )
    }
    const hint = prop(d, 'hint')
    if (hint?.t === 'str') body.push(hint.value)
    return out(this.line(d), body)
  }

  let(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'let', id)
    if (!d) return null
    const head = d.init ? `let ${id} = ${this.source.slice(d.init.from, d.init.to)}` : `let ${id}`
    const body = [SCHEMA.let!.doc]
    const ev = this.evaluation()
    const v = (ev?.ctx.derived as Record<string, unknown> | undefined)?.[id]
    if (ev && (typeof v === 'number' || typeof v === 'boolean'))
      body.push(`${typeof v === 'number' ? fmt(v) : v} at the defaults (load ${multiple(ev.values.load as number)}).`)
    return out(head, body)
  }

  /** A published figure: what it is, at the defaults, under which conditions, from where. */
  published(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'published', id)
    if (!d) return null
    const ev = this.evaluation()
    const cap = (ev?.ctx.derived as Record<string, unknown> | undefined)?.[id] as Capacity | undefined
    const body = [SCHEMA.published!.doc]
    if (cap?.missing != null) body.push(`No published benchmark ${cap.missing} at the defaults: not ranked.`)
    else if (cap?.ref) {
      const r = cap.ref
      body.push(
        `${fmt(cap.value)} ${cap.unit} at the defaults: ${r.name}, ${r.what}, ${r.scope}.`,
        `Under: ${r.conditions.join('; ')}.`,
        `${r.name} ${r.versions.join(', ')}${r.version ? `, you run ${r.version}` : ''}. ${sourceText(r)}: [${r.source.title}](${r.source.url}). Catalog ${r.edition}.`,
      )
    }
    return out(this.line(d), body)
  }

  /** A measure: its value at the defaults, measured with its origin or the fallback. */
  measure(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'measure', id)
    if (!d) return null
    const v = (this.evaluation()?.ctx.derived as Record<string, unknown> | undefined)?.[id]
    const body = [SCHEMA.measure!.doc]
    if (typeof v === 'number') body.push(`${fmt(v)} at the defaults.`)
    else if (v && typeof v === 'object' && 'value' in v) {
      const c = v as Capacity
      body.push(
        c.origin
          ? `${fmt(c.value)} ${c.unit}, measured: ${c.source}.`
          : `${fmt(c.value)} ${c.unit}, its fallback${c.unread ? `: no data from the snapshot (${c.unread})` : ''}.`,
      )
    }
    return out(this.line(d), body)
  }

  /** A metric: what it reads, and which measures use it. */
  metric(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'metric', id)
    if (!d) return null
    const users = this.body.flatMap((s) =>
      s.kind === 'decl' && s.keyword.name === 'measure' && s.args[1]?.t === 'id' && s.args[1].name === id
        ? [s.args[0]?.t === 'id' ? s.args[0].name : '']
        : [],
    )
    const body = [SCHEMA.metric!.doc]
    body.push(users.length ? `Measured by ${users.map((u) => `\`${u}\``).join(', ')}.` : 'No measure uses it yet.')
    return out(this.line(d), body)
  }

  /** A component of the catalog: what it is, and whether anything is published for it. */
  catalogComponent(ref: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'published', ref)
    const c = d && componentOf(d)
    if (!c) return null
    const conditions = Object.keys(c.conditions)
    return out(c.name, [
      c.about,
      c.figures.length
        ? `${c.figures.length} published figure${c.figures.length === 1 ? '' : 's'}${conditions.length ? `, decided by ${conditions.join(', ')}` : ''}${c.versionMatters ? ' and the version' : ''}.`
        : 'Nothing is published with its conditions: give a measured or estimated capacity.',
      ...(c.tags.length ? [`Also: ${c.tags.join(', ')}.`] : []),
    ])
  }

  /** A condition of a published statement: what it is, and the values its published runs used. */
  condition(key: string, path: readonly (Decl | Edge)[], out: Out): Hover | null {
    const d = path.at(-1)
    const c = d?.kind === 'decl' ? componentOf(d) : undefined
    const def = c && own(c.conditions, key)
    if (!c || !def) return null
    const runs = [
      ...new Set(c.figures.flatMap((f) => (f.when[key] == null ? [] : [conditionText(c, key, f.when[key]!)]))),
    ]
    return out(`${key}: ${def.label}`, [def.doc, ...(runs.length ? [`Published runs: ${runs.join(', ')}.`] : [])])
  }

  fit(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'fit', id)
    if (!d) return null
    const points = d.body?.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'points')
    const rows = points?.body?.filter((s) => s.kind === 'row').length ?? 0
    const source = prop(d, 'source')
    const body = [`A line fitted to ${rows} measured point${rows === 1 ? '' : 's'}: call it as \`${id}(${fitX(d)})\`.`]
    if (source?.t === 'str') body.push(`From ${source.value}.`)
    return out(this.line(d), body)
  }

  flow(id: string, out: Out, stage?: string): Hover | null {
    const d = findDecl(this.body, 'flow', id)
    if (!d) return null
    const body: string[] = []
    const unit = prop(d, 'unit')
    const ev = this.evaluation()
    const at = ev && `at the defaults (load ${multiple(ev.values.load as number)})`
    if (stage) {
      if (ev) body.push(`${fmt(ev.at[stage]?.[id] ?? 0)} a second of ${id} reach ${stage} ${at}.`)
    } else {
      if (ev && ev.flows[id] != null) body.push(`${fmt(ev.flows[id]!)} a second ${at}.`)
      const route = d.body?.find((s) => s.kind === 'prop' && s.key.name === 'route')
      if (route?.kind === 'prop')
        body.push(
          `Route: ${(route.chain ?? []).map((n) => n.name).join(' → ') || this.source.slice(route.value.from, route.value.to)}.`,
        )
    }
    if (unit?.t === 'str') body.push(`One unit: ${unit.value}.`)
    return out(this.line(d), body)
  }

  tier(id: string, out: Out): Hover | null {
    const d = findDecl(this.body, 'tier', id)
    if (!d) return null
    const boxes = this.body.flatMap((s) => {
      if (s.kind !== 'decl' || !(BOXES as readonly string[]).includes(s.keyword.name)) return []
      const t = prop(s, 'tier')
      const box = s.args[0]
      return t?.t === 'id' && t.name === id && box?.t === 'id' ? [box.name] : []
    })
    return out(this.line(d), [
      SCHEMA.tier!.doc,
      boxes.length
        ? `Named by ${boxes.join(', ')}; a box without a tier stands in the tier of what feeds it.`
        : 'No box names it yet.',
    ])
  }

  scenario(label: string, out: Out): Hover | null {
    const all = this.body.filter((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'scenario')
    const d = all.find((s) => s.args[0]?.t === 'str' && s.args[0].value === label)
    if (!d) return null
    const sets = (d.body ?? []).flatMap((s) =>
      s.kind === 'prop' ? [`${s.key.name} ${this.source.slice(s.value.from, s.value.to)}`] : [],
    )
    const body = [
      sets.length ? `Sets ${sets.join(', ')}; every other value is the default.` : 'The defaults, unchanged.',
    ]
    if (all[0] === d) body.push('The baseline: the other scenarios are compared with it.')
    return out(this.line(d), body)
  }

  box(id: string, out: Out): Hover | null {
    const d = this.body.find(
      (s): s is Decl =>
        s.kind === 'decl' &&
        (BOXES as readonly string[]).includes(s.keyword.name) &&
        s.args[0]?.t === 'id' &&
        s.args[0].name === id,
    )
    if (!d) {
      // a stage by its id
      return this.symbols.some((s) => s.kind === 'stage' && s.id === id) ? this.stage(id, out) : null
    }
    const stages = this.symbols.filter((s) => s.kind === 'stage' && s.detail === id).map((s) => s.id)
    const body = stages.length ? [`Runs ${stages.length === 1 ? 'the stage' : 'the stages'} ${stages.join(', ')}.`] : []
    const lines = [...body, ...this.componentLines(this.componentOf(id))]
    return out(this.line(d), lines.length ? lines : [SCHEMA[d.keyword.name]!.doc])
  }

  stage(id: string, out: Out): Hover | null {
    const s = this.symbols.find((k) => k.kind === 'stage' && k.id === id)
    // a box with one stage stands for it in a route
    const only = this.symbols.filter((k) => k.kind === 'stage' && k.detail === id)
    if (!s) return only.length === 1 ? this.stage(only[0]!.id, out) : this.box(id, out)
    const box = s.detail ?? id
    const ev = this.evaluation()
    const body = [`A stage of ${box}.`]
    if (ev?.at[id]) {
      const flows = Object.entries(ev.at[id]!).filter(([, v]) => v > 0)
      if (flows.length)
        body.push(
          `Reaching it at the defaults (load ${multiple(ev.values.load as number)}): ${flows.map(([f, v]) => `${f} ${fmt(v)} a second`).join(', ')}.`,
        )
    }
    return out(this.first(s.decl.from), [...body, ...this.componentLines(this.componentOf(box))])
  }

  component(id: string, out: Out): Hover | null {
    const s = this.symbols.find((k) => k.kind === 'component' && k.id === id)
    if (!s) return null
    return out(this.first(s.decl.from), this.componentLines(id))
  }

  /** The component a box owns: its own lines, or a `component` inside it. */
  componentOf(box: string): string | undefined {
    if (this.has('component', box)) return box
    const d = this.body.find((s): s is Decl => s.kind === 'decl' && s.args[0]?.t === 'id' && s.args[0].name === box)
    const inner = d?.body?.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'component')
    const id = inner?.args[0]
    return id?.t === 'id' ? id.name : undefined
  }

  componentLines(id: string | undefined): string[] {
    const ev = this.evaluation()
    const c: ComponentResult | undefined = id ? ev?.components[id] : undefined
    const model = this.definition?.model
    if (!ev || !c || !model) return []
    const cap = c.capacity
    if (c.missing != null) return [`${c.name} has no published benchmark ${c.missing} at the defaults: not ranked.`]
    if (c.util == null || !cap) return [`${c.name} is switched off at the defaults.`]
    const at = (r: ComponentResult['targetRange']) =>
      r ? `${multiples(r, model.searchMax, true)}${months(model.dateAt(r.low), model.dateAt(r.high))}` : '—'
    return [
      `${pct(c.util)} at the defaults (load ${multiple(ev.values.load as number)}): ${fmt(c.demand ?? 0)} of ${fmt(cap.value)} ${cap.unit}${cap.within ? ` ±${pct(cap.within)}` : ''}.`,
      `Capacity ${cap.provenance}${cap.source ? `: ${cap.source}` : ''}.`,
      `${pct(model.thresholds.target)} at ${at(c.targetRange)}; full at ${at(c.fullRange)}.`,
    ]
  }

  evaluation(): Evaluation | undefined {
    const d = this.definition
    if (!d) return undefined
    let ev = evaluations.get(d)
    if (!ev) {
      ev = d.model.evaluate()
      evaluations.set(d, ev)
    }
    return ev
  }

  has(kind: DslSymbol['kind'], id: string) {
    return this.symbols.some((s) => s.kind === kind && s.id === id)
  }

  /** A statement's first line, without its block: `flow orders "orders"`. */
  line(d: Decl): string {
    const end = d.bodySpan?.from ?? lineEnd(this.source, d.from)
    return this.source.slice(d.from, Math.min(end, lineEnd(this.source, d.from))).trim()
  }

  /** The line a statement starts at `from`, up to its block. */
  first(from: number): string {
    const text = this.source.slice(from, lineEnd(this.source, from))
    const brace = text.indexOf('{')
    return (brace < 0 ? text : text.slice(0, brace)).trim()
  }

  number(e: Expr | undefined): number | undefined {
    return e?.t === 'num' ? e.value : undefined
  }
}

type Out = (head: string, body: string[]) => Hover

const punct = (t: Token | undefined, text: string) => t?.kind === 'punct' && t.text === text
const lineEnd = (source: string, from: number) => {
  const i = source.indexOf('\n', from)
  return i < 0 ? source.length : i
}

/** `max(a, b, …)`. */
function callLabel(name: string, params: readonly string[], variadic: boolean): string {
  return `${name}(${params.join(', ')}${variadic ? ', …' : ''})`
}

function findDecl(body: readonly Stmt[], keyword: string, id: string): Decl | undefined {
  return body.find(
    (s): s is Decl => s.kind === 'decl' && s.keyword.name === keyword && s.args[0]?.t === 'id' && s.args[0].name === id,
  )
}

/** The name of a fit's x, as its points line calls it. */
function fitX(fit: Decl): string {
  const points = fit.body?.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'points')
  const x = points?.args[0]
  return x?.t === 'id' ? x.name : 'x'
}
