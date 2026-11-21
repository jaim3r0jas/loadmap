import type { Published } from '@loadmap/core'
import { childrenOf, type Decl, type Expr, type Property, type Stmt } from './ast'
import { componentOf } from './catalog'
import { type CompileOptions, type CompileResult, compile, copiesOf, type Where } from './compile'
import { type Files, fileText } from './files'
import { type Suffix, unitScale } from './lexer'
import { likeness } from './names'
import { parse } from './parser'
import { type ArgSpec, type BlockSpec, BOXES, matchArgs, own, type PropSpec, propNamed, SCHEMA } from './schema'
import { CURRENT, plusMinusMark, stampOf } from './versions'
import { isViewKey, viewOf } from './viewblock'

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
  /**
   * For an input of a copy that its `with` does not set: the statement whose default it shows (`region`). A change
   * writes it in the `with`.
   */
  from?: string
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
  /** Where it is in the text, unique in one inspection: what its fields' keys start with. */
  path: string
  /** The statement's keyword: node, workers, autoscale, param, flow, … */
  keyword: string
  /** The file it is written in, from the project root, when that is not the text that was inspected. */
  file?: string
  id?: string
  title: string
  fields: InspectField[]
  /**
   * For a box that says `like:`: the other box, and the lines and stages it takes from it by their names (none known
   * when the other is in another file). A field of one of those is written here to replace it.
   */
  like?: {
    from: string
    taken: string[]
    /** The lines among them, as the other box writes them: `takeLine()` writes one here, to change it. */
    lines: { name: string; text: string }[]
  }
}

export interface Inspection {
  title: string
  sections: InspectSection[]
}

/**
 * A box of the diagram by its id, or what the whole model declares (title, load, growth, parameters, flows). A box
 * written inside a subsystem has no statement at the top under its id on the diagram (`eu.api` is the `api` of the
 * subsystem `eu` is like): it is found by `path`, its place in the text (`boxPath()`).
 */
export type InspectTarget = { node: string; path?: string } | 'model'

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
    const top = w.owners.filter((o) => o.depth === 1 && own(SCHEMA, o.keyword)?.inspector === 'model')
    const sections = [w.root, ...top.flatMap((o) => [o, ...descendants(o)])].map(section).filter((s) => s.fields.length)
    return { title: w.root.title, sections }
  }
  const box = w.owners.find(
    (o) => isBox(o.keyword) && (target.path ? o.path === target.path : o.depth === 1 && o.id === target.node),
  )
  if (!box?.id) return null
  const mine = [box, ...descendants(box)]
  // a stage may use a component declared on its mine; and the parameters its formulas read (through lets too) come along
  const extra = around(
    w.owners,
    box,
    mine.flatMap((o) => [...o.reads]),
    mine.flatMap((o) => o.uses),
  )
  const sections = [...mine, ...extra].map(section).filter((s) => s.fields.length)
  // where the lines it does not write come from: said on the box's own section. The other box is one of the top,
  // also for a box in a subsystem
  const body = parse(source).doc.body
  const like = likeness(body, box.id, box.decl)
  const first = sections.find((s) => s.path === box.path)
  if (like && first)
    first.like = {
      ...like,
      lines: takenLines(source, box.id, body, box.decl).map(({ name, text }) => ({ name, text })),
    }

  return { title: box.title, sections }
}

/**
 * What a statement at `at` reads that the inspector shows beside it: the parameters, published figures and measures
 * its formulas read (through lets too), and the components its stages use. Each name as it is read there: the
 * nearest statement that declares it hides the same name further out (an input of its subsystem, a parameter of the
 * top).
 */
function around(owners: readonly Owner[], at: { path: string }, read: Iterable<string>, uses: Iterable<string>) {
  // what it can name: the statements at the top and those of each subsystem around it, the nearest first
  const scope = owners
    .filter((o) => o.depth > 0 && o !== at && holds(o.path.slice(0, Math.max(0, o.path.lastIndexOf('/'))), at.path))
    .sort((a, b) => b.depth - a.depth)
  const named = new Map<string, Owner>()
  for (const o of scope) {
    const name = declared(o)
    if (name && !named.has(name)) named.set(name, o)
  }
  // a published figure reads parameters as a let does
  const reads = new Set(read)
  for (const r of reads) {
    const o = named.get(r)
    if (o && (o.keyword === 'let' || o.keyword === 'published' || o.keyword === 'measure'))
      for (const x of o.reads) reads.add(x)
  }
  const components = new Set(uses)
  return scope.filter(
    (o) =>
      !!o.id &&
      ((o.keyword === 'component' &&
        components.has(o.id) &&
        scope.find((x) => x.keyword === 'component' && x.id === o.id) === o) ||
        ((o.keyword === 'param' || o.keyword === 'published' || o.keyword === 'measure') &&
          reads.has(o.id) &&
          named.get(o.id) === o)),
  )
}

