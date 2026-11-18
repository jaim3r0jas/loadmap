import type { Decl, Stmt } from './ast'
import { boxOf } from './boxes'
import { declarations } from './compile'
import { type Code, type Diagnostic, Reporter } from './diagnostics'
import type { TextChange } from './edit'
import { parse } from './parser'
import { cut, edgeLabels, foldWorkers, mods, subsUp } from './rewrite'
import { COLORS, COMPONENT_PROPS, own, type PropSpec, SCHEMA, STAGES } from './schema'
import { walk } from './tree'
import { CURRENT, lowest, needs, before as older, stampOf, versionText } from './versions'
import { intoView } from './viewblock'

export interface QuickFix {
  /** What it does, as a menu shows it: `Change to "orders"`. */
  title: string
  changes: TextChange[]
}

const CAPACITY = new Set(['measured', 'estimated', 'configured'])
const ENDS = new Set(['store', 'sink', 'lost', 'fanout'])
const NAME = /^[A-Za-z_]\w*$/

/**
 * The fixes for each diagnostic, in the same order: the did-you-mean applied, a missing required property added, a
 * bare number made a capacity, a stray ":" dropped, an edge or a lost box added, an old name renamed. They key on the
 * diagnostic's code and read names from its data, never from its message. Each is the smallest change to the text it was given; an editor
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
  return diagnostics.map((d) => fixesFor(source, d, doc).map((f) => stamped(source, doc().body, f)))
}

type Doc = () => { body: readonly Stmt[]; ids: (kind: string) => string[] }

/** What a fix is given: the diagnostic, its text, its data, and the definition parsed once for every fix. */
interface FixContext {
  source: string
  d: Diagnostic
  text: string
  data: Readonly<Record<string, string>>
  doc: Doc
  replace: (insert: string) => TextChange[]
}

/** The fix for each code that has one (besides a did-you-mean, which any code can carry): the one place they live. */
const FIXERS: Partial<Record<Code, (c: FixContext) => QuickFix[]>> = {
  // "flow" needs "rate: …"   the component needs "capacity: …"   a slider needs "min: …"
  'missing-property': ({ source, d, data, doc }) => {
    const key = data.key
    const decl = key ? findAt(doc().body, d.from) : undefined
    if (!key || !decl) return []
    const spec = own(SCHEMA[decl.keyword.name]?.props ?? {}, key) ?? own(COMPONENT_PROPS, key)
    const line = `${key}: ${placeholder(spec, key, doc)}`
    return [{ title: `Add "${line}"`, changes: [addLine(source, decl, line)] }]
  },

  // capacity: 3000
  'bare-capacity': ({ text, doc, replace }) => {
    const unit = JSON.stringify(commonUnit(doc().body))
    return ['estimated', 'measured'].map((form) => ({
      title: `Make it ${form}(${text}, ${unit}, "source")`,
      changes: replace(`${form}(${text}, ${unit}, "source")`),
    }))
  },

  // "lost" is from loadmap 1.1; this definition says loadmap 1
  'language-version': ({ source, data, doc }) => {
    const stamp = stampOf(source, doc().body)
    if (!data.version || !stamp) return []
    return [{ title: `Write "loadmap ${data.version}"`, changes: [{ ...stamp.at, insert: data.version }] }]
  },

  // target is now underTarget   layout: right is now direction: right
  // speed is now in view { … }   layout: down is ignored: direction sets the direction
  deprecated: ({ source, d, data, replace, doc }) => {
    if (data.to) return [{ title: `Rename to "${data.to}"`, changes: replace(data.to) }]
    if (data.view) return [{ title: 'Move the view settings into view { … }', changes: intoView(source, doc().body) }]
    const line = data.remove ? lineOf(source, doc().body, d.from) : undefined
    return line ? [{ title: `Remove "${data.remove}"`, changes: [line] }] : []
  },

  // "workers" is no longer a statement   "sub" is no longer a property of node   … of an edge   … of param
  removed: ({ source, d, data, doc }) => {
    const body = doc().body
    const fix = (title: string, changes: TextChange[]) => (changes.length ? [{ title, changes }] : [])
    if (data.gone === 'workers') return fix('Write its lines on the pool', foldWorkers(source, body, d.from))
    if (data.gone === 'sub') return fix('Write it on the first line', subsUp(source, body, d.from))
    if (data.gone === 'label' && data.in === '->')
      return fix('Write it after the edge', edgeLabels(source, body, d.from))
    const line = lineOf(source, body, d.from)
    return line ? [{ title: `Remove "${data.gone}"`, changes: [line] }] : []
  },

  // "%" between two values is the remainder
  remainder: ({ source, d, doc }) => {
    const changes = mods(source, doc().body, d.from)
    return changes.length ? [{ title: 'Write it as mod(a, b)', changes }] : []
  },

  // "30%+1" is the remainder of 30 divided by +1, not a share
  'glued-percent': ({ data, replace }) => [
    ...(data.share ? [{ title: `Make it the share: ${data.share}`, changes: replace(data.share) }] : []),
    ...(data.mod ? [{ title: `Keep the remainder: ${data.mod}`, changes: replace(data.mod) }] : []),
  ],

  // a -> b: { … }
  'colon-before-block': ({ replace }) => [{ title: 'Drop the ":"', changes: replace('') }],

  // "signups" goes from "gateway" to "api", and no edge joins them
  'missing-edge': (c) => edgeFixes(c),
  // … but their edge points the other way
  'reversed-edge': (c) => edgeFixes(c),

  // what "limiter" turns away vanishes   units of "events" dropped as too old at "topic" vanish   … too slow …
  'unseen-loss': ({ source, data, doc }) => {
    const { stage, reason } = data
    const box = stage && boxOf(doc().body, stage)
    if (!box || (reason !== 'rejected' && reason !== 'dropped' && reason !== 'timedOut')) return []
    const name = (box.args[0] as { name: string }).name
    const taken = new Set([...doc().ids('node'), ...doc().ids('stage'), ...doc().ids('component')])
    const base = `${name}${{ rejected: 'Rejected', dropped: 'Dropped', timedOut: 'TimedOut' }[reason]}`
    let id = base
    for (let i = 2; taken.has(id); i++) id = `${base}${i}`
    const label = { rejected: 'Turned away', dropped: 'Too old', timedOut: 'Timed out' }[reason]
    const nl = source.indexOf('\n', box.to)
    const lineEnd = nl < 0 ? source.length : nl
    return [
      {
        title: `Add a lost box for what ${stage} loses`,
        changes: [
          // after the box's line, so a comment at its end stays with it
          { from: lineEnd, to: lineEnd, insert: `\nnode ${id} "${label}" { lost { takes: [${reason}] } }` },
          addEdge(source, doc().body, name, id),
        ],
      },
    ]
  },
}

