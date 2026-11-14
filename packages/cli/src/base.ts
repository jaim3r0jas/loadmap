import { execFile } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  type Assumption,
  compareDefinitions,
  type DefinitionChange,
  type Latency,
  type Model,
  type Tolerance,
} from '@loadmap/core'
import { duration, fmt, multiples, pct } from '@loadmap/core/format'
import type { CompileResult, Diagnostic } from '@loadmap/dsl'
import { Reporter } from '@loadmap/dsl/internal'

const run = promisify(execFile)

/** The marker the comment is found again by: one comment per pull request, updated in place. */
export const COMMENT_MARKER = '<!-- loadmap-check -->'

/** A definition against its base, as a run's result writes it. */
export interface CheckedBase {
  ref: string
  /** One sentence: what moved, or why there is nothing to compare. */
  text: string
  /** Why the loss is accepted (`--accept`): the triggers are then warnings. */
  accepted: string | null
  triggers: { kind: string; component: string | null; text: string }[]
  firstLimit: { base: string | null; head: string | null }
  target: { base: number | null; head: number | null }
  components: {
    id: string
    name: string
    base: { util: number | null; target: Range | null; full: Range | null } | null
    head: { util: number | null; target: Range | null; full: Range | null } | null
    change: number | null
  }[]
  /** Each flow's p99 at the defaults, in seconds, for a flow with a latency on either side; null where it has none. */
  latency: { flow: string; name: string; base: P99; head: P99 }[]
  /** The head's assumptions, with where each number comes from. */
  assumptions: string[]
  /** Measures the base reads that the snapshot does not have: on its side they are its own values. */
  lacking: string[]
}

type Range = { low: number | null; high: number | null }
/** Seconds, or unbounded once a stage on the way is past full. */
type P99 = number | 'unbounded' | null

