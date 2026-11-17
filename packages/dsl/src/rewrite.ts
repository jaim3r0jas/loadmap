import { childrenOf, type Decl, type Edge, type Expr, formulasOf, type Property, type Stmt } from './ast'
import type { TextChange } from './edit'
import { BOXES, matchArgs, POOL_LINES, SCHEMA } from './schema'

/**
 * The spellings loadmap 1.5 left behind, each as the changes that write it the one way that is left: what
 * `loadmap fmt` does to a file stamped 1.5 or later, and what the quick fix of each diagnostic does to the one place it
 * names (`at`, an offset inside it). They read the text and its statements, never the compiled model, and leave alone
 * what they cannot write the new way without changing what it means: the checker's message stays.
 */

const lineStart = (source: string, i: number) => source.lastIndexOf('\n', i - 1) + 1
const lineEnd = (source: string, i: number) => source.indexOf('\n', i) + 1 || source.length
const holds = (s: { from: number; to: number }, at: number | undefined) => at == null || (s.from <= at && at <= s.to)

/** Every statement with a block, the top level's first, and the block it stands in. */
function* declsOf(body: readonly Stmt[]): Generator<Decl> {
  for (const s of body) {
    if (s.kind !== 'decl') continue
    yield s
    if (s.body) yield* declsOf(s.body)
  }
}

function* edgesOf(body: readonly Stmt[]): Generator<Edge> {
  for (const s of body) {
    if (s.kind === 'edge') yield s
    else if (s.kind === 'decl' && s.body) yield* edgesOf(s.body)
  }
}

const propsNamed = (body: readonly Stmt[] | undefined, name: string) =>
  (body ?? []).filter((s): s is Property => s.kind === 'prop' && s.key.name === name)

/**
 * Takes a statement out of its block: with its lines when it stands alone on them, with its ";" beside others, and
 * with the braces when it was all the block held.
 */
export function cut(source: string, owner: Pick<Decl, 'body' | 'bodySpan'>, s: Stmt): TextChange {
  const span = owner.bodySpan
  if (span && owner.body?.length === 1 && !source.slice(span.from, span.to).includes('#')) {
    let from = span.from
    while (from > 0 && (source[from - 1] === ' ' || source[from - 1] === '\t')) from--
    return { from, to: span.to, insert: '' }
  }
  const [a, b] = [lineStart(source, s.from), lineEnd(source, s.to)]
  if (!source.slice(a, s.from).trim() && !source.slice(s.to, b).trim()) return { from: a, to: b, insert: '' }
  const after = /^[ \t]*;[ \t]*/.exec(source.slice(s.to))
  if (after) return { from: s.from, to: s.to + after[0].length, insert: '' }
  const before = /;[ \t]*$/.exec(source.slice(0, s.from))
  return { from: s.from - (before?.[0].length ?? 0), to: s.to, insert: '' }
}

/**
 * `pool p { workers "the label" { pods: 3; perPod: 8 } }` becomes `pool p { stageLabel: "the label"; pods: 3;
 * perPod: 8 }`. A workers block with an id of its own stays: routes and formulas name it, and the pool has one id.
 */
