/** A line of a diff: kept (" "), taken out ("-") or put in ("+"). */
export interface DiffLine {
  kind: ' ' | '-' | '+'
  text: string
}

/**
 * Two texts compared line by line (the longest run of lines they share), with the lines around each change: what a
 * proposal shows of a file, in the editor and on the command line. Past about four million line pairs it gives the
 * whole file out and in, rather than take the time.
 */
export function diffLines(before: string, after: string, around = 3): (DiffLine | { kind: '@' })[] {
  const a = before ? before.replace(/\n$/, '').split('\n') : []
  const b = after ? after.replace(/\n$/, '').split('\n') : []
  const n = a.length
  const m = b.length
  const ops: DiffLine[] = []
  if (n * m > 4_000_000) {
    for (const t of a) ops.push({ kind: '-', text: t })
    for (const t of b) ops.push({ kind: '+', text: t })
  } else {
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i]![j] = a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        ops.push({ kind: ' ', text: a[i]! })
        i++
        j++
      } else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) ops.push({ kind: '+', text: b[j++]! })
      else ops.push({ kind: '-', text: a[i++]! })
    }
  }
  const keep = new Set<number>()
  ops.forEach((o, x) => {
    if (o.kind !== ' ')
      for (let y = Math.max(0, x - around); y <= Math.min(ops.length - 1, x + around); y++) keep.add(y)
  })
  const out: (DiffLine | { kind: '@' })[] = []
  let last = -2
  for (const x of [...keep].sort((p, q) => p - q)) {
    if (x !== last + 1 && out.length) out.push({ kind: '@' })
    out.push(ops[x]!)
    last = x
  }
  return out
}