/** The change that takes the property at `at` out of its block. */
function lineOf(source: string, body: readonly Stmt[], at: number): TextChange | undefined {
  const inside = (owner: Decl | undefined, list: readonly Stmt[]): TextChange | undefined => {
    for (const s of list) {
      if (s.from > at || s.to < at) continue
      // the last line of a view block takes the block with it: a bare `view` is no statement
      if (s.kind === 'prop')
        return owner?.keyword.name === 'view' && owner.body?.length === 1
          ? cut(source, {}, owner)
          : cut(source, owner ?? {}, s)
      if (s.kind === 'decl' && s.body) return inside(s, s.body)
    }
    return undefined
  }
  return inside(undefined, body)
}

/** The codes that have a quick fix (besides a did-you-mean, which any code can carry). */
export const FIXED_CODES = Object.keys(FIXERS) as Code[]

function fixesFor(source: string, d: Diagnostic, doc: Doc): QuickFix[] {
  const text = source.slice(d.from, d.to)
  const replace = (insert: string) => [{ from: d.from, to: d.to, insert }]
  const data = d.data ?? {}

  // did you mean "orders"?
  const mean = data.replace
  if (mean) {
    if (NAME.test(text))
      return [{ title: `Change to "${mean}"`, changes: replace(NAME.test(mean) ? mean : JSON.stringify(mean)) }]
    if (/^"(?:[^"\\]|\\.)*"$/.test(text))
      return [{ title: `Change to "${mean}"`, changes: replace(JSON.stringify(mean)) }]
    return []
  }
  return FIXERS[d.code]?.({ source, d, text, data, doc, replace }) ?? []
}

/**
 * The fix, with the `loadmap` line raised when what it adds is newer than the line says (a lost box in a
 * `loadmap 1` file): a fix never trades a warning for an error.
 */
function stamped(source: string, body: readonly Stmt[], fix: QuickFix): QuickFix {
  const before = stampOf(source, body)
  if (!before?.version || !older(before.version, CURRENT)) return fix
  let after = source
  for (const c of [...fix.changes].sort((a, b) => b.from - a.from))
    after = after.slice(0, c.from) + c.insert + after.slice(c.to)
  const need = lowest(needs(parse(after, new Reporter(after)).doc.body))
  if (!older(before.version, need) || fix.changes.some((c) => c.from < before.at.to && c.to > before.at.from))
    return fix
  return { ...fix, changes: [{ ...before.at, insert: versionText(need) }, ...fix.changes] }
}