export function foldWorkers(source: string, body: readonly Stmt[], at?: number): TextChange[] {
  const out: TextChange[] = []
  for (const d of declsOf(body)) {
    if (d.keyword.name !== 'pool' || !holds(d, at)) continue
    const blocks = (d.body ?? []).filter((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'workers')
    const w = blocks[0]
    if (!w || blocks.length !== 1 || w.args.length > 1 || (w.args[0] && w.args[0].t !== 'str')) continue
    // with one of the pool's own workers lines written the block cannot fold in: the checker says it is set twice
    const direct = (d.body ?? []).some(
      (s) =>
        (s.kind === 'prop' && POOL_LINES.includes(s.key.name)) || (s.kind === 'decl' && s.keyword.name === 'autoscale'),
    )
    if (direct) continue
    const label = w.args[0] ? `stageLabel: ${source.slice(w.args[0].from, w.args[0].to)}` : ''
    const inner = w.bodySpan ? source.slice(w.bodySpan.from + 1, w.bodySpan.to - 1).trim() : ''
    if (!label && !inner) out.push(cut(source, d, w))
    else
      out.push({
        from: w.from,
        to: w.to,
        insert: [label, inner].filter(Boolean).join(inner.includes('\n') ? '\n' : '; '),
      })
  }
  return out
}

/**
 * `node db "Database" { sub: "primary" }` becomes `node db "Database" "primary"`: the second text on the first line;
 * `sub: hit > 0 ? "on" : "off"` becomes the template `` `${hit > 0 ? "on" : "off"}` `` there.
 */
export function subsUp(source: string, body: readonly Stmt[], at?: number): TextChange[] {
  const out: TextChange[] = []
  for (const d of declsOf(body)) {
    if (!(BOXES as readonly string[]).includes(d.keyword.name) || !holds(d, at)) continue
    const subs = propsNamed(d.body, 'sub')
    const v = subs[0]?.value
    if (subs.length !== 1 || !v || v.t === 'error') continue
    const { filled, bad } = matchArgs(SCHEMA[d.keyword.name]!.args, d.args)
    const arg = (name: string) => [...filled].find(([slot]) => slot.name === name)?.[1]
    const [id, label] = [arg('id'), arg('label')]
    // without a label the box takes its id, or the label of the box it is like: only the first can be written out
    if (bad.length || arg('sub') || id?.t !== 'id' || (!label && propsNamed(d.body, 'like').length)) continue
    const after = (label ?? id).to
    // a text stays as written (one continued over lines on one line); any other formula goes in a template, which
    // puts the text it comes to there as it is
    const text =
      v.t === 'str'
        ? v.continued
          ? JSON.stringify(v.value)
          : source.slice(v.from, v.to)
        : v.t === 'tpl'
          ? source.slice(v.from, v.to)
          : `\`\${${source.slice(v.from, v.to)}}\``
    out.push(
      ...beside(source, after, `${label ? '' : ` ${JSON.stringify(id.name)}`} ${text}`, cut(source, d, subs[0]!)),
    )
  }
  return out
}

/**
 * Text written at `at` and a cut, as changes that never overlap: a block left empty is cut from the end of the line
 * before it, which is where the text goes, and two changes at one offset could apply in either order.
 */
function beside(source: string, at: number, insert: string, c: TextChange): TextChange[] {
  if (c.from > at || at > c.to) return [{ from: at, to: at, insert }, c]
  return [{ from: c.from, to: c.to, insert: source.slice(c.from, at) + insert }]
}

/** `a -> b { label: "x"; when: c }` becomes `a -> b: "x" { when: c }`. */
export function edgeLabels(source: string, body: readonly Stmt[], at?: number): TextChange[] {
  const out: TextChange[] = []
  for (const e of edgesOf(body)) {
    if (!holds(e, at) || e.value || e.colon) continue
    const labels = propsNamed(e.body, 'label')
    if (labels.length !== 1) continue
    const v = labels[0]!.value
    const after = e.chain.at(-1)!.to
    out.push(...beside(source, after, `: ${source.slice(v.from, v.to)}`, cut(source, e, labels[0]!)))
  }
  return out
}

/**
 * `a % b` becomes `mod(a, b)`: the innermost ones, so a formula with one inside another takes a pass for each. A `%`
 * glued to a number in a file stamped before 1.5 has its own fix (the share, or the remainder) and stays.
 */
export function mods(source: string, body: readonly Stmt[], at?: number): TextChange[] {
  const out: TextChange[] = []
  const has = (e: Expr): boolean => [...formulasOf([{ kind: 'row', values: [e], from: e.from, to: e.to }])].some(isMod)
  for (const e of formulasOf(body)) {
    if (!isMod(e) || e.t !== 'bin' || has(e.left) || has(e.right)) continue
    if (!holds({ from: e.left.from, to: e.right.to }, at)) continue
    // the parentheses around an operand are mod()'s own now: `(a + 1) % 2` is `mod(a + 1, 2)`
    const [l, r] = [wrapped(source, e.left) ? 1 : 0, wrapped(source, e.right) ? 1 : 0]
    out.push(
      { from: e.left.from, to: e.left.from + l, insert: 'mod(' },
      { from: e.left.to - l, to: e.right.from + r, insert: ', ' },
      { from: e.right.to - r, to: e.right.to, insert: ')' },
    )
  }
  return out
}

/** Whether a formula's text is one pair of parentheses around it all (a span takes in the parentheses around it). */
function wrapped(source: string, e: Expr): boolean {
  if (source[e.from] !== '(' || source[e.to - 1] !== ')') return false
  let depth = 0
  let quote = ''
  for (let i = e.from; i < e.to; i++) {
    const c = source[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i === e.to - 1
  }
  return false
}

const isMod = (e: Expr) => e.t === 'bin' && e.op === '%' && !e.glued

/**
 * The text of a formula with every remainder in it written as `mod(a, b)`, the way `mods` leaves it once every pass
 * is done: `pods % 3 % 2` is `mod(mod(pods, 3), 2)`, `(a + 1) % 2` is `mod(a + 1, 2)`.
 */
export function modText(source: string, e: Expr): string {
  const bare = (x: Expr) => {
    const t = modText(source, x)
    return wrapped(source, x) ? t.slice(1, -1) : t
  }
  if (e.t === 'bin' && isMod(e)) return `mod(${bare(e.left)}, ${bare(e.right)})`
  let out = ''
  let at = e.from
  const inner = (x: Expr) => {
    for (const c of childrenOf(x, true)) {
      if (!isMod(c)) inner(c)
      else if (c.t === 'bin') {
        out += source.slice(at, c.left.from) + modText(source, c)
        at = c.right.to
      }
    }
  }
  inner(e)
  return out + source.slice(at, e.to)
}

/** `===` becomes `==`, `!==` becomes `!=`, and `derived.x` the bare name `x`, which reads the same let. */
export function oneSpelling(source: string, body: readonly Stmt[]): TextChange[] {
  const out: TextChange[] = []
  for (const e of formulasOf(body)) {
    if (e.t === 'bin' && e.triple) out.push({ ...e.triple, insert: e.op })
    else if (e.t === 'member' && e.object.name === 'derived' && !e.flow)
      out.push({ from: e.from, to: e.to, insert: source.slice(e.prop.from, e.prop.to) })
  }
  return out
}
