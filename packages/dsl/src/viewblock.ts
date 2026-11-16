import type { Decl, Property, Stmt } from './ast'
import type { TextChange } from './edit'

/**
 * What only changes how the page looks and plays, never a number: from loadmap 1.2 these live in a `view { … }` block.
 * Before it they stood at the top beside what the model computes from (`assume`, `searchMax`).
 */
export const VIEW_KEYS = ['speed', 'transition', 'fullScreen', 'fullScreenMode', 'lanes', 'grid'] as const

export const isViewKey = (key: string): boolean => (VIEW_KEYS as readonly string[]).includes(key)

/** The definition's `view` block, the first when it has several (the checker refuses the rest). */
export function viewOf(body: readonly Stmt[]): Decl | undefined {
  return body.find((s): s is Decl => s.kind === 'decl' && s.keyword.name === 'view')
}

/**
 * The changes that move every view setting written at the top into the `view` block, making one where the first of
 * them stood. A setting the block already has stays where it is: the checker says it is set twice. No change when
 * nothing is to move.
 */
export function intoView(source: string, body: readonly Stmt[]): TextChange[] {
  const view = viewOf(body)
  const has = new Set((view?.body ?? []).flatMap((s) => (s.kind === 'prop' ? [s.key.name] : [])))
  const tops = body.filter((s): s is Property => s.kind === 'prop' && isViewKey(s.key.name) && !has.has(s.key.name))
  if (!tops.length) return []
  const lineStart = (i: number) => source.lastIndexOf('\n', i - 1) + 1
  const lineEnd = (i: number) => source.indexOf('\n', i) + 1 || source.length
  const header = body[0]?.kind === 'decl' && body[0].keyword.name === 'loadmap' ? lineEnd(body[0].to) : 0
  const moved = tops.map((s) => {
    const [a, b] = [lineStart(s.from), lineEnd(s.to)]
    const text = source.slice(s.from, s.to)
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
  const changes: TextChange[] = moved.map((x) => x.cut)
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
    else
      changes.push({
        from: close,
        to: close,
        insert: `${inner.trim() ? `${inner.endsWith(' ') ? '' : ' '}; ` : ' '}${lines.join('; ')} `,
      })
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
