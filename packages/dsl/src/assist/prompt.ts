import { type CompileOptions, compile } from '../compile'
import { imports } from '../files'
import type { Project } from '../operations'

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
loadmap 1.6
...
\`\`\`

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
  o: { selection?: Selection; options?: Pick<CompileOptions, 'functions' | 'catalog'>; files?: 'all' } = {},
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
  parts.push(...facts(project, o.options))
  if (o.selection?.box || o.selection?.flows?.length) {
    parts.push('', '# What the reader selected')
    if (o.selection.box) parts.push(`The box ${o.selection.box}: the request is about it first.`)
    if (o.selection.flows?.length) parts.push(`The flows ${o.selection.flows.join(', ')}.`)
  }
  return parts.join('\n')
}

const pct = (u: number | null | undefined) => (u == null || !Number.isFinite(u) ? '—' : `${Math.round(u * 100)} %`)
const times = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? 'never in range' : `${Number(x.toPrecision(3))} ×`

/** What the engine computes at the defaults: problems, each box's use, the first limit, the expectations. */
export function facts(project: Project, options: Pick<CompileOptions, 'functions' | 'catalog'> = {}): string[] {
  const r = compile(project.files[project.entry] ?? '', { path: project.entry, files: project.files, ...options })
  const out = ['# What the engine says, at the defaults']
  const errors = r.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) {
    out.push('The definition has errors now:')
    for (const d of errors.slice(0, 10)) out.push(`- ${d.file ?? project.entry}:${d.line}: ${d.message}`)
    return out
  }
  const model = r.definition?.model
  if (!model) return out
  const ev = model.evaluate()
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