/** A copy of a subsystem, as the Box panel shows it for a box drawn in it (`inspectCopy()`). */
export interface CopyInspection {
  /** The subsystem of the diagram whose `with` sets this copy: `us`. */
  copy: string
  title: string
  /** The file its statement is written in, from the project root. */
  file: string
  /**
   * The inputs that reach the box, as this copy sets them (keyword `with`; a field with `from` shows a default), then
   * the parameters those values read. Every key is of `file`.
   */
  sections: InspectSection[]
}

/**
 * The values a box of a copy takes from that copy alone. A box written in a subsystem is one statement for a box in
 * every copy of it (`eu.api`, `us.api`); what tells the copies apart is the `with` of each, the innermost statement
 * that writes this copy only. Its inputs that reach the box's lines are followed in from there (through the `with`s
 * of the subsystems and prototypes in between, which every copy shares) and shown as that `with` sets them, or as their
 * default when it does not: a change writes the `with`, and changes this copy alone.
 *
 * `read` are the texts `r` was compiled from (its places are in them), `now` the texts as they are: places are worked
 * out in the first, values read in the second. `path` is the file the result's places without one are in. Null for a
 * box written for itself alone, or when the texts have moved too far since the compile.
 */
export function inspectCopy(
  r: CompileResult,
  box: string,
  o: { path: string; read: Files; now: Files },
): CopyInspection | null {
  const fileOf = (w: Where) => w.file ?? o.path
  const same = (a: Where, b: Where) => fileOf(a) === fileOf(b) && a.from === b.from
  const nodes = r.symbols.filter((s) => s.kind === 'node')
  const b = nodes.find((s) => s.id === box)
  if (!b) return null
  const at: Where = { ...b.decl, ...(b.file != null && { file: b.file }) }
  if (nodes.filter((s) => same({ ...s.decl, ...(s.file != null && { file: s.file }) }, at)).length < 2) return null
  const { subsystems, likes } = copiesOf(r)
  const outer = subsystems.filter((s) => box.startsWith(`${s.id}.`)).sort((x, y) => x.id.length - y.id.length)
  // the innermost statement written for this copy alone
  const i = outer.findLastIndex((s) => subsystems.filter((x) => same(x.decl, s.decl)).length === 1)
  const site = outer[i]
  if (!site) return null
  const likeOf = (w: Where) => likes.find((l) => same(l.site, w))?.to
  // from that statement in: each statement, then the ones it is like; the next subsystem inside, then the box
  const chain: Where[] = []
  const follow = (w: Where) => {
    chain.push(w)
    for (let t = likeOf(w), n = 0; t && n < 16; t = likeOf(t), n++) chain.push(t)
  }
  for (const s of outer.slice(i)) follow(s.decl)
  follow(at)
  if (!likeOf(chain[0]!)) return null

  // each statement in the texts compiled, by its place, then as it is written now
  const parsed = new Map<string, readonly Stmt[]>()
  const bodyOf = (files: Files, file: string, tag: string) => {
    const key = `${tag}\n${file}`
    if (!parsed.has(key)) {
      const text = fileText(files, file)
      parsed.set(key, text == null ? [] : parse(text).doc.body)
    }
    return parsed.get(key)!
  }
  const places = chain.map((w) => placeOf(bodyOf(o.read, fileOf(w), 'read'), w.from))
  const decls = places.map((p, k) => (p ? declAt(bodyOf(o.now, fileOf(chain[k]!), 'now'), p.path) : undefined))
  if (decls.some((d) => !d)) return null
  const d = decls as Decl[]
  const liked = (k: number) => k > 0 && !!likeOf(chain[k - 1]!) && same(likeOf(chain[k - 1]!)!, chain[k]!)

  // the names the box's lines read, followed out to the statement that is like the copy's subsystem
  let pending = readsOf(d.at(-1)!)
  let need = new Set<string>()
  for (let k = d.length - 1; k > 0; k--) {
    const lets = letsOf(d[k]!)
    for (const x of pending) for (const y of lets.get(x) ?? []) pending.add(y)
    const inputs = inputsOf(d[k]!)
    need = new Set([...pending].filter((x) => inputs.has(x)))
    if (!liked(k)) {
      // written inside the one before: what it does not declare is read there
      pending = new Set([...pending].filter((x) => !inputs.has(x) && !lets.has(x)))
      continue
    }
    if (k === 1) break
    // the one before sets them in its `with`; a box also reads its own lines there
    const p = d[k - 1]!
    pending = isBox(p.keyword.name) ? readsOf(p) : new Set()
    for (const x of need) {
      const line = withLine(p, x)
      if (line) names(line.value, pending)
    }
  }
  if (!liked(1)) return null

  const siteFile = fileOf(chain[0]!)
  const siteText = fileText(o.now, siteFile) ?? ''
  const sitePath = places[0]!.path
  const template = d[1]!
  const templateText = fileText(o.now, fileOf(chain[1]!)) ?? ''
  const w = walk(siteText, true)
  if (!w) return null
  const withPath = `${sitePath}/with`
  const fields: InspectField[] = []
  const read = new Set<string>()
  const doc = `A value of ${site.id} alone: a change writes it in its "with", and changes no other copy.`
  for (const [name, input] of inputsOf(template)) {
    if (!need.has(name)) continue
    const key = `${withPath}/${name}`
    const set = w.entries.get(key)
    if (set) {
      fields.push({ ...set.field, label: name, doc, more: false })
      const line = withLine(d[0]!, name)
      if (line) names(line.value, read)
    } else if (input.init) fields.push(defaulted(key, name, input.init, templateText, idOf(template) ?? '', doc))
  }
  const owner = w.owners.find((x) => x.path === sitePath)
  const extra = owner ? around(w.owners, owner, read, []) : []
  const label = d[0]!.args[1]
  return {
    copy: site.id,
    title: label?.t === 'str' ? label.value : site.id,
    file: siteFile,
    sections: [
      { path: withPath, keyword: 'with', title: label?.t === 'str' ? label.value : site.id, fields, file: siteFile },
      ...extra.map((x) => ({ ...section(x), file: siteFile })).filter((x) => x.fields.length),
    ],
  }
}

