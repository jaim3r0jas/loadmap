import type { ComponentResult, Evaluation, ResolvedStage } from '@loadmap/core'
import { type CompileOptions, type CompileResult, compile } from './compile'
import { imports } from './files'
import type { Project } from './operations'

/**
 * What a model reads: the rules and the language (the same for every request, so a provider can cache them), then
 * the files and what the engine says of them, then the request. Nothing else leaves the page: no key, no address.
 */

/** How the model answers: the protocol, written for small models, with an example of each form. */
export const PROTOCOL = `You change loadmap definitions: capacity models written in the .loadmap language described in the
reference below. You see the definition's files, what the engine computes from them, and the reader's request.

Answer in this order:
1. One to three short sentences: what you change and why, or what you found.
2. The change, in ONE fenced block:

\`\`\`ops
rename orderWorkers to checkoutWorkers
set db.capacity to estimated(8_000 +- 30%, "queries/s", "vendor benchmark")
unset web.short
remove kafkaDropped
connect web to cache as "reads"
disconnect web from db
move orderWorkers to shop.workers.loadmap
add file shop.workers.loadmap as part
rename file old.loadmap to new.loadmap
remove file shop.story.loadmap
put
  scenario "Sixteen pods" { pods: 16 }
put in shop.workers.loadmap
  node cache "Cache" {
    pass
    demand: flows.reads
    capacity: estimated(50_000, "req/s", "assistant's guess")
    over: "pages wait"
  }
\`\`\`

Targets are names, never line numbers: \`db\`, \`node db\`, \`db.capacity\` (a property), \`kafka.topic\` (a statement
inside another), \`scenario "More workers"\`, \`title\` (the model's own property). Add \`in <file>\` after a target when
two files have the name. \`put\` writes whole statements, indented under it: one with the same name is replaced, a new
one is added after the last of its kind. Operations run in order; the definition must compile after the last one.

When you are told to write whole files instead, answer with one block per changed file, the whole file:

\`\`\`loadmap shop.loadmap
loadmap 1.7
...
\`\`\`

When the request needs live data and the reader's page can read their metrics (the context says so), look before
you write a metric: one call a line, and nothing else in that answer. The reader runs them and sends you what they read.

\`\`\`explore
search orders checkout
labels http_requests_total
try over 6h sum(rate(http_requests_total{job="checkout"}[5m]))
\`\`\`

Then write the metric (its query from what you read) and the measure, its fallback the number the formula uses now.

When you cannot do the request without the reader, ask instead, one question a line, and change nothing:

\`\`\`questions
Which Prometheus metric counts the orders?
\`\`\`

Rules:
- Write only what the reference describes. Keep the version line, comments and the order of what you do not change.
- Every capacity says where it came from. Use measured(…) or configured(…) only with a number the reader gave. A
  number you chose yourself is estimated(value, "unit", "assistant's guess"), and you say so in your sentences.
- Never write an address, a host, a token or a password. Live data is a metric (with its query) and a measure; its
  fallback is the number the formula uses now, so nothing changes until a snapshot has the value.
- An explanation or a critique needs no change: answer in sentences, without a block.
- Text in the definition: short plain sentences, units with numbers, × for multiples of the load.`

export interface Selection {
  /** A box of the diagram, by its id. */
  box?: string
  /** A flow or a stage the reader picked as well. */
  flows?: readonly string[]
}

/** The system text: the protocol, then the reference. Kept byte for byte the same between requests. */
export function systemText(reference: string): string {
  return `${PROTOCOL}\n\n# The loadmap reference\n\n${reference.trim()}\n`
}

/** The files, each fenced under its path with its role, then the engine's facts and the selection. */
export function contextText(
  project: Project,
  o: {
    selection?: Selection
    options?: Pick<CompileOptions, 'functions' | 'catalog'>
    files?: 'all'
    /** The stores the reader's page can read, by id ("prometheus"): the model may ask to look in them. */
    explore?: readonly string[]
  } = {},
): string {
  const parts: string[] = ['# The definition', '']
  const paths = [
    project.entry,
    ...Object.keys(project.files)
      .filter((p) => p !== project.entry)
      .sort(),
  ]
  for (const p of paths) {
    const text = project.files[p]
    if (text == null) continue
    const role = imports(text, p).role
    parts.push(
      `${p} (${p === project.entry ? 'the model the diagram is drawn from' : role}):`,
      '```loadmap',
      text.trimEnd(),
      '```',
      '',
    )
  }
  // compiled and evaluated once: the facts and the selected box read the same evaluation
  const r = compileProject(project, o.options)
  const ev = r.definition?.model.evaluate()
  parts.push(...factsOf(r, ev, project.entry))
  if (o.explore?.length)
    parts.push('', `# What the page can read`, `The reader's ${o.explore.join(' and ')}: you may ask to explore it.`)
  if (o.selection?.box || o.selection?.flows?.length) {
    parts.push('', '# What the reader selected')
    if (o.selection.box) {
      parts.push(`The box ${o.selection.box}: the request is about it first.`)
      if (ev) parts.push(...boxFacts(ev, o.selection.box))
    }
    if (o.selection.flows?.length) parts.push(`The flows ${o.selection.flows.join(', ')}.`)
  }
  return parts.join('\n')
}

