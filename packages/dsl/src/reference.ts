import { BUILTINS } from './expr'
import { type BlockSpec, EDGE_PROPS, type PropSpec, SCHEMA } from './schema'

const SCOPE: Record<PropSpec['scope'], string> = {
  ctx: 'formula',
  values: 'formula of parameters',
  i: 'formula of `i`',
  value: 'formula of `value`',
  const: 'constant',
}

/** The statement reference of docs/dsl.md, written from the schema table, so the two cannot drift apart. */
const OPEN: Record<NonNullable<BlockSpec['open']>['names'], string> = {
  values: 'parameters (and `load`)',
  params: 'parameters (not `load`)',
  flows: 'flows',
  conditions: "the catalog component's conditions (its runs' brokers, message size, …)",
  arguments: "the arguments its metric's query names (`{{ args.job }}`: `job`)",
}

export function reference(): string {
  const out: string[] = []
  const table = (props: Readonly<Record<string, PropSpec>>) => {
    if (!Object.keys(props).length) return
    out.push('| Property | Value | |', '| --- | --- | --- |')
    for (const [k, p] of Object.entries(props)) {
      const words = p.values?.map((v) => `\`${v}\``)
      const value = !words
        ? `${p.value}, ${SCOPE[p.scope]}`
        : p.value === 'names'
          ? `a list of ${words.join(', ')}`
          : words.join(' \\| ')
      out.push(`| \`${k}\`${p.required ? ' (required)' : ''} | ${value} | ${p.doc.replaceAll('|', '\\|')} |`)
    }
    out.push('')
  }
  const block = (name: string, spec: BlockSpec) => {
    out.push(`### ${name || 'The top level'}`, '', spec.doc, '')
    if (spec.example) out.push('```', spec.example, '```', '')
    if (spec.args.length)
      out.push(
        `After the keyword: ${spec.args.map((a) => (a.optional ? `[${a.name}]` : a.name)).join(' ')}${spec.init ? ' = formula' : ''}.`,
        '',
      )
    table(spec.props)
    const holds = spec.children.filter((c) => c !== 'loadmap')
    if (holds.length) out.push(`Holds: ${holds.map((c) => `\`${c}\``).join(', ')}.`, '')
    if (spec.open) out.push(`Its properties are named by ${OPEN[spec.open.names]}.`, '')
    if (spec.edges === 'edges') out.push('Holds edges: `a -> b`, `a -> b: label`, `a -> b { label: …; when: … }`.', '')
    if (spec.edges === 'branches') out.push('Holds branches: `flow -> stage: copies per unit`.', '')
  }
  for (const [name, spec] of Object.entries(SCHEMA)) block(name, spec)
  out.push(
    '### Edges',
    '',
    'A line between two nodes: `a -> b`, a chain `a -> b -> c`, or with a label `a -> b: "…"`.',
    '',
  )
  table(EDGE_PROPS)
  out.push(
    '### Functions',
    '',
    Object.keys(BUILTINS)
      .map((f) => `\`${f}\``)
      .join(', '),
    '',
  )
  return out.join('\n')
}