/** An input's default, shown for a copy that does not set it: a value to change, or a formula to read. */
function defaulted(key: string, name: string, e: Expr, text: string, from: string, doc: string): InspectField {
  const base = { key, label: name, doc, more: false, from }
  const n = literal(e)
  if (n != null && !unitOf(e)) return { ...base, kind: 'number', value: n }
  if (e.t === 'bool') return { ...base, kind: 'boolean', value: e.value }
  if (e.t === 'str') return { ...base, kind: 'text', value: e.value }
  return { ...base, kind: 'formula', parts: [text.slice(e.from, e.to)] }
}

/** The statement that starts at `from`, and its place as `walk()` names it. */
function placeOf(body: readonly Stmt[], from: number): { decl: Decl; path: string } | undefined {
  let path = ''
  for (let list: readonly Stmt[] | undefined = body; list; ) {
    const d: Decl | undefined = list.find((s): s is Decl => s.kind === 'decl' && s.from <= from && from < s.to)
    if (!d) return undefined
    path = `${path}${path ? '/' : ''}${segment(d)}`
    if (d.from === from) return { decl: d, path }
    list = d.body
  }
  return undefined
}

/** Every name a statement's own lines read, its stages and nested statements too, but not its `with` or inputs. */
function readsOf(d: Decl, out = new Set<string>()): Set<string> {
  for (const [k, a] of d.args.entries()) if (k > 0 || a.t !== 'id') names(a, out)
  if (d.init) names(d.init, out)
  for (const s of d.body ?? [])
    if (s.kind === 'prop' && s.key.name !== 'like') names(s.value, out)
    else if (s.kind === 'decl' && s.keyword.name !== 'with' && s.keyword.name !== 'input') readsOf(s, out)
    else if (s.kind === 'edge' && s.value) names(s.value, out)
  return out
}

/** The inputs a prototype or a subsystem declares, by name, but those that take a flow. */
function inputsOf(d: Decl): Map<string, Decl> {
  const out = new Map<string, Decl>()
  for (const s of d.body ?? []) {
    if (s.kind !== 'decl' || s.keyword.name !== 'input') continue
    const [first, second] = s.args
    if (first?.t === 'id' && !(first.name === 'flow' && second?.t === 'id')) out.set(first.name, s)
  }
  return out
}

/** The lets of a subsystem, each with the names it reads. */
function letsOf(d: Decl): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const s of d.body ?? [])
    if (s.kind === 'decl' && s.keyword.name === 'let' && s.args[0]?.t === 'id')
      out.set(s.args[0].name, s.init ? readsOf(s) : new Set())
  return out
}

/** The line of a `with` that sets `name`. */
const withLine = (d: Decl, name: string) =>
  d.body
    ?.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'with')
    ?.body?.find((s): s is Property => s.kind === 'prop' && s.key.name === name)

/** An input of a copy, `subsystem:us/with/pods`: the place of the statement that is like, and the input's name. */
const INPUT_KEY = /^(.+)\/with\/([A-Za-z_]\w*)$/

/**
 * The text with one field changed: the smallest replacement, worked out from `source`. Refused (with the reason)
 * when the value does not fit the field, or the definition would no longer compile. An input of a copy that its
 * `with` does not set yet (`inspectCopy()`) is written there, the `with` block too when there is none.
 */
