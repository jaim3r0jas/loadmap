import type { Decl, Expr, Property, Stmt } from './ast'
import { type CompileOptions, compile } from './compile'
import { parse } from './parser'
import { type ArgSpec, type BlockSpec, BOXES, matchArgs, own, type PropSpec, SCHEMA } from './schema'

/**
 * What a reader can change without the text, and the change it makes to the text. The text stays the one source:
 * `inspect()` reads the fields from it, `edit()` turns a new value into the smallest replacement and works it out
 * again from the text it is given, so an edit never lands on a stale place.
 */

export type Provenance = 'measured' | 'estimated' | 'configured'
export type OptionValue = number | string
/** A formula as written, cut at its number literals: slot n is changed through the key `${field.key}#n`. */
export type FormulaPart = string | { slot: number; value: number }

interface FieldBase {
  /** What `edit()` takes to change it. */
  key: string
  label: string
  doc: string
  /** Waits under "More": the schema marks the ones shown first. */
  more: boolean
}

export type InspectField = FieldBase &
  (
    | { kind: 'text'; value: string }
    | { kind: 'number'; value: number }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'choice'; value: OptionValue; choices: readonly OptionValue[] }
    | { kind: 'options'; value: OptionValue[] }
    /** Read-only but for its numbers. */
    | { kind: 'formula'; parts: FormulaPart[] }
    /**
     * `measured(value ± within, unit, source)`: `${key}.provenance`, `.within` (null takes it out), `.unit`,
     * `.source` (null takes it out), and the value's numbers as `${key}#n`.
     */
    | {
        kind: 'capacity'
        provenance: Provenance
        value: FormulaPart[]
        /** "formula" when the ± is computed: it is then shown in the value, not changed here. */
        within: number | null | 'formula'
        /** The ± is a share of the value (`± 30%`), or in the capacity's unit. */
        percent: boolean
        unit: string
        source: string | null
      }
  )

export interface InspectSection {
  /** The statement's keyword: node, workers, autoscale, param, flow, … */
  keyword: string
  id?: string
  title: string
  fields: InspectField[]
}

export interface Inspection {
  title: string
  sections: InspectSection[]
}

/** A box of the diagram by its id, or what the whole model declares (title, load, growth, parameters, flows). */
export type InspectTarget = { node: string } | 'model'

export interface TextChange {
  from: number
  to: number
  insert: string
}

export type EditValue = string | number | boolean | null | readonly OptionValue[]
export type EditResult = { source: string; changes: TextChange[] } | { error: string }

/** The fields of a box or of the model; null when the text has a syntax error or no such box. */
export function inspect(source: string, target: InspectTarget): Inspection | null {
  const w = walk(source)
  if (!w) return null
  if (target === 'model') {
    const top = w.owners.filter((o) => o.depth === 1 && MODEL.has(o.keyword))
    const sections = [w.root, ...top.flatMap((o) => [o, ...descendants(o)])].map(section).filter((s) => s.fields.length)
    return { title: w.root.title, sections }
  }
  const box = w.owners.find((o) => o.depth === 1 && isBox(o.keyword) && o.id === target.node)
  if (!box) return null
  const own = [box, ...descendants(box)]
  // a stage may use a component declared on its own; and the parameters its formulas read (through lets too) come along
  const components = new Set(own.flatMap((o) => o.uses))
  const lets = new Map(w.owners.filter((o) => o.depth === 1 && o.keyword === 'let').map((o) => [o.id, o.reads]))
  const reads = new Set(own.flatMap((o) => [...o.reads]))
  for (const r of reads) for (const x of lets.get(r) ?? []) reads.add(x)
  const extra = w.owners.filter(
    (o) =>
      o.depth === 1 &&
      !!o.id &&
      ((o.keyword === 'component' && components.has(o.id)) || (o.keyword === 'param' && reads.has(o.id))),
  )
  return { title: box.title, sections: [...own, ...extra].map(section).filter((s) => s.fields.length) }
}