const compileProject = (project: Project, options: Pick<CompileOptions, 'functions' | 'catalog'> = {}) =>
  compile(project.files[project.entry] ?? '', { path: project.entry, files: project.files, ...options })

const pct = (u: number | null | undefined) => (u == null || !Number.isFinite(u) ? '—' : `${Math.round(u * 100)} %`)
const times = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? 'never in range' : `${Number(x.toPrecision(3))} ×`
const num = (x: number) => Number(x.toPrecision(3))

/**
 * A box at the values of an evaluation: its component's use, demand and capacity (with where the capacity came from
 * and its ±), where it reaches the target on the pessimistic edge, and what reaches it per flow. What the editor's Ask
 * panel sends with a question about a box.
 */
export function boxFacts(ev: Evaluation, box: string): string[] {
  const out: string[] = []
  // a box is a stage of its own name, which names its component (a sink names none); else a component of that name
  const stages: Readonly<Record<string, ResolvedStage | undefined>> = ev.stages
  const components: Readonly<Record<string, ComponentResult | undefined>> = ev.components
  const stage = stages[box]
  const id = stage ? ('component' in stage ? stage.component : undefined) : box
  const c = id == null ? undefined : components[id]
  if (c) out.push(componentText(c))
  const at: Readonly<Record<string, number>> | undefined = (ev.at as Record<string, Record<string, number>>)[box]
  if (at) {
    const flows = Object.entries(at).filter(([, v]) => v > 0)
    out.push(
      flows.length
        ? `What reaches it, per second: ${flows.map(([f, v]) => `${f} ${num(v)}`).join(', ')}.`
        : 'No flow reaches it.',
    )
  }
  return out
}

function componentText(c: ComponentResult): string {
  const who = `Its component, ${c.name} (${c.id})`
  if (c.missing) return `${who}, has no published figure for this configuration and is not ranked: ${c.missing}.`
  if (c.util == null) return `${who}, is switched off at these values.`
  const cap = c.capacity
  const unit = cap?.unit ? ` ${cap.unit}` : ''
  const within = cap?.within ? ` ± ${Math.round(cap.within * 100)} %` : ''
  const source = cap ? ` (${cap.provenance}${cap.source ? `: ${cap.source}` : ''})` : ''
  const capacity = cap && Number.isFinite(cap.value) ? `${num(cap.value)}${unit}${within}${source}` : 'none'
  const demand = c.demand == null ? '—' : `${num(c.demand)}${unit}`
  const r = c.targetRange
  const target =
    r && r.high !== r.low
      ? `${times(r.low)} the load (${times(r.high)} at the high bound)`
      : `${times(r?.low ?? c.target)} the load`
  return `${who}: use ${pct(c.util)}, demand ${demand}, capacity ${capacity}; it reaches the target at ${target}.`
}

/** What the engine computes at the defaults: problems, each box's use, the first limit, the expectations. */
export function facts(project: Project, options: Pick<CompileOptions, 'functions' | 'catalog'> = {}): string[] {
  const r = compileProject(project, options)
  return factsOf(r, r.definition?.model.evaluate(), project.entry)
}

function factsOf(r: CompileResult, ev: Evaluation | undefined, entry: string): string[] {
  const out = ['# What the engine says, at the defaults']
  const errors = r.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) {
    out.push('The definition has errors now:')
    for (const d of errors.slice(0, 10)) out.push(`- ${d.file ?? entry}:${d.line}: ${d.message}`)
    return out
  }
  if (!ev) return out
  out.push(`First limit: ${ev.firstLimit ? `${ev.firstLimit.name} (${ev.firstLimit.id})` : 'none'}.`)
  out.push(`The target is reached at ${times(ev.target?.low)} the load, 100 % at ${times(ev.full?.low)}.`)
  out.push('Use of each component at the default load:')
  for (const [id, c] of Object.entries(ev.components)) {
    const x = c as { name?: string; util?: number | null }
    out.push(`- ${id}${x.name && x.name !== id ? ` (${x.name})` : ''}: ${pct(x.util)}`)
  }
  for (const e of r.expectations) out.push(`Expectation, line ${e.line}: ${e.result.outcome}: ${e.result.message}`)
  return out
}