/** The definition as it is at `ref`, from git: null when the file is new in this change. Throws on a git error. */
export async function baseSource(file: string, ref: string): Promise<string | null> {
  const path = resolve(file)
  try {
    const { stdout } = await run('git', ['show', `${ref}:./${basename(path)}`], {
      cwd: dirname(path),
      maxBuffer: 16 * 1024 * 1024,
      // git's own words, whatever the machine's language: they tell a new file from an error
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    return stdout
  } catch (err) {
    const why = String((err as { stderr?: string }).stderr ?? (err as Error).message)
    // a file this change adds: nothing to compare it with
    if (/does not exist in|exists on disk, but not in/.test(why)) return null
    throw new Error(`cannot read it at ${ref} (${why.trim().split('\n')[0]})`)
  }
}

/** "10%" is a share of the base's headroom, "0.5×" (or "0.5x") load multiples. */
export function parseTolerance(s: string): Tolerance {
  const share = /^(\d+(\.\d+)?)\s*%$/.exec(s)
  if (share) return { share: Number(share[1]) / 100 }
  const times = /^(\d+(\.\d+)?)\s*[×x]$/.exec(s)
  if (times) return { times: Number(times[1]) }
  throw new Error(`--tolerance is a share ("10%") or load multiples ("0.5×"), not "${s}"`)
}

/**
 * The head against its base: the change, and each trigger as a diagnostic on the line of the component it is about
 * (an error, or a warning when the loss is accepted). Null when the base cannot be compared, with why.
 */
export function compareFile(
  ref: string,
  base: CompileResult | null,
  head: CompileResult,
  source: string,
  o: { tolerance?: Tolerance; accept?: string; lacking?: readonly string[] },
): { checked: CheckedBase; diagnostics: Diagnostic[] } | { note: string } {
  if (!base) return { note: `new at this change: nothing at ${ref} to compare` }
  if (!base.ok || !base.definition) return { note: `it does not compile at ${ref}: nothing to compare` }
  if (!head.ok || !head.definition) return { note: 'it does not compile: nothing to compare' }
  let change: DefinitionChange
  try {
    change = compareDefinitions(
      base.definition.model,
      head.definition.model,
      o.tolerance ? { tolerance: o.tolerance } : {},
    )
  } catch (err) {
    return { note: `it cannot be compared with ${ref} (${(err as Error).message.replace(/^loadmap: /, '')})` }
  }
  const where = new Reporter(source)
  const diagnostics = change.triggers.map((t): Diagnostic => {
    const at = head.symbols.find((s) => s.kind === 'component' && s.id === t.component)?.span ?? { from: 0, to: 0 }
    const { line, column } = where.position(at.from)
    return {
      severity: o.accept ? 'warning' : 'error',
      message: `against ${ref}, ${t.text}${o.accept ? ` (accepted: ${o.accept})` : ''}`,
      from: at.from,
      to: at.to,
      line,
      column,
    }
  })
  const side = (s: DefinitionChange['components'][number]['base']) =>
    s ? { util: num(s.util), target: range(s.target), full: range(s.full) } : null
  return {
    diagnostics,
    checked: {
      ref,
      text: change.text,
      accepted: o.accept ?? null,
      triggers: change.triggers.map((t) => ({ kind: t.kind, component: t.component, text: t.text })),
      firstLimit: { base: change.base.firstLimit?.id ?? null, head: change.head.firstLimit?.id ?? null },
      target: { base: num(change.base.target), head: num(change.head.target) },
      components: change.components.map((c) => ({
        id: c.id,
        name: c.name,
        base: side(c.base),
        head: side(c.head),
        change: c.change == null ? null : Number.isFinite(c.change) ? c.change : null,
      })),
      latency: latencyRows(base.definition.model, head.definition.model),
      assumptions: head.definition.model.evaluate().assumptions.map(assumptionText),
      lacking: [...(o.lacking ?? [])],
    },
  }
}

/** Each flow's p99 on both sides, for the flows that have one on either. */
function latencyRows(base: Model, head: Model): CheckedBase['latency'] {
  const was = base.evaluate().latency as Record<string, Latency | null>
  const now = head.evaluate().latency as Record<string, Latency | null>
  // a flow the head removed keeps its row, with nothing on the head's side
  return [...new Set([...head.flowIds, ...base.flowIds])]
    .filter((f) => was[f] || now[f])
    .map((f) => ({
      flow: f,
      name: head.def.flows[f]?.label ?? base.def.flows[f]?.label ?? f,
      base: p99Of(was[f]),
      head: p99Of(now[f]),
    }))
}

const p99Of = (l: Latency | null | undefined): P99 => (!l ? null : Number.isFinite(l.p99) ? l.p99 : 'unbounded')

/** An assumption as one line, with where its number comes from. */
function assumptionText(a: Assumption): string {
  if (a.kind === 'capacity') {
    const c = a.capacity
    if (c.missing != null) return `${a.name}: no published benchmark ${c.missing}`
    const within = c.within ? ` ± ${pct(c.within)}` : ''
    const unread = c.unread ? `; no data from the snapshot (${c.unread})` : ''
    return `${a.name}: ${fmt(c.value)} ${c.unit}${within}, ${c.provenance}${c.source ? ` (${c.source})` : ''}${unread}`
  }
  if (a.kind === 'connection') return `${a.name}: ${a.text}`
  if (a.kind === 'fit') {
    const f = a.fit
    return `${a.name}: ${f.y} = ${fmt(f.a)} + ${fmt(f.b)} × ${f.x}, fitted over ${f.n} points${f.source ? ` (${f.source})` : ''}`
  }
  const m = a.measurement
  return m.missing != null
    ? `${m.label ?? a.name}: no data (${m.missing})`
    : `${m.label ?? a.name}: ${fmt(m.value)} ${m.unit}, measured (${m.source ?? m.origin.provider})`
}

/** Infinity (never) and NaN have no JSON: they are written null. */
export const num = (x: number | null | undefined) => (x != null && Number.isFinite(x) ? x : null)
export const range = (x: { low: number; high: number } | null) => (x ? { low: num(x.low), high: num(x.high) } : null)
/** Text that sits in a Markdown table cell. */
export const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
const short = (r: Range | null) =>
  !r || r.low == null
    ? r
      ? 'never'
      : '—'
    : multiples({ low: r.low, high: r.high ?? Number.POSITIVE_INFINITY }, 2000, true)

/** A definition's change as Markdown: the sentence, what fails, the table, and the assumptions folded away. */
export function changeMarkdown(file: string, b: CheckedBase): string {
  const out = [`**\`${cell(file)}\`** against \`${cell(b.ref)}\`: ${cell(b.text)}`, '']
  for (const t of b.triggers) out.push(`- ${b.accepted ? '⚠️' : '❌'} ${cell(t.text)}`)
  if (b.accepted) out.push('', `> Accepted: ${cell(b.accepted)}`)
  if (b.lacking.length)
    out.push(
      '',
      `> The base reads ${b.lacking.map((m) => `\`${cell(m)}\``).join(', ')}, which this snapshot does not have: on its side, the definition's own values.`,
    )
  if (b.triggers.length) out.push('')
  out.push('| Component | Base headroom | Head headroom | Δ | 100 % at |', '| --- | --- | --- | --- | --- |')
  for (const c of b.components) {
    const delta =
      c.change == null ? '—' : c.change === 1 ? '0' : `${c.change > 1 ? '+' : '−'}${pct(Math.abs(c.change - 1))}`
    out.push(
      `| ${cell(c.name)} | ${short(c.base?.target ?? null)} | ${short(c.head?.target ?? null)} | ${delta} | ${short(c.head?.full ?? null)} |`,
    )
  }
  if (b.latency.length) {
    const p99 = (x: P99) => (x == null ? '—' : x === 'unbounded' ? x : duration(x))
    out.push('', '| Flow | Base p99 | Head p99 |', '| --- | --- | --- |')
    for (const l of b.latency) out.push(`| ${cell(l.name)} | ${p99(l.base)} | ${p99(l.head)} |`)
  }
  out.push('', '<details><summary>What this assumes, and where each number comes from</summary>', '')
  for (const a of b.assumptions) out.push(`- ${cell(a)}`)
  out.push('', '</details>', '')
  return out.join('\n')
}

/**
 * The pull request comment: every definition's change, behind the marker a workflow finds it by. Headroom is where
 * each component reaches the target, as load multiples of today, on both edges of its ±.
 */
export function commentBody(
  files: readonly { file: string; outcome: string; base?: CheckedBase | null; note?: string | null }[],
  dryRun: boolean,
): string {
  const out = [COMMENT_MARKER, '### Capacity', '']
  if (dryRun) out.push('A dry run: nothing here blocks the merge.', '')
  for (const f of files) {
    if (f.base) out.push(changeMarkdown(f.file, f.base))
    else out.push(`**\`${cell(f.file)}\`**: ${cell(f.note ?? f.outcome)}`, '')
  }
  out.push(
    '<sub>Headroom: where each component reaches its target, in multiples of today’s load, low to high edge.</sub>',
  )
  return `${out.join('\n')}\n`
}
