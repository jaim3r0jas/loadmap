// One file's change, line by line: what the commit held and what the reader made of it, with a few lines around each
// change and the rest folded. Its own small diff (Myers, on lines): nothing it needs is shared with the editor, so
// the page's first load names no new chunk.

export type Line = { kind: 'same' | 'gone' | 'new'; text: string; before?: number; after?: number }

/** The trace Myers keeps grows with the lines times the edits: past this many cells the diff says so instead. */
const MAX_CELLS = 4_000_000

/**
 * The lines of `after` against `before`: what both start and end with as it is, the middle by the shortest edit
 * (Myers' O(ND)). Undefined when the middle is too large and too different to compare at a reader's pace.
 */
export function lineDiff(before: string, after: string): Line[] | undefined {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const mid = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  if (!mid) return undefined
  const out: Line[] = []
  for (let i = 0; i < head; i++) out.push({ kind: 'same', text: a[i]!, before: i + 1, after: i + 1 })
  for (const l of mid)
    out.push({
      ...l,
      ...(l.before != null && { before: l.before + head }),
      ...(l.after != null && { after: l.after + head }),
    })
  for (let i = tail; i > 0; i--)
    out.push({ kind: 'same', text: a[a.length - i]!, before: a.length - i + 1, after: b.length - i + 1 })
  return out
}

/** Myers' diff of two lists of lines, numbered from 1 within them. */
function myers(a: string[], b: string[]): Line[] | undefined {
  const n = a.length
  const m = b.length
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let done = max === 0
  for (let d = 0; d <= max && !done; d++) {
    if ((trace.length + 1) * v.length > MAX_CELLS) return undefined
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        done = true
        break
      }
    }
  }
  // back from the end: the equal run before each step, then the step (a line new, or a line gone)
  const out: Line[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const t = trace[d]!
    const k = x - y
    const down = k === -d || (k !== d && t[off + k - 1]! < t[off + k + 1]!)
    const pk = down ? k + 1 : k - 1
    const px = t[off + pk]!
    const py = px - pk
    while (x > px && y > py) {
      out.push({ kind: 'same', text: a[x - 1]!, before: x, after: y })
      x--
      y--
    }
    if (down) out.push({ kind: 'new', text: b[--y]!, after: y + 1 })
    else out.push({ kind: 'gone', text: a[--x]!, before: x + 1 })
  }
  while (x > 0 && y > 0) {
    out.push({ kind: 'same', text: a[x - 1]!, before: x, after: y })
    x--
    y--
  }
  return out.reverse()
}

/** Runs of unchanged lines longer than this fold, leaving `AROUND` lines beside each change. */
const AROUND = 2

type Row = Line | { kind: 'fold'; count: number }

function fold(lines: Line[]): Row[] {
  const near = lines.map(() => false)
  lines.forEach((l, i) => {
    if (l.kind === 'same') return
    for (let j = Math.max(0, i - AROUND); j <= Math.min(lines.length - 1, i + AROUND); j++) near[j] = true
  })
  const rows: Row[] = []
  let run = 0
  lines.forEach((l, i) => {
    if (near[i] || l.kind !== 'same') {
      if (run) rows.push({ kind: 'fold', count: run })
      run = 0
      rows.push(l)
    } else run++
  })
  if (run) rows.push({ kind: 'fold', count: run })
  return rows
}

export const DIFF_CSS = `
.lmg-diff { margin: 0; border-top: 1px solid var(--lm-line); max-height: 320px; overflow: auto; background: var(--lm-bg); font: 12px/1.5 var(--lm-mono); }
.lmg-diff table { border-collapse: collapse; width: 100%; }
.lmg-diff td { padding: 0 8px; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
.lmg-diff td.lmg-n { width: 1%; padding: 0 6px; color: var(--lm-muted); text-align: right; white-space: nowrap; user-select: none; }
.lmg-diff tr[data-kind="new"] { background: color-mix(in srgb, var(--lm-ok) 14%, transparent); }
.lmg-diff tr[data-kind="gone"] { background: color-mix(in srgb, var(--lm-drop) 14%, transparent); }
.lmg-diff tr[data-kind="new"] td.lmg-t::before { content: "+ "; color: var(--lm-ok); }
.lmg-diff tr[data-kind="gone"] td.lmg-t::before { content: "− "; color: var(--lm-drop); }
.lmg-diff tr[data-kind="same"] td.lmg-t::before { content: "  "; }
.lmg-diff tr[data-kind="fold"] td { padding: 2px 8px; color: var(--lm-muted); font-family: var(--lm-font); background: var(--lm-surface); }
`

const LABEL: Record<Line['kind'], string> = { same: '', gone: 'Removed: ', new: 'Added: ' }

/** One file's diff as a table: the line numbers before and after, and each line marked. */
export function Diff({ id, before, after }: { id: string; before?: string; after?: string }) {
  // a file added or removed is all new, or all gone
  const whole = (text: string, kind: 'new' | 'gone'): Line[] =>
    text.split('\n').map((t, i) => ({ kind, text: t, ...(kind === 'new' ? { after: i + 1 } : { before: i + 1 }) }))
  const lines =
    before === undefined
      ? whole(after ?? '', 'new')
      : after === undefined
        ? whole(before, 'gone')
        : lineDiff(before, after)
  return (
    <div className="lmg-diff" id={id}>
      {lines ? (
        <table>
          <tbody>
            {fold(lines).map((r, i) =>
              r.kind === 'fold' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: the rows never move, only the whole table changes
                <tr key={i} data-kind="fold">
                  <td colSpan={3}>
                    {r.count} unchanged line{r.count === 1 ? '' : 's'}
                  </td>
                </tr>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above
                <tr key={i} data-kind={r.kind}>
                  <td className="lmg-n">{r.before ?? ''}</td>
                  <td className="lmg-n">{r.after ?? ''}</td>
                  <td className="lmg-t">
                    {LABEL[r.kind] && <span className="sr-only">{LABEL[r.kind]}</span>}
                    {r.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ) : (
        <p className="lmg-hint">The file is too long to compare here.</p>
      )}
    </div>
  )
}