export function edit(source: string, key: string, value: EditValue, options?: CompileOptions): EditResult {
  const w = walk(source, INPUT_KEY.test(key.replace(/#\d+$/, '')))
  if (!w) return { error: 'the text has a syntax error' }
  const base = key.replace(/(#\d+|\.(provenance|within|unit|source))$/, '')
  const entry = w.entries.get(base)
  const input = !entry && INPUT_KEY.exec(key)
  if (input) return setInput(source, input[1]!, input[2]!, value, options)
  if (!entry) return { error: `nothing to change at "${key}"` }
  const changes = entry.apply(key.slice(base.length), value)
  if (typeof changes === 'string') return { error: changes }
  return checked(source, changes, options)
}

/**
 * The place of the box whose lines hold `offset`, as `inspect()` and `takeLine()` take it. The compiler gives a box
 * written in a subsystem an id for each subsystem that is like it, and the offsets of the one statement that writes
 * them all: this is that statement, by the names around it, which hold while the text changes elsewhere.
 */
export function boxPath(source: string, offset: number): string | undefined {
  const { doc, report } = parse(source)
  if (report.failed) return undefined
  let found: string | undefined
  let path = ''
  for (let body: readonly Stmt[] | undefined = doc.body; body; ) {
    const d: Decl | undefined = body.find((s): s is Decl => s.kind === 'decl' && s.from <= offset && offset <= s.to)
    if (!d) break
    path = `${path}${path ? '/' : ''}${segment(d)}`
    if (isBox(d.keyword.name) && idOf(d)) found = path
    body = d.body
  }
  return found
}

/** A statement's id, where it has one: its first word after the keyword. */
const idOf = (d: Decl) => (d.args[0]?.t === 'id' ? d.args[0].name : undefined)
/** A statement in a path, as `walk()` names it. */
const segment = (d: Decl) => `${d.keyword.name}${idOf(d) ? `:${idOf(d)}` : ''}`
/** The names a statement can be read by, among those the inspector follows; an input by its last word. */
const NAMES = new Set(['input', 'let', 'param', 'published', 'measure', 'fit', 'metric'])
const declared = (o: Owner) => {
  if (!NAMES.has(o.keyword)) return undefined
  const last = o.keyword === 'input' ? o.decl?.args.findLast((a) => a.t === 'id') : undefined
  return last?.t === 'id' ? last.name : o.id
}

/** Whether the statement at `path` is around the one at `inner` (the top, `''`, is around every one). */
const holds = (path: string, inner: string) => !path || inner.startsWith(`${path}/`)

/** The statement at `path`, a place `boxPath()` gives. */
function declAt(body: readonly Stmt[], path: string): Decl | undefined {
  let d: Decl | undefined
  for (const part of path.split('/')) {
    d = (d ? (d.body ?? []) : body).find((s): s is Decl => s.kind === 'decl' && segment(s) === part)
    if (!d) return undefined
  }
  return d
}

/** A box of the text by its id. */
const boxNamed = (body: readonly Stmt[], id: string) =>
  body.find(
    (s): s is Decl =>
      s.kind === 'decl' &&
      (BOXES as readonly string[]).includes(s.keyword.name) &&
      s.args[0]?.t === 'id' &&
      s.args[0].name === id,
  )

/** The tables a box's own lines read it through: a line taken reads the box that takes it (expand.ts). */
const SELF = new Set(['at', 'out', 'demand', 'util'])

/**
 * A line of the box `from` as the box `to` takes it: its text, with every `at.<from>`, `out.<from>`, `demand.<from>`
 * and `util.<from>` naming `to`, as the compiler reads a taken line.
 */
function asTaken(source: string, p: Property, from: string, to: string, start: number): string {
  const spans: { from: number; to: number }[] = []
  const walk = (e: Expr) => {
    if (e.t === 'member' && SELF.has(e.object.name) && e.prop.name === from) spans.push(e.prop)
    for (const c of childrenOf(e, true)) walk(c)
  }
  walk(p.value)
  let text = source.slice(start, p.as?.to ?? p.to)
  for (const s of spans.sort((x, y) => y.from - x.from))
    if (s.from >= start) text = text.slice(0, s.from - start) + to + text.slice(s.to - start)
  return text
}

/**
 * The lines a box takes from the box it is like, each as this box reads it: from the first box of the chain that
 * writes it, the other box's own name in it made this one's.
 */
function takenLines(
  source: string,
  id: string,
  body: readonly Stmt[],
  self?: Decl,
): { name: string; text: string; line: string }[] {
  const like = likeness(body, id, self)
  const out: { name: string; text: string; line: string }[] = []
  const seen = new Set<Decl>()
  for (let d = like && boxNamed(body, like.from); d && !seen.has(d); ) {
    seen.add(d)
    const other = d.args[0]?.t === 'id' ? d.args[0].name : ''
    for (const s of d.body ?? [])
      if (s.kind === 'prop' && like!.taken.includes(s.key.name) && !out.some((o) => o.name === s.key.name))
        out.push({
          name: s.key.name,
          text: asTaken(source, s, other, id, s.value.from),
          line: asTaken(source, s, other, id, s.from),
        })
    const next = d.body?.find((s): s is Property => s.kind === 'prop' && s.key.name === 'like')
    d = next?.value.t === 'id' ? boxNamed(body, next.value.name) : undefined
  }
  return out
}

/**
 * The text with a line a box takes from the box it is like written into the box itself, as the box reads it: from then
 * on it is this box's own, and a change to it changes this box only. Refused when the box takes no such line. A box
 * inside a subsystem is given by `path` (`boxPath()`), which says its name there: `box` is then only for the message.
 */
export function takeLine(
  source: string,
  box: string,
  name: string,
  options?: CompileOptions,
  path?: string,
): EditResult {
  const { doc, report } = parse(source)
  if (report.failed) return { error: 'the text has a syntax error' }
  const d = path ? declAt(doc.body, path) : boxNamed(doc.body, box)
  const taken = d && takenLines(source, idOf(d) ?? box, doc.body, d).find((l) => l.name === name)
  if (!d || !taken) return { error: `"${box}" takes no "${name}" from another box` }
  const change = appendTo(source, d, taken.line)
  return typeof change === 'string' ? { error: `"${box}" ${change}` } : checked(source, [change], options)
}

/**
 * A line written last in a statement's block: after a ";" in a block on one line, else on a line of its own under
 * the last statement's line, a comment at its end left where it is. The reason when it cannot be.
 */
function appendTo(source: string, d: Decl, line: string): TextChange | string {
  if (!d.bodySpan) return 'has no block to write it in'
  const last = d.body?.at(-1)
  if (!last) {
    const inner = { from: d.bodySpan.from + 1, to: d.bodySpan.to - 1 }
    if (!/^\s*$/.test(source.slice(inner.from, inner.to))) return 'has only comments in its block'
    return { ...inner, insert: ` ${line} ` }
  }
  const end =
    last.kind === 'prop' ? (last.as?.to ?? last.to) : last.kind === 'row' ? last.to : (last.bodySpan?.to ?? last.to)
  if (!source.slice(d.bodySpan.from, d.bodySpan.to).includes('\n')) return { from: end, to: end, insert: `; ${line}` }
  const lineStart = source.lastIndexOf('\n', last.from - 1) + 1
  const lead = source.slice(lineStart, last.from)
  const indent = /^[ \t]*$/.test(lead) ? lead : '  '
  const lineEnd = source.indexOf('\n', end)
  const at = lineEnd < 0 || lineEnd > d.bodySpan.to - 1 ? end : lineEnd
  return { from: at, to: at, insert: `\n${indent}${line}` }
}

/**
 * The text with an input of the statement at `path` (one that says `like:`) set in its `with`: the line changed when
 * it is there, else written, in a `with` block of its own when there is none. `value` is written as a number, a text
 * or true or false; `text` (from `writeInput()`) as it is.
 */
function setInput(
  source: string,
  path: string,
  name: string,
  value: EditValue | { text: string },
  options?: CompileOptions,
): EditResult {
  const { doc, report } = parse(source)
  if (report.failed) return { error: 'the text has a syntax error' }
  const site = declAt(doc.body, path)
  if (!site?.body?.some((s) => s.kind === 'prop' && s.key.name === 'like'))
    return { error: `nothing to change at "${path}/with/${name}"` }
  const { number, quote } = writer(source)
  const text =
    typeof value === 'object' && value && 'text' in value
      ? value.text
      : typeof value === 'number' && Number.isFinite(value)
        ? number(value)
        : typeof value === 'boolean'
          ? String(value)
          : typeof value === 'string'
            ? quote(value)
            : undefined
  if (text == null) return { error: 'a number, a text, or true or false' }
  const block = site.body.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'with')
  const line = block?.body?.find((s): s is Property => s.kind === 'prop' && s.key.name === name)
  if (line) return checked(source, [replace(line.value, text)], options)
  const change = block
    ? appendTo(source, block, `${name}: ${text}`)
    : appendTo(source, site, `with { ${name}: ${text} }`)
  return typeof change === 'string' ? { error: `"with" ${change}` } : checked(source, [change], options)
}

/**
 * The text with an input of a copy set in its `with` to `text` as it is written: the default it had, written here to
 * be changed for this copy alone. `key` is the field's (`inspectCopy()`).
 */
export function writeInput(source: string, key: string, text: string, options?: CompileOptions): EditResult {
  const input = INPUT_KEY.exec(key)
  if (!input) return { error: `nothing to change at "${key}"` }
  return setInput(source, input[1]!, input[2]!, { text }, options)
}

/**
 * The text with a property of the definition (`path` '') or of a statement at the top (`tier:data`) set, written or
 * taken out (`null`): a new one goes after the statement's last property, in a block of its own when it has none; a
 * block goes with its last line. Refused, as `edit()` is, when the result would not compile.
 */
export function setProperty(
  source: string,
  path: string,
  name: string,
  value: string | boolean | null,
  options?: CompileOptions,
): EditResult {
  const { doc, report } = parse(source)
  if (report.failed) return { error: 'the text has a syntax error' }
  // a view setting of a definition whose version has the view block goes there, unless it is written at the top
  const stamp = stampOf(source, doc.body)?.version
  const view = viewOf(doc.body)
  const inView =
    path === '' && isViewKey(name, stamp ?? CURRENT) && !doc.body.some((x) => x.kind === 'prop' && x.key.name === name)
  const [keyword = '', id] = inView ? ['view'] : path.split(':')
  const d = inView
    ? view
    : doc.body.find(
        (x): x is Decl =>
          x.kind === 'decl' && x.keyword.name === keyword && x.args[0]?.t === 'id' && x.args[0].name === id,
      )
  if (path && !d) return { error: `nothing at "${path}"` }
  const spec = own(own(SCHEMA, keyword)?.props ?? {}, name)
  if (!spec) return { error: `${keyword || 'a definition'} has no ${name}` }
  const body = d ? (d.body ?? []) : doc.body
  const props = body.filter((x): x is Property => x.kind === 'prop')
  const at = props.find((x) => x.key.name === name)
  if (value !== null) {
    const ok =
      spec.value === 'boolean'
        ? typeof value === 'boolean'
        : spec.value === 'enum'
          ? spec.values!.includes(value as string)
          : spec.value === 'string' && typeof value === 'string'
    if (!ok) return { error: spec.value === 'enum' ? `one of ${spec.values!.join(', ')}` : `a ${spec.value}` }
  }
  const text =
    value === null || typeof value === 'boolean' || spec.value === 'enum'
      ? String(value)
      : writer(source).quote(value, at?.value.t === 'str' ? at.value : undefined)
  const line = (i: number): [number, number] => [
    source.lastIndexOf('\n', i - 1) + 1,
    source.indexOf('\n', i) + 1 || source.length,
  ]
  let changes: TextChange[]
  if (at && value !== null) changes = [replace(at.value, text)]
  else if (at && d?.bodySpan && body.length === 1) {
    // a statement that is only its block (view { … }) goes whole, with its line
    const [a, b] = [line(d.from)[0], line(d.to)[1]]
    const alone = !source.slice(a, d.from).trim() && !source.slice(d.to, b).trim()
    const last = d.args.at(-1)
    changes = [
      last
        ? { from: last.to, to: d.bodySpan.to, insert: '' }
        : { from: alone ? a : d.from, to: alone ? b : d.to, insert: '' },
    ]
  } else if (at) {
    // from its first line to its last: a value may run over several
    const [a, b] = [line(at.from)[0], line(at.to)[1]]
    const alone = !source.slice(a, at.from).trim() && /^\s*(#.*)?$/.test(source.slice(at.to, b))
    // on a line with others, its "; " goes with it
    const after = /^\s*;\s*/.exec(source.slice(at.to))
    const before = /;\s*$/.exec(source.slice(0, at.from))
    changes = [
      alone
        ? { from: a, to: b, insert: '' }
        : after
          ? { from: at.from, to: at.to + after[0].length, insert: '' }
          : { from: at.from - (before?.[0].length ?? 0), to: at.to, insert: '' },
    ]
  } else if (value === null) changes = []
  else if (d && !d.bodySpan) changes = [{ from: d.to, to: d.to, insert: ` { ${name}: ${text} }` }]
  else {
    // with no view block yet, the setting opens one
    const last = inView && !d ? undefined : props.at(-1)
    const close = d?.bodySpan ? d.bodySpan.to - 1 : -1
    if (last && d && line(last.from)[0] === line(close)[0])
      changes = [{ from: last.to, to: last.to, insert: `; ${name}: ${text}` }]
    else if (last) {
      const [a, b] = [line(last.from)[0], line(last.to)[1]]
      const indent = /^[ \t]*/.exec(source.slice(a))![0]
      changes = [{ from: b, to: b, insert: `${source[b - 1] === '\n' ? '' : '\n'}${indent}${name}: ${text}\n` }]
    } else if (d) changes = [{ from: d.bodySpan!.from, to: d.bodySpan!.to, insert: `{ ${name}: ${text} }` }]
    else {
      const first = doc.body.find((x) => !(x.kind === 'decl' && x.keyword.name === 'loadmap'))
      const a = first ? line(first.from)[0] : source.length
      changes = [{ from: a, to: a, insert: inView ? `view { ${name}: ${text} }\n` : `${name}: ${text}\n` }]
    }
  }
  return checked(source, changes, options)
}

/** The changes applied, refused for an error they bring, not for one the text already had. */
function checked(source: string, changes: TextChange[], options?: CompileOptions): EditResult {
  changes.sort((a, b) => b.from - a.from)
  let next = source
  for (const c of changes) next = next.slice(0, c.from) + c.insert + next.slice(c.to)
  // the same text has the same errors: no compile can refuse it (the inspector sends a field's own value back)
  if (next === source) return { source: next, changes: changes.reverse() }
  const errors = (src: string) =>
    compile(src, options)
      .diagnostics.filter((d) => d.severity === 'error')
      .map((d) => d.message)
  const before = errors(source)
  const broken = errors(next).find((m) => {
    const i = before.indexOf(m)
    if (i < 0) return true
    before.splice(i, 1)
    return false
  })
  if (broken) return { error: broken }
  return { source: next, changes: changes.reverse() }
}

// -- reading the text -----------------------------------------------------------------------------------------

interface Entry {
  field: InspectField
  /** The changes for a value; a text is the reason it is refused. */
  apply: (part: string, value: EditValue) => TextChange[] | string
}

/** A statement and the fields of its own lines. */
interface Owner {
  path: string
  keyword: string
  id?: string
  title: string
  depth: number
  /** Its statement in the text; none for the model. */
  decl?: Decl
  fields: InspectField[]
  children: Owner[]
  /** The names its formulas read, and the components its stages name. */
  reads: Set<string>
  uses: string[]
  /** For a `published` statement: its component, whose conditions are its open properties. */
  catalog?: Published
}

const isBox = (k: string) => (BOXES as readonly string[]).includes(k)
const descendants = (o: Owner): Owner[] => o.children.flatMap((c) => [c, ...descendants(c)])
const section = (o: Owner): InspectSection => ({
  path: o.path,
  keyword: o.keyword,
  ...(o.id ? { id: o.id } : {}),
  title: o.title,
  fields: o.fields,
})

function walk(source: string, withs = false) {
  const { doc, report } = parse(source)
  if (report.failed) return null
  const entries = new Map<string, Entry>()
  const owners: Owner[] = []
  const { parts, number, quote, slot, slotsOnly } = writer(source)
  // a capacity's ± as the definition's version writes it
  const plusMinus = plusMinusMark(stampOf(source, doc.body)?.version ?? CURRENT)

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
      path: here,
      keyword,
      ...(id ? { id } : {}),
      title: label?.t === 'str' ? label.value : (id ?? words(keyword || 'model')),
      depth,
      ...(d ? { decl: d } : {}),
      fields: [],
      children: [],
      reads: new Set(),
      uses: [],
    }
    if (keyword === 'published' && d) {
      const c = componentOf(d)
      if (c) {
        o.catalog = c
        o.title = `${c.name}, published (${id ?? ''})`
      }
    }
    owners.push(o)
    if (d) for (const a of d.args) names(a, o.reads)
    // a published statement's component is a word of the catalog, not a name the definition reads
    if ((keyword === 'published' || keyword === 'measure') && d?.args[1]?.t === 'id') o.reads.delete(d.args[1].name)
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
        // a published statement's conditions are named by its component
        // an old name (`target` in expect) fills the slot of the property it is now
        const named = propNamed(spec.props, s.key.name)
        const k = named?.name ?? s.key.name
        const p =
          named?.spec ??
          (o.catalog && own(o.catalog.conditions, s.key.name) ? spec.open?.spec : undefined) ??
          (withs && keyword === 'with' ? spec.open?.spec : undefined)
        // a repeated property (assume) is told apart by its place
        const n = (seen.get(k) ?? 0) + 1
        seen.set(k, n)
        if (p) prop(o, `${here}/${k}${n > 1 ? `~${n}` : ''}`, k, s, p, body)
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

  const prop = (o: Owner, key: string, field: string, s: Property, p: PropSpec, body: Stmt[]) => {
    const e = s.value
    const condition = o.catalog && own(o.catalog.conditions, s.key.name)
    const base = {
      key,
      label: condition ? words(condition.label) : words(field),
      doc: condition ? condition.doc : p.doc,
      more: !condition && p.inspector !== 'main',
    }
    const n = literal(e)
    // a condition written as a value its runs used: a choice of those values
    if (condition && (n != null || e.t === 'str')) {
      const name = s.key.name
      // 1 and "1" are one value, as the catalog matches them
      const seen = new Map<string, OptionValue>()
      for (const f of o.catalog!.figures) {
        const v = f.when[name]
        if (v != null && typeof v !== 'boolean' && !seen.has(String(v))) seen.set(String(v), v)
      }
      const choices = [...seen.values()]
      const value = seen.get(String(e.t === 'str' ? e.value : n!))
      if (value != null)
        return add(o, { ...base, kind: 'choice', value, choices }, (_, v) => {
          if ((typeof v !== 'number' && typeof v !== 'string') || !choices.includes(v))
            return 'one of its published runs'
          return [replace(e, typeof v === 'string' ? quote(v, e.t === 'str' ? e : undefined) : number(v, e))]
        })
    }
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
          if (typeof v === 'string') return [replace(e, quote(v, e.t === 'str' ? e : undefined))]
          // the option as it is written: `2min`, not 120 in the old default's unit
          const option = options.items.find((i) => i.t !== 'str' && literal(i) === v)
          return [replace(e, option ? source.slice(option.from, option.to) : number(v, e))]
        })
      }
    }
    if ((p.value === 'boolean' || p.value === 'value') && e.t === 'bool')
      return add(o, { ...base, kind: 'boolean', value: e.value }, (_, v) =>
        typeof v === 'boolean' ? [replace(e, String(v))] : 'true or false',
      )
    // `20ms` is a formula, its one number changed as written (20, then "ms"), never a bare 0.02 to type over
    if ((p.value === 'number' || p.value === 'value') && n != null && !unitOf(e))
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
    const within = pm ? (unitOf(pm.within) ? 'formula' : (literal(pm.within) ?? 'formula')) : null
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
          if (!pm) return [{ from: value.to, to: value.to, insert: ` ${plusMinus} ${number(v)}%` }]
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

/** The unit a number literal is written with (`20ms`), signed or not. */
function unitOf(e: Expr): Suffix | undefined {
  return e.t === 'num' ? e.unit : e.t === 'unary' && e.arg.t === 'num' ? e.arg.unit : undefined
}

/** The number literals of a formula, in the order they are written (template parts included). */
function numbers(e: Expr, out: Extract<Expr, { t: 'num' }>[] = []) {
  if (e.t === 'num') out.push(e)
  for (const k of childrenOf(e, true)) numbers(k, out)
  return out.sort((a, b) => a.from - b.from)
}

/** The names a formula reads: parameters, lets, fits. */
function names(e: Expr, out: Set<string>) {
  if (e.t === 'id') out.add(e.name)
  if (e.t === 'call') out.add(e.callee.name)
  for (const k of childrenOf(e, true)) names(k, out)
}

/** What turns values into text: numbers, quotes and formula pieces written like the text they replace. */
function writer(source: string) {
  const text = (e: { from: number; to: number }) => source.slice(e.from, e.to)

  const parts = (e: Expr): FormulaPart[] => {
    const out: FormulaPart[] = []
    let at = e.from
    numbers(e).forEach((n, slot) => {
      if (n.from > at) out.push(source.slice(at, n.from))
      out.push({ slot, value: n.written ?? n.value })
      if (n.unit) out.push(n.unit)
      at = n.to
    })
    if (at < e.to) out.push(source.slice(at, e.to))
    return out
  }

  /**
   * A number as the language writes it, grouped with "_" when the one it replaces was. One that replaces a number
   * with a unit keeps the unit: `n` is then in seconds or a share, or with `written` already in that unit.
   */
  const number = (n: number, like?: Expr, written = false): string => {
    const unit = like && unitOf(like)
    if (like && (written && unit ? like.t === 'num' && like.written === n : literal(like) === n)) return text(like)
    if (unit && !written) n = Number((n / unitScale(unit)).toPrecision(15))
    const s = String(n)
    if (!like || !text(like).includes('_') || /e/i.test(s)) return s + (unit ?? '')
    const [int, frac] = s.replace('-', '').split('.')
    const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '_')
    return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}${unit ?? ''}`
  }

  /** A text in the quotes of the one it replaces (double quotes for a new one). */
  const quote = (s: string, like?: Expr): string => {
    // a parenthesized text's span starts at its "(": the quote is the first one in it
    const q = (like && /["'`]/.exec(text(like))?.[0]) || '"'
    const esc = s.replaceAll('\\', '\\\\').replaceAll(q, `\\${q}`).replaceAll('\n', '\\n').replaceAll('\t', '\\t')
    return `${q}${q === '`' ? esc.replaceAll('${', '\\${') : esc}${q}`
  }

  /** The change of one number of a formula. */
  const slot = (e: Expr, part: string, v: EditValue): TextChange[] | string => {
    const n = numbers(e)[Number(part.slice(1))]
    if (!n) return `the formula has no number ${part}`
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'a number'
    // a slot shows a number with a unit as written: 20 of "20ms"
    const t = number(v, n, true)
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
