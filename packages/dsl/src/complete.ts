import type { Decl, Edge, Stmt } from './ast'
import { type CompileResult, compile, type DslSymbol } from './compile'
import { BUILTINS } from './expr'
import { type BlockSpec, COLORS, EDGE_PROPS, own, type PropSpec, SCHEMA } from './schema'

export interface Completion {
  label: string
  type: 'keyword' | 'property' | 'variable' | 'function' | 'constant' | 'type'
  /** A few words next to the label. */
  detail?: string
  /** The longer help shown beside the list. */
  info?: string
  /** What to insert, when it differs from the label: "rate: ". */
  apply?: string
}

export interface Completions {
  /** The word being completed: replace source[from, to). */
  from: number
  to: number
  options: Completion[]
}

/**
 * What may be typed at `offset`: the properties and statements of the block the cursor is in, the ids a route or an
 * edge can name, the names a formula can read. Editor-agnostic; pass the last compile result to save a compile.
 */
export function completions(source: string, offset: number, compiled?: CompileResult): Completions {
  const r = compiled ?? compile(source)
  let from = offset
  while (from > 0 && /\w/.test(source[from - 1]!)) from--
  const out = (options: Completion[]) => ({ from, to: offset, options })
  const ids = (kind: DslSymbol['kind']) => [...new Set(r.symbols.filter((s) => s.kind === kind).map((s) => s.id))]

  // flows.|  demand.|  util.|  derived.|
  if (source[from - 1] === '.') {
    let t = from - 1
    while (t > 0 && /\w/.test(source[t - 1]!)) t--
    const table = source.slice(t, from - 1)
    const pool =
      table === 'flows'
        ? ids('flow')
        : table === 'demand' || table === 'util'
          ? ids('component')
          : table === 'derived'
            ? ids('let')
            : []
    return out(pool.map((label) => ({ label, type: 'variable', detail: table })))
  }

  const { spec, edgeBody } = blockAt(r.doc.body, offset)
  const lineStart = source.lastIndexOf('\n', from - 1) + 1
  // the statement so far: what follows the last "{" or ";" on this line
  const before = source
    .slice(lineStart, from)
    .replace(/^.*[{;]/, '')
    .trimStart()

  const stages = () => [
    ...ids('stage').map((label) => ({ label, type: 'variable' as const, detail: 'stage' })),
    ...singleStageBoxes(r.symbols).map((label) => ({ label, type: 'variable' as const, detail: 'box' })),
  ]
  const nodes = () => ids('node').map((label) => ({ label, type: 'variable' as const, detail: 'node' }))

  if (before === '') {
    if (edgeBody) return out(props(EDGE_PROPS))
    const list: Completion[] = [...props(spec.props), ...statements(spec)]
    if (spec.open?.names === 'values' || spec.open?.names === 'params')
      list.push(
        ...[...(spec.open.names === 'values' ? ['load'] : []), ...ids('param')].map((label) => ({
          label,
          type: 'variable' as const,
          apply: `${label}: `,
        })),
      )
    if (spec.open?.names === 'flows')
      list.push(...ids('flow').map((label) => ({ label, type: 'variable' as const, apply: `${label}: ` })))
    if (spec.edges === 'edges') list.push(...nodes())
    if (spec.edges === 'branches') list.push(...ids('flow').map((label) => ({ label, type: 'variable' as const })))
    return out(list)
  }

  // a -> |   flow -> |   route: a -> |
  const chain = /^(\w+)(\s*->\s*\w+)*\s*->\s*$/.test(before)
  const prop = /^(\w+)\s*:\s*(.*)$/.exec(before)
  if (chain && !prop) return out(spec.edges === 'branches' ? stages() : nodes())
  if (prop) {
    const p = edgeBody ? own(EDGE_PROPS, prop[1]!) : own(spec.props, prop[1]!)
    const kind = p?.value
    if (kind === 'route') return out(stages())
    if (kind === 'node') return out(nodes())
    if (kind === 'component') return out(ids('component').map((label) => ({ label, type: 'variable' })))
    if (kind === 'scenario')
      return out(
        ids('scenario').map((label) => ({
          label,
          type: 'constant',
          apply: /^[A-Za-z_]\w*$/.test(label) ? label : JSON.stringify(label),
        })),
      )
    if (kind === 'enum')
      return out((prop[1] === 'color' ? COLORS : (p?.values ?? [])).map((label) => ({ label, type: 'constant' })))
    if (kind === 'boolean' && p?.scope === 'const')
      return out([
        { label: 'true', type: 'constant' },
        { label: 'false', type: 'constant' },
      ])
    // a constant number or text: nothing to pick from
    if (p?.scope === 'const') return out([])
    return out(formulaNames(r, p?.scope ?? 'ctx'))
  }
  // a -> b: |   let x = |
  if (/^\w+(\s*->\s*\w+)+\s*:/.test(before) || /^let\s+\w+\s*=/.test(before)) return out(formulaNames(r, 'ctx'))
  // keyword lines (node x "…") take names and texts: nothing to offer
  return out([])
}

function props(p: Readonly<Record<string, PropSpec>>): Completion[] {
  return Object.entries(p).map(([label, s]) => ({
    label,
    type: 'property',
    apply: `${label}: `,
    detail: s.required ? 'required' : undefined,
    info: s.doc,
  }))
}

function statements(spec: BlockSpec): Completion[] {
  return spec.children
    .filter((k) => k !== 'loadmap')
    .map((k) => ({ label: k, type: 'keyword', info: `${SCHEMA[k]!.doc}\n\n${SCHEMA[k]!.example}` }))
}

function formulaNames(r: CompileResult, scope: string): Completion[] {
  if (scope === 'i' || scope === 'value') return [{ label: scope, type: 'variable' }]
  const params = r.symbols.filter((s) => s.kind === 'param').map((s) => s.id)
  const list: Completion[] = [
    { label: 'load', type: 'variable', detail: '× today' },
    ...params.map((label) => ({ label, type: 'variable' as const, detail: 'parameter' })),
  ]
  if (scope === 'values') return list
  list.push(
    ...r.symbols
      .filter((s) => s.kind === 'let')
      .map((s) => ({ label: s.id, type: 'variable' as const, detail: 'let' })),
    ...['flows', 'demand', 'util', 'derived'].map((label) => ({ label, type: 'type' as const, apply: `${label}.` })),
    ...r.symbols
      .filter((s) => s.kind === 'fit')
      .map((s) => ({ label: s.id, type: 'function' as const, detail: 'fit' })),
    ...Object.keys(BUILTINS).map((label) => ({ label, type: 'function' as const })),
    { label: 'true', type: 'constant' },
    { label: 'false', type: 'constant' },
  )
  return list
}

function singleStageBoxes(symbols: readonly DslSymbol[]): string[] {
  const count = new Map<string, number>()
  for (const s of symbols) if (s.kind === 'stage' && s.detail) count.set(s.detail, (count.get(s.detail) ?? 0) + 1)
  const stages = new Set(symbols.filter((s) => s.kind === 'stage').map((s) => s.id))
  return [...count].filter(([box, n]) => n === 1 && !stages.has(box)).map(([box]) => box)
}

/** The innermost block whose braces hold `offset`. */
function blockAt(body: readonly Stmt[], offset: number): { spec: BlockSpec; edgeBody: boolean } {
  let spec = SCHEMA['']!
  let list = body
  for (;;) {
    const inside = list.find(
      (s): s is Decl | Edge =>
        (s.kind === 'decl' || s.kind === 'edge') && !!s.bodySpan && s.bodySpan.from < offset && offset < s.bodySpan.to,
    )
    if (!inside?.body) return { spec, edgeBody: false }
    // an edge's block holds label and when
    if (inside.kind === 'edge') return { spec, edgeBody: true }
    const next = own(SCHEMA, inside.keyword.name)
    if (!next) return { spec, edgeBody: false }
    spec = next
    list = inside.body
  }
}