/** The edge a hop needs, and on a route the way through the boxes the edges already join. */
function edgeFixes({ source, text, data, doc, replace }: FixContext): QuickFix[] {
  const { from: a, to: b } = data
  if (!a || !b) return []
  const fixes: QuickFix[] = [{ title: `Add the edge ${a} -> ${b}`, changes: [addEdge(source, doc().body, a, b)] }]
  // a hop on a route: through the boxes the edges already join them by, which those boxes then handle too
  const ends = /^(\w+)(\s*->\s*)(\w+)$/.exec(text)
  const via = ends && boxesBetween(doc().body, a, b)
  if (ends && via?.length)
    fixes.push({
      title: `Route it through ${via.join(', ')}`,
      changes: replace([ends[1], ...via, ends[3]].join(ends[2])),
    })
  return fixes
}

/** `a -> b` on a line of its own, after the last edge that leaves a (else after the last edge, else at the end). */
function addEdge(source: string, body: readonly Stmt[], a: string, b: string): TextChange {
  const edges = body.filter((s) => s.kind === 'edge')
  const after = edges.findLast((e) => e.chain.slice(0, -1).some((n) => n.name === a)) ?? edges.at(-1)
  if (after) return { from: after.to, to: after.to, insert: `\n${a} -> ${b}` }
  const end = source.trimEnd().length
  return { from: end, to: end, insert: `\n\n${a} -> ${b}` }
}

/**
 * The boxes between a and b on the shortest way the edges already join them, each running one stage a unit passes
 * (so a route can name it); none when there is no such way, or it is longer than four boxes.
 */
function boxesBetween(body: readonly Stmt[], a: string, b: string): string[] | undefined {
  const next = new Map<string, string[]>()
  for (const s of body)
    if (s.kind === 'edge')
      s.chain.forEach((n, i) => {
        const to = s.chain[i + 1]
        if (to) next.set(n.name, [...(next.get(n.name) ?? []), to.name])
      })
  const oneStage = new Set(
    body
      .filter(
        (s): s is Decl =>
          s.kind === 'decl' &&
          (s.body ?? []).filter((c) => c.kind === 'decl' && (STAGES as readonly string[]).includes(c.keyword.name))
            .length === 1 &&
          // a flow ends at a store, a sink or a fan-out: none can stand in the middle of a route
          !(s.body ?? []).some((c) => c.kind === 'decl' && ENDS.has(c.keyword.name)),
      )
      .map((s) => {
        const id = s.args[0]
        return id?.t === 'id' ? id.name : ''
      }),
  )
  let ways: string[][] = [[a]]
  const seen = new Set([a])
  for (let depth = 0; depth < 5 && ways.length; depth++) {
    const longer: string[][] = []
    for (const w of ways)
      for (const n of next.get(w.at(-1)!) ?? []) {
        if (n === b && w.length > 1) return w.slice(1)
        if (seen.has(n) || !oneStage.has(n)) continue
        seen.add(n)
        longer.push([...w, n])
      }
    ways = longer
  }
  return undefined
}

/**
 * The innermost statement that holds `from`: a missing line is reported at its statement's keyword or id (a box's
 * component at the box's id), or at a line of its own (`on` without `held`).
 */
function findAt(body: readonly Stmt[], from: number): Decl | undefined {
  for (const s of body) {
    if (s.kind !== 'decl' || from < s.from || from >= s.to) continue
    return (s.body && findAt(s.body, from)) ?? s
  }
  return undefined
}

/** A value that compiles where one is missing, for the reader to change. */
function placeholder(spec: PropSpec | undefined, key: string, doc: Doc): string {
  switch (spec?.value) {
    case 'string':
      return '""'
    case 'boolean':
      return 'true'
    case 'enum':
      return (key === 'color' ? COLORS : (spec.values ?? []))[0] ?? '""'
    case 'capacity':
      return `estimated(1, ${JSON.stringify(commonUnit(doc().body))}, "source")`
    case 'route': {
      if (key !== 'hop') return doc().ids('stage')[0] ?? 'stage'
      // a hop joins two stages next to each other on a route: the first a flow's route has
      for (const s of doc().body) {
        const route =
          s.kind === 'decl' && s.keyword.name === 'flow'
            ? s.body?.find((p) => p.kind === 'prop' && p.key.name === 'route')
            : undefined
        if (route?.kind === 'prop' && route.chain && route.chain.length > 1)
          return `${route.chain[0]!.name} -> ${route.chain[1]!.name}`
      }
      return 'from -> to'
    }
    case 'flows':
      return `[${doc().ids('flow')[0] ?? 'flow'}]`
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
