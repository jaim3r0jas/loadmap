import type { Decl, Stmt } from './ast'
import { declarations } from './compile'
import { walk } from './complete'
import { type Diagnostic, Reporter } from './diagnostics'
import type { TextChange } from './edit'
import { parse } from './parser'
import { COLORS, COMPONENT_PROPS, own, type PropSpec, SCHEMA } from './schema'

export interface QuickFix {
  /** What it does, as a menu shows it: `Change to "orders"`. */
  title: string
  changes: TextChange[]
}

const CAPACITY = new Set(['measured', 'estimated', 'configured'])
const NAME = /^[A-Za-z_]\w*$/

/**
 * The fixes for each diagnostic, in the same order: the did-you-mean applied, a missing required property added, a
 * bare number made a capacity, a stray ":" dropped. Each is the smallest change to the text it was given; an editor
 * applies it only to that text. Most diagnostics have none.
 */
export function quickFixes(source: string, diagnostics: readonly Diagnostic[]): QuickFix[][] {
  let parsed: { body: readonly Stmt[]; ids: (kind: string) => string[] } | undefined
  const doc = () => {
    if (!parsed) {
      const { doc: d } = parse(source, new Reporter(source))
      const symbols = declarations(source, d)
      parsed = { body: d.body, ids: (kind) => symbols.filter((s) => s.kind === kind).map((s) => s.id) }
    }
    return parsed
  }
  return diagnostics.map((d) => fixesFor(source, d, doc))
}

function fixesFor(
  source: string,
  d: Diagnostic,
  doc: () => { body: readonly Stmt[]; ids: (kind: string) => string[] },
): QuickFix[] {
  const text = source.slice(d.from, d.to)
  const replace = (insert: string, from = d.from, to = d.to) => [{ from, to, insert }]

  // did you mean "orders"?
  const mean = /^did you mean "(.+)"\?$/.exec(d.hint ?? '')?.[1]
  if (mean) {
    if (NAME.test(text))
      return [{ title: `Change to "${mean}"`, changes: replace(NAME.test(mean) ? mean : JSON.stringify(mean)) }]
    if (/^"(?:[^"\\]|\\.)*"$/.test(text))
      return [{ title: `Change to "${mean}"`, changes: replace(JSON.stringify(mean)) }]
    return []
  }

  // "flow" needs "rate: …"   the component needs "capacity: …"   a slider needs "min: …"
  const needs = /^(?:"(\w+)"|the component|a slider) needs "(\w+): …"$/.exec(d.message)
  if (needs) {
    const decl = findAt(doc().body, d.from)
    if (!decl) return []
    const key = needs[2]!
    const spec = own(SCHEMA[decl.keyword.name]?.props ?? {}, key) ?? own(COMPONENT_PROPS, key)
    const line = `${key}: ${placeholder(spec, key, doc)}`
    return [{ title: `Add "${line}"`, changes: [addLine(source, decl, line)] }]
  }

  // capacity: 3000
  if (d.message === 'a capacity says where it came from') {
    const unit = JSON.stringify(commonUnit(doc().body))
    return ['estimated', 'measured'].map((form) => ({
      title: `Make it ${form}(${text}, ${unit}, "source")`,
      changes: replace(`${form}(${text}, ${unit}, "source")`),
    }))
  }

  // a -> b: { … }
  if (d.message === 'drop the ":" before a { … } block') return [{ title: 'Drop the ":"', changes: replace('') }]
  return []
}

/** The statement whose keyword or id starts at `from`, at any depth: a box's component is reported at the box's id. */
function findAt(body: readonly Stmt[], from: number): Decl | undefined {
  for (const s of body) {
    if (s.kind !== 'decl') continue
    if (s.keyword.from === from || s.args[0]?.from === from) return s
    const inner = s.body && findAt(s.body, from)
    if (inner) return inner
  }
  return undefined
}

/** A value that compiles where one is missing, for the reader to change. */
function placeholder(
  spec: PropSpec | undefined,
  key: string,
  doc: () => { body: readonly Stmt[]; ids: (kind: string) => string[] },
): string {
  switch (spec?.value) {
    case 'string':
      return '""'
    case 'boolean':
      return 'true'
    case 'enum':
      return (key === 'color' ? COLORS : (spec.values ?? []))[0] ?? '""'
    case 'capacity':
      return `estimated(1, ${JSON.stringify(commonUnit(doc().body))}, "source")`
    case 'route':
      return doc().ids('stage')[0] ?? 'stage'
    case 'node':
      return doc().ids('node')[0] ?? 'node'
    case 'component':
      return doc().ids('component')[0] ?? 'component'
    case 'flow':
      return doc().ids('flow')[0] ?? 'flow'
    default:
      return '1'
  }
}

/** A property line added at the top of a statement's block, laid out like the block; a block made when it has none. */
function addLine(source: string, decl: Decl, line: string): TextChange {
  if (!decl.bodySpan) return { from: decl.to, to: decl.to, insert: ` { ${line} }` }
  const open = decl.bodySpan.from
  const inner = source.slice(open + 1, decl.bodySpan.to - 1)
  const firstLine = inner.split('\n', 1)[0]!
  // a block on one line, or whose first statement shares the "{" line: in that line
  if (!inner.includes('\n') || firstLine.trim())
    return { from: open + 1, to: open + 1, insert: inner.trim() ? ` ${line};` : ` ${line} ` }
  const start = source.lastIndexOf('\n', decl.from - 1) + 1
  const indent = /^[ \t]*/.exec(source.slice(start))![0]
  return { from: open + 1, to: open + 1, insert: `\n${indent}  ${line}` }
}

/** The unit the file's capacities use most, or a common one. */
function commonUnit(body: readonly Stmt[]): string {
  const count = new Map<string, number>()
  walk(body, (e) => {
    if (e.t !== 'call' || !CAPACITY.has(e.callee.name)) return
    const u = e.args[1]
    if (u?.t === 'str' && u.value) count.set(u.value, (count.get(u.value) ?? 0) + 1)
  })
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'req/s'
}
