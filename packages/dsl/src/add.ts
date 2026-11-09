import { type ConditionValue, type Published, published } from '@loadmap/core'
import type { Decl, Stmt } from './ast'
import { type CompileOptions, compile, declarations } from './compile'
import type { TextChange } from './edit'
import { parse } from './parser'
import { BOXES, STAGES } from './schema'

/** What the editor's catalog picker writes: a published figure, and the box that uses it. */
export interface CatalogPick {
  /** A component of an edition, as the catalog gives it. */
  component: Published
  conditions: Readonly<Record<string, ConditionValue>>
  version?: string
  figure?: string
  /** A new box drawn for it, or the id of a box whose capacity it becomes. */
  into: 'new' | { box: string }
}

export type AddResult = { source: string; changes: TextChange[]; id: string; box: string } | { error: string }

/**
 * The text with a `published` statement added, and a new box that uses it or a box's capacity set to it: text only,
 * the smallest change, refused (with the reason) when the definition would gain an error.
 */
export function addPublished(source: string, pick: CatalogPick, options?: CompileOptions): AddResult {
  const { doc, report } = parse(source)
  if (report.failed) return { error: 'the text has a syntax error' }
  const c = pick.component
  const taken = new Set(declarations(source, doc).map((s) => s.id))
  const fresh = (base: string) => {
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`
    taken.add(id)
    return id
  }
  const id = fresh(`${c.id}Figure`)
  // a text as the language reads it back: only \\, \", \n and \t are escaped
  const quote = (t: string) =>
    `"${t.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\t', '\\t')}"`
  const value = (v: ConditionValue) => (typeof v === 'string' ? quote(v) : String(v))
  const lines = [
    `edition: ${quote(c.edition)}`,
    ...(pick.version ? [`version: ${quote(pick.version)}`] : []),
    ...(pick.figure ? [`figure: ${quote(pick.figure)}`] : []),
    ...Object.entries(pick.conditions).map(([k, v]) => `${k}: ${value(v)}`),
  ]
  const statement = `published ${id} ${c.id} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`
  const changes: TextChange[] = []
  // a definition ends on a line of its own: the new lines go after one blank line
  const end = source.trimEnd().length
  const gap = '\n\n'
  let box: string
  if (pick.into === 'new') {
    box = fresh(c.id)
    // a plain box: a cluster or a pool needs a flow through it, which only the reader can route
    const body = [
      ...(c.shape === 'cylinder' ? ['shape: cylinder'] : []),
      '# what reaches it, in the unit of its capacity',
      'demand: 0',
      `capacity: ${id}`,
      'over: "past its published capacity"',
    ]
    const drawn = `node ${box} ${quote(c.name)} {\n${body.map((l) => `  ${l}`).join('\n')}\n}`
    changes.push({ from: end, to: source.length, insert: `${gap}${statement}\n\n${drawn}\n` })
  } else {
    box = pick.into.box
    const d = doc.body.find(
      (s): s is Decl =>
        s.kind === 'decl' &&
        (BOXES as readonly string[]).includes(s.keyword.name) &&
        s.args[0]?.t === 'id' &&
        s.args[0].name === box,
    )
    if (!d) return { error: `no box "${box}"` }
    const prop = (k: string) =>
      d.body?.find((s): s is Extract<Stmt, { kind: 'prop' }> => s.kind === 'prop' && s.key.name === k)
    const cap = prop('capacity')
    // the box's demand is in its capacity's unit: a figure in another one would compare apples with pears
    const unit = cap?.value.t === 'call' && cap.value.args[1]?.t === 'str' ? cap.value.args[1].value : undefined
    const figure = published(c, { ...pick.conditions, ...(pick.version ? { version: pick.version } : {}) })
    if (unit && figure.unit && unit !== figure.unit)
      return { error: `${box}'s capacity is in ${unit}, ${c.name}'s figure in ${figure.unit}` }
    if (cap) changes.push({ from: cap.value.from, to: cap.value.to, insert: id })
    else {
      // a box without a component gains one: its capacity, and what happens past it
      // without a stage nothing reaches it: a demand to fill in, as a new box has
      const staged = d.body?.some((s) => s.kind === 'decl' && (STAGES as readonly string[]).includes(s.keyword.name))
      const add = [
        ...(prop('demand') || staged ? [] : ['demand: 0']),
        `capacity: ${id}`,
        ...(prop('over') ? [] : ['over: "past its published capacity"']),
      ]
      if (d.bodySpan) {
        const close = d.bodySpan.to - 1
        const before = source.slice(0, close).trimEnd().length
        changes.push({ from: before, to: close, insert: `\n${add.map((l) => `  ${l}`).join('\n')}\n` })
      } else changes.push({ from: d.to, to: d.to, insert: ` {\n${add.map((l) => `  ${l}`).join('\n')}\n}` })
    }
    changes.push({ from: end, to: source.length, insert: `${gap}${statement}\n` })
  }
  // from the end back; at one offset the later change first, so the box's own lines come before the statement
  const order = new Map(changes.map((ch, i) => [ch, i]))
  changes.sort((a, b) => b.from - a.from || order.get(b)! - order.get(a)!)
  let next = source
  for (const ch of changes) next = next.slice(0, ch.from) + ch.insert + next.slice(ch.to)
  const errors = (src: string) =>
    compile(src, options)
      .diagnostics.filter((x) => x.severity === 'error')
      .map((x) => x.message)
  const before = errors(source)
  const broken = errors(next).find((m) => {
    const i = before.indexOf(m)
    if (i < 0) return true
    before.splice(i, 1)
    return false
  })
  if (broken) return { error: broken }
  return { source: next, changes: changes.reverse(), id, box }
}