/**
 * The text with one field changed: the smallest replacement, worked out from `source`. Refused (with the reason)
 * when the value does not fit the field, or the definition would no longer compile.
 */
export function edit(source: string, key: string, value: EditValue, options?: CompileOptions): EditResult {
  const w = walk(source)
  if (!w) return { error: 'the text has a syntax error' }
  const base = key.replace(/(#\d+|\.(provenance|within|unit|source))$/, '')
  const entry = w.entries.get(base)
  if (!entry) return { error: `nothing to change at "${key}"` }
  const changes = entry.apply(key.slice(base.length), value)
  if (typeof changes === 'string') return { error: changes }
  changes.sort((a, b) => b.from - a.from)
  let next = source
  for (const c of changes) next = next.slice(0, c.from) + c.insert + next.slice(c.to)
  const broken = compile(next, options).diagnostics.find((d) => d.severity === 'error')
  if (broken) return { error: broken.message }
  return { source: next, changes: changes.reverse() }
}

// -- reading the text -----------------------------------------------------------------------------------------

/** The statements of the model tab, in the order they come in the text. */
const MODEL = new Set(['load', 'growth', 'param', 'flow', 'let', 'thresholds', 'fit'])

interface Entry {
  field: InspectField
  /** The changes for a value; a text is the reason it is refused. */
  apply: (part: string, value: EditValue) => TextChange[] | string
}

/** A statement and the fields of its own lines. */
interface Owner {
  keyword: string
  id?: string
  title: string
  depth: number
  fields: InspectField[]
  children: Owner[]
  /** The names its formulas read, and the components its stages name. */
  reads: Set<string>
  uses: string[]
}

const isBox = (k: string) => (BOXES as readonly string[]).includes(k)
const descendants = (o: Owner): Owner[] => o.children.flatMap((c) => [c, ...descendants(c)])
const section = (o: Owner): InspectSection => ({
  keyword: o.keyword,
  ...(o.id ? { id: o.id } : {}),
  title: o.title,
  fields: o.fields,
})

function walk(source: string) {
  const { doc, report } = parse(source)
  if (report.failed) return null
  const entries = new Map<string, Entry>()
  const owners: Owner[] = []
  const { parts, number, quote, slot, slotsOnly } = writer(source)

  const add = (o: Owner, field: InspectField, apply: Entry['apply']) => {
    o.fields.push(field)
    entries.set(field.key, { field, apply })
  }

  const owner = (keyword: string, spec: BlockSpec, d: Decl | null, path: string, depth: number): Owner => {
    const { filled } = d ? matchArgs(spec.args, d.args) : { filled: new Map<ArgSpec, Expr>() }
    const arg = (name: ArgSpec['name']) => [...filled].find(([s]) => s.name === name)?.[1]
    const idArg = arg('id')
    const id = idArg?.t === 'id' ? idArg.name : undefined
    const label = arg('label')
    const here = `${path}${path ? '/' : ''}${keyword}${id ? `:${id}` : ''}`
    const o: Owner = {
      keyword,
      ...(id ? { id } : {}),
      title: label?.t === 'str' ? label.value : (id ?? words(keyword || 'model')),
      depth,
      fields: [],
      children: [],
      reads: new Set(),
      uses: [],
    }
    owners.push(o)
    if (d) for (const a of d.args) names(a, o.reads)
    for (const slot of spec.args) {
      if (slot.kind !== 'text') continue
      const a = arg(slot.name)
      const key = `${here}/@${slot.name}`
      const base = { key, label: words(slot.name === 'sub' ? 'second line' : slot.name), doc: '', more: false }
      if (a?.t === 'str' || (a?.t === 'tpl' && !a.parts.length)) {
        const value = a.t === 'str' ? a.value : a.quasis[0]!
        add(o, { ...base, kind: 'text', value }, (_, v) =>
          typeof v === 'string' ? [replace(a, quote(v, a))] : 'a text',
        )
      } else if (a?.t === 'tpl') add(o, { ...base, kind: 'formula', parts: parts(a) }, slotsOnly(a))
      else if (!a && slot.name === 'label' && isBox(keyword) && d && id) {
        // a box without a label shows its id: writing one puts it after the id
        const at = idArg!.to
        add(o, { ...base, kind: 'text', value: '' }, (_, v) =>
          typeof v === 'string' ? (v ? [{ from: at, to: at, insert: ` ${quote(v)}` }] : []) : 'a text',
        )
      }
    }
    if (d?.init) {
      names(d.init, o.reads)
      add(
        o,
        { key: `${here}/=`, label: 'Formula', doc: spec.doc, more: false, kind: 'formula', parts: parts(d.init) },
        slotsOnly(d.init),
      )
    }
    const body = d ? (d.body ?? []) : doc.body
    const seen = new Map<string, number>()
    for (const s of body) {
      if (s.kind === 'prop') {
        names(s.value, o.reads)
        const p = own(spec.props, s.key.name)
        // a repeated property (assume) is told apart by its place
        const n = (seen.get(s.key.name) ?? 0) + 1
        seen.set(s.key.name, n)
        if (p) prop(o, `${here}/${s.key.name}${n > 1 ? `~${n}` : ''}`, s, p, body)
        if (!d && s.key.name === 'title' && s.value.t === 'str') o.title = s.value.value
        if (p?.value === 'component' && s.value.t === 'id') o.uses.push(s.value.name)
      } else if (s.kind === 'decl' && spec.children.includes(s.keyword.name)) {
        const k = s.keyword.name
        const child = SCHEMA[k]!
        o.children.push(owner(k, child, s, here, depth + 1))
      } else if (s.kind === 'edge' && s.value) names(s.value, o.reads)
    }
    return o
  }

  const prop = (o: Owner, key: string, s: Property, p: PropSpec, body: Stmt[]) => {
    const e = s.value
    const base = { key, label: words(s.key.name), doc: p.doc, more: p.inspector !== 'main' }
    const n = literal(e)
    if (p.value === 'capacity' && e.t === 'call' && isProvenance(e.callee.name)) {
      const c = capacity(o, base, e)
      if (c) return
    }
    if (p.value === 'options' && e.t === 'array' && e.items.every((i) => literal(i) != null || i.t === 'str')) {
      const value = e.items.map((i) => (i.t === 'str' ? i.value : literal(i)!))
      return add(o, { ...base, kind: 'options', value }, (_, v) => {
        if (!Array.isArray(v) || !v.length) return 'at least one option'
        if (!v.every((x) => typeof x === 'string' || Number.isFinite(x))) return 'options are numbers or texts'
        // an option kept is written as it was; a new number is grouped with "_" when any of them was
        const was = (x: OptionValue) => e.items.find((i) => (i.t === 'str' ? i.value : literal(i)) === x)
        const grouped = e.items.find((i) => i.t !== 'str' && source.slice(i.from, i.to).includes('_'))
        const items = v.map((x) => {
          const old = was(x)
          if (old) return source.slice(old.from, old.to)
          return typeof x === 'string'
            ? quote(
                x,
                e.items.find((i) => i.t === 'str'),
              )
            : number(x, grouped)
        })
        const out = [replace(e, `[${items.join(', ')}]`)]
        // the default must stay one of the options: it moves to the first
        const d = body.find((x): x is Property => x.kind === 'prop' && x.key.name === 'default')
        const dv = d && (d.value.t === 'str' ? d.value.value : literal(d.value))
        if (d && dv != null && !v.includes(dv)) out.push(replace(d.value, items[0]!))
        return out
      })
    }
    if (p.value === 'value' && o.keyword === 'param') {
      const options = body.find((x): x is Property => x.kind === 'prop' && x.key.name === 'options')?.value
      if (options?.t === 'array') {
        const choices = options.items.map((i) => (i.t === 'str' ? i.value : literal(i))).filter((x) => x != null)
        const value = e.t === 'str' ? e.value : n
        if (value == null) return add(o, { ...base, kind: 'formula', parts: parts(e) }, slotsOnly(e))
        return add(o, { ...base, kind: 'choice', value, choices }, (_, v) => {
          if (typeof v !== 'number' && typeof v !== 'string') return 'one of the options'
          if (!choices.includes(v)) return 'one of the options'
          return [replace(e, typeof v === 'string' ? quote(v, e.t === 'str' ? e : undefined) : number(v, e))]
        })
      }
    }
    if ((p.value === 'boolean' || p.value === 'value') && e.t === 'bool')
      return add(o, { ...base, kind: 'boolean', value: e.value }, (_, v) =>
        typeof v === 'boolean' ? [replace(e, String(v))] : 'true or false',
      )
    if ((p.value === 'number' || p.value === 'value') && n != null)
      return add(o, { ...base, kind: 'number', value: n }, (_, v) => {
        return typeof v === 'number' && Number.isFinite(v) ? [replace(e, number(v, e))] : 'a number'
      })
    if (p.value === 'enum' && p.values && (e.t === 'id' || e.t === 'str')) {
      const word = e.t === 'id' ? e.name : e.value
      if (p.values.includes(word))
        return add(o, { ...base, kind: 'choice', value: word, choices: p.values }, (_, v) =>
          typeof v === 'string' && p.values!.includes(v)
            ? [replace(e, e.t === 'str' ? quote(v, e) : v)]
            : `one of ${p.values!.join(', ')}`,
        )
    }
    if ((p.value === 'string' || p.value === 'enum') && e.t === 'str')
      return add(o, { ...base, kind: 'text', value: e.value }, (_, v) =>
        typeof v === 'string' ? [replace(e, quote(v, e))] : 'a text',
      )
    if (
      p.value === 'number' ||
      p.value === 'string' ||
      p.value === 'boolean' ||
      p.value === 'capacity' ||
      p.value === 'value'
    )
      add(o, { ...base, kind: 'formula', parts: parts(e) }, slotsOnly(e))
  }

  const capacity = (o: Owner, base: FieldBase, call: Extract<Expr, { t: 'call' }>) => {
    const [first, unit, src, ...rest] = call.args
    if (!first || unit?.t !== 'str' || (src && src.t !== 'str') || rest.length) return false
    const pm = first.t === 'pm' ? first : undefined
    const value = pm ? pm.value : first
    const within = pm ? (literal(pm.within) ?? 'formula') : null
    add(
      o,
      {
        ...base,
        kind: 'capacity',
        provenance: call.callee.name as Provenance,
        value: parts(value),
        within,
        percent: pm ? pm.percent : true,
        unit: unit.value,
        source: src?.value ?? null,
      },
      (part, v) => {
        if (part.startsWith('#')) return slot(value, part, v)
        if (part === '.provenance') {
          if (typeof v !== 'string' || !isProvenance(v)) return 'measured, estimated or configured'
          const out = [replace(call.callee, v)]
          // a configured capacity is exact
          if (v === 'configured' && pm) out.push({ from: pm.value.to, to: pm.to, insert: '' })
          return out
        }
        if (part === '.within') {
          if (v === null) return pm ? [{ from: pm.value.to, to: pm.to, insert: '' }] : []
          if (typeof v !== 'number' || !(v > 0)) return 'a number above 0'
          if (call.callee.name === 'configured') return 'a configured capacity is exact: it takes no ±'
          if (!pm) return [{ from: value.to, to: value.to, insert: ` ± ${number(v)}%` }]
          if (within === 'formula') return 'the ± is a formula here: change it in the text'
          return [replace(pm.within, number(v, pm.within))]
        }
        if (part === '.unit') return typeof v === 'string' && v ? [replace(unit, quote(v, unit))] : 'a unit'
        if (part === '.source') {
          if (v !== null && typeof v !== 'string') return 'a text'
          if (!v) return src ? [{ from: unit.to, to: src.to, insert: '' }] : []
          return src ? [replace(src, quote(v, src))] : [{ from: unit.to, to: unit.to, insert: `, ${quote(v, unit)}` }]
        }
        return 'change the capacity by its parts'
      },
    )
    return true
  }

  const root = owner('', SCHEMA['']!, null, '', 0)
  return { root, owners, entries }
}

const isProvenance = (s: string): s is Provenance => s === 'measured' || s === 'estimated' || s === 'configured'

/** The value of a number literal, signed or not. */
function literal(e: Expr): number | undefined {
  if (e.t === 'num') return e.value
  if (e.t === 'unary' && e.op === '-' && e.arg.t === 'num') return -e.arg.value
  return undefined
}

/** The number literals of a formula, in the order they are written (template parts included). */
function numbers(e: Expr, out: Extract<Expr, { t: 'num' }>[] = []) {
  if (e.t === 'num') out.push(e)
  for (const k of kids(e)) numbers(k, out)
  return out.sort((a, b) => a.from - b.from)
}

function kids(e: Expr): Expr[] {
  switch (e.t) {
    case 'unary':
      return [e.arg]
    case 'pm':
      return [e.value, e.within]
    case 'cond':
      return [e.test, e.then, e.else]
    case 'bin':
      return [e.left, e.right]
    case 'call':
      return e.args
    case 'array':
      return e.items
    case 'tpl':
      return e.parts
    default:
      return []
  }
}

/** The names a formula reads: parameters, lets, fits. */
function names(e: Expr, out: Set<string>) {
  if (e.t === 'id') out.add(e.name)
  if (e.t === 'call') out.add(e.callee.name)
  for (const k of kids(e)) names(k, out)
}

/** What turns values into text: numbers, quotes and formula pieces written like the text they replace. */
function writer(source: string) {
  const text = (e: { from: number; to: number }) => source.slice(e.from, e.to)

  const parts = (e: Expr): FormulaPart[] => {
    const out: FormulaPart[] = []
    let at = e.from
    numbers(e).forEach((n, slot) => {
      if (n.from > at) out.push(source.slice(at, n.from))
      out.push({ slot, value: n.value })
      at = n.to
    })
    if (at < e.to) out.push(source.slice(at, e.to))
    return out
  }

  /** A number as the language writes it, grouped with "_" when the one it replaces was. */
  const number = (n: number, like?: Expr): string => {
    if (like && literal(like) === n) return text(like)
    const s = String(n)
    if (!like || !text(like).includes('_') || /e/i.test(s)) return s
    const [int, frac] = s.replace('-', '').split('.')
    const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '_')
    return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
  }

  /** A text in the quotes of the one it replaces (double quotes for a new one). */
  const quote = (s: string, like?: Expr): string => {
    const q = like ? (text(like)[0] ?? '"') : '"'
    const esc = s.replaceAll('\\', '\\\\').replaceAll(q, `\\${q}`).replaceAll('\n', '\\n').replaceAll('\t', '\\t')
    return `${q}${q === '`' ? esc.replaceAll('${', '\\${') : esc}${q}`
  }

  /** The change of one number of a formula. */
  const slot = (e: Expr, part: string, v: EditValue): TextChange[] | string => {
    const n = numbers(e)[Number(part.slice(1))]
    if (!n) return `the formula has no number ${part}`
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'a number'
    const t = number(v, n)
    return [replace(n, v < 0 ? `(${t})` : t)]
  }

  const slotsOnly =
    (e: Expr): Entry['apply'] =>
    (part, v) =>
      part.startsWith('#') ? slot(e, part, v) : 'a formula: change its numbers, or the formula in the text'

  return { parts, number, quote, slot, slotsOnly }
}

const replace = (at: { from: number; to: number }, insert: string): TextChange => ({ from: at.from, to: at.to, insert })

/** "perPod" → "Per pod". */
function words(k: string): string {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
