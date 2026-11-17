import type { Decl, Property, Stmt } from './ast'
import type { TextChange } from './edit'
import { DIRECTIONS, SCHEMA } from './schema'
import { before, CURRENT, parseVersion, stampOf, type Version } from './versions'

/**
 * What only changes how the page looks and plays, never a number: from loadmap 1.2 these live in a `view { … }` block.
 * Before it they stood at the top beside what the model computes from (`assume`, `searchMax`). `direction`, `rows` and
 * `layout` followed in 1.5, from where every one of them is an error at the top.
 */
export const VIEW_KEYS = [
  'direction',
  'rows',
  'layout',
  'speed',
  'transition',
  'fullScreen',
  'fullScreenMode',
  'lanes',
  'grid',
] as const

/**
 * Whether `key` is a view setting; with a version, one that lives in the view block under that stamp, and that the
 * stamp still has (`grid` is gone from 1.5: moved, it would be an error there too).
 */
export const isViewKey = (key: string, version?: Version): boolean => {
  if (!(VIEW_KEYS as readonly string[]).includes(key)) return false
  if (!version) return true
  const spec = SCHEMA['']!.props[key]!
  if (spec.until && !before(version, parseVersion(spec.until)!)) return false
  return !before(version, parseVersion(spec.movedIn ?? '1.2')!)
}

/** `layout: right` or `layout: down` at the top: the direction, under the name it had before `layout: compact`. */
export function oldDirection(st: Stmt): boolean {
  if (st.kind !== 'prop' || st.key.name !== 'layout') return false
  const v = st.value
  const word = v.t === 'id' ? v.name : v.t === 'str' ? v.value : undefined
  return word != null && (DIRECTIONS as readonly string[]).includes(word)
}

/** The definition's `view` block, the first when it has several (the checker refuses the rest). */
export function viewOf(body: readonly Stmt[]): Decl | undefined {
  return body.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'view')
}

/**
 * The changes that move every view setting written at the top into the `view` block, making one where the first of
 * them stood. A setting the block already has stays where it is: the checker says it is set twice. No change when
 * nothing is to move. Only the settings that live in the block under `version` (the file's stamp, unless given) move;
 * the direction's old name, `layout: right`, moves as `direction: right` unless the definition also says direction.
 */
export function intoView(
  source: string,
  body: readonly Stmt[],
  version: Version = stampOf(source, body)?.version ?? CURRENT,
): TextChange[] {
  const view = viewOf(body)
  const has = new Set((view?.body ?? []).flatMap((s) => (s.kind === 'prop' ? [s.key.name] : [])))
  const directed = has.has('direction') || body.some((s) => s.kind === 'prop' && s.key.name === 'direction')
  const renamed = (s: Property) => oldDirection(s) && isViewKey('direction', version)
  const tops = body.filter(
    (s): s is Property =>
      s.kind === 'prop' &&
      (renamed(s) ? !directed : isViewKey(s.key.name, version) && !oldDirection(s) && !has.has(s.key.name)),
  )
  if (!tops.length) return []
  const lineStart = (i: number) => source.lastIndexOf('\n', i - 1) + 1
  const lineEnd = (i: number) => source.indexOf('\n', i) + 1 || source.length
  const header = body[0]?.kind === 'decl' && body[0].keyword.name === 'loadmap' ? lineEnd(body[0].to) : 0
  const moved = tops.map((s) => {
    const [a, b] = [lineStart(s.from), lineEnd(s.to)]
    const text = renamed(s) ? `direction${source.slice(s.key.to, s.to)}` : source.slice(s.from, s.to)
    // alone on its lines it goes with them; beside others, with its ";"; a comment after it stays
    if (source.slice(a, s.from).trim() || source.slice(s.to, b).trim()) {
      const after = /^[ \t]*;[ \t]*/.exec(source.slice(s.to))
      const before = /;[ \t]*$/.exec(source.slice(0, s.from))
      const cut = after
        ? { from: s.from, to: s.to + after[0].length, insert: '' }
        : { from: s.from - (before?.[0].length ?? 0), to: s.to, insert: '' }
      return { cut, lines: [text] }
    }
    // the comment lines straight above it are about it and go along; the ones under the loadmap line are the file's
    let from = a
    const comments: string[] = []
    while (from > header) {
      const up = lineStart(from - 1)
      const line = source.slice(up, from).trim()
      if (!line.startsWith('#')) break
      comments.unshift(line)
      from = up
    }
    const whole = from > header || !comments.length
    return {
      cut: { from: whole ? from : a, to: b, insert: '' },
      lines: [...(whole ? comments : []), text],
    }
  })
  // two settings on one line each reach for the ";" between them: the later cut starts where the earlier ends
  const cuts = moved.map((x) => x.cut).sort((x, y) => x.from - y.from)
  for (const [i, c] of cuts.entries()) {
    const prev = cuts[i - 1]
    if (prev && c.from < prev.to) c.from = Math.min(prev.to, c.to)
  }
  // a line they leave empty goes with them
  for (const c of cuts) {
    const [a, b] = [lineStart(c.from), lineEnd(c.to)]
    const on = cuts.filter((x) => x.from >= a && x.to <= b)
    const left = on.reduceRight((text, x) => text.slice(0, x.from - a) + text.slice(x.to - a), source.slice(a, b))
    if (left.trim() || on.at(-1) !== c) continue
    on[0]!.from = a
    c.to = b
  }
  const changes: TextChange[] = cuts.filter((c) => c.to > c.from)
  const lines = moved.flatMap((x) => x.lines)
  // a comment ends its line, so a block that takes one is written a statement a line
  const tall = lines.some((l) => l.startsWith('#'))
  const rows = lines.map((l) => `  ${l}\n`).join('')
  if (view?.bodySpan) {
    const close = view.bodySpan.to - 1
    const inner = source.slice(view.bodySpan.from + 1, close)
    if (inner.includes('\n')) {
      const at = lineStart(close)
      changes.push({ from: at, to: at, insert: rows })
    } else if (tall) changes.push({ from: close, to: close, insert: `\n${rows}` })
    else if (inner.trim()) {
      // after its last setting, before the space that closes it
      const end = view.bodySpan.from + 1 + inner.trimEnd().length
      changes.push({ from: end, to: end, insert: `; ${lines.join('; ')}` })
    } else changes.push({ from: close, to: close, insert: ` ${lines.join('; ')} ` })
  } else if (view)
    changes.push({ from: view.to, to: view.to, insert: tall ? ` {\n${rows}}` : ` { ${lines.join('; ')} }` })
  else {
    // where the first of them stood: a line of its own
    const at = Math.min(...changes.map((c) => lineStart(c.from)))
    const block = tall ? `view {\n${rows}}\n` : `view { ${lines.join('; ')} }\n`
    const same = changes.find((c) => c.from === at && c.insert === '')
    if (same) same.insert = block
    else changes.push({ from: at, to: at, insert: block })
  }
  return changes.sort((x, y) => x.from - y.from)
}

/** `source` with the changes made. */
export function applied(source: string, changes: readonly TextChange[]): string {
  let out = source
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  return out
}
