import type { Capacity } from './capacity'
import { fmt, joinAnd } from './format'

/** A value a run was made under: a count, a word or a switch. */
export type ConditionValue = number | string | boolean

/** Where a figure was published. Who ran it is metadata: the figure belongs to the component, not to them. */
export interface Source {
  title: string
  url: string
  /** Who published or ran it: "the etcd project", "Confluent". */
  by: string
  /** The date the page gives (YYYY-MM-DD); none when the page has none. */
  date?: string
  /** The day the catalog read the figure on the page. */
  checked: string
}

/**
 * One published figure: a run, a table cell or a documented limit. It applies only under its `when` (the conditions
 * that decide it); everything else about the run is listed in `conditions`. A figure in a released edition never
 * changes: a correction or a newer run goes into the next edition.
 */
export interface Figure {
  /** Unique in its component and stable across editions: what a definition names. */
  id: string
  /**
   * capacity: what it handled at best (a ceiling); limit: a documented maximum (exact); latency and cost: references
   * shown beside a capacity, never one.
   */
  measure: 'capacity' | 'limit' | 'latency' | 'cost'
  value: number
  unit: string
  /** What it measures, as a phrase: "peak produce throughput". */
  what: string
  /** For the whole cluster, per node, per instance. */
  scope: string
  /** The conditions that decide it: a configuration matches only with every one of them equal. */
  when: Readonly<Record<string, ConditionValue>>
  /** The rest of the run: hardware, tool, settings. Shown, never matched. */
  conditions: readonly string[]
  /** The versions it was run on, as prefixes ("4.0" covers 4.0.3); matched only when the component's version decides. */
  versions: readonly string[]
  source: Source
}

/** A condition a figure can depend on: what the reader sets. */
export interface Condition {
  label: string
  doc: string
  /** For a number: "brokers" in "3 brokers". */
  unit?: string
}

/** A component of the catalog, the same whoever runs it: vendors and versions are metadata of its figures. */
export interface CatalogComponent {
  id: string
  name: string
  /** One line for the picker. */
  about: string
  kind:
    | 'stream'
    | 'queue'
    | 'cache'
    | 'database'
    | 'store'
    | 'analytics'
    | 'search'
    | 'proxy'
    | 'dns'
    | 'platform'
    | 'mesh'
  /** How a box of it is drawn. */
  box: 'node' | 'cluster' | 'pool'
  shape?: 'box' | 'cylinder'
  /** Other names it is found by: a protocol-compatible project. */
  tags: readonly string[]
  /** A source shows the version changing its figures: the version is then a condition of every figure. */
  versionMatters: boolean
  conditions: Readonly<Record<string, Condition>>
  /** Empty when nothing is published with its conditions. */
  figures: readonly Figure[]
}

export interface Catalog {
  /** YYYY-MM: a definition pins it, so an old file keeps its numbers. */
  edition: string
  components: Readonly<Record<string, Published>>
}

/** The published figure behind a capacity, as the verdict, the assumptions and the inspector show it. */
export interface Reference {
  component: string
  name: string
  edition: string
  figure: string
  measure: Figure['measure']
  what: string
  scope: string
  /** The deciding conditions as words ("3 brokers", "acks all"), then the listed ones. */
  conditions: readonly string[]
  /** The versions it was run on, and the one the reader runs when given. */
  versions: readonly string[]
  version?: string
  source: Source
}

/** What a reader runs: the deciding conditions, the version, and which figure when several match. */
export type PublishedConfig = {
  figure?: string
  version?: string
  /** A share from 0 to below 1 that lowers a best case: the capacity then ranges from (1 − margin) × the figure up to it. */
  margin?: number
} & Record<string, ConditionValue | undefined>

/** The catalog's edition and component, as `published()` takes them: one component of one edition. */
export interface Published extends CatalogComponent {
  edition: string
}

/** "3 brokers", "acks all", "TLS on". */
export function conditionText(c: CatalogComponent, key: string, v: ConditionValue): string {
  const def = c.conditions[key]
  if (typeof v === 'boolean') return `${def?.label ?? key} ${v ? 'on' : 'off'}`
  // one of a plural unit: "1 CPU"
  if (typeof v === 'number' && def?.unit) return `${fmt(v)} ${v === 1 ? def.unit.replace(/s$/, '') : def.unit}`
  return `${def?.label ?? key} ${typeof v === 'number' ? fmt(v) : v}`
}

const coversVersion = (versions: readonly string[], v: string) =>
  versions.some((p) => v === p || v.startsWith(`${p}.`) || v.startsWith(`${p}-`))

/**
 * The figure a configuration matches, or why none does. Never scaled or interpolated: a figure applies only with
 * every deciding condition equal to its run's.
 */
export function match(c: CatalogComponent, config: PublishedConfig): { figure: Figure } | { missing: string } {
  const own = new Set(['figure', 'version', 'margin'])
  for (const k of Object.keys(config))
    if (!own.has(k) && !Object.hasOwn(c.conditions, k))
      throw new Error(
        `loadmap: ${c.name} has no condition "${k}"${Object.keys(c.conditions).length ? `: ${Object.keys(c.conditions).join(', ')}` : ''}`,
      )
  if (config.figure != null && !c.figures.some((f) => f.id === config.figure))
    throw new Error(`loadmap: ${c.name} has no figure "${config.figure}": ${c.figures.map((f) => f.id).join(', ')}`)
  const usable = c.figures.filter(
    (f) => (f.measure === 'capacity' || f.measure === 'limit') && (config.figure == null || f.id === config.figure),
  )
  // each reason follows "no published benchmark" in a sentence
  if (!c.figures.length) return { missing: `(nothing is published for ${c.name} with its conditions)` }
  if (!usable.length) {
    const f = c.figures.find((x) => x.id === config.figure) ?? c.figures[0]!
    return { missing: `(${c.name} has a published ${f.measure}, not a capacity)` }
  }
  // the nearest run says what differs: the fewest conditions apart
  const misses = (f: Figure) => {
    const out: string[] = []
    if (c.versionMatters) {
      if (config.version == null) out.push(`a version (runs on ${f.versions.join(', ')})`)
      else if (!coversVersion(f.versions, String(config.version))) out.push(`version ${config.version}`)
    }
    for (const [k, v] of Object.entries(f.when))
      if (config[k] == null) out.push(`a value for ${c.conditions[k]?.label ?? k}`)
      else if (!same(config[k]!, v)) out.push(conditionText(c, k, config[k]!))
    return out
  }
  const scored = usable.map((f) => ({ f, m: misses(f) }))
  const hit = scored.find((s) => !s.m.length)
  if (hit) return { figure: hit.f }
  const near = scored.reduce((a, b) => (b.m.length < a.m.length ? b : a))
  const given = near.m.filter((m) => !m.startsWith('a '))
  // the values of k in the runs that match on every other condition: the cells of the same table row
  const runs = (k: string) => {
    const alike = usable.filter((f) =>
      Object.entries(f.when).every(([j, v]) => j === k || config[j] == null || same(config[j]!, v)),
    )
    const vs = [...new Set(alike.flatMap((f) => (f.when[k] == null ? [] : [f.when[k]])))]
    vs.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0))
    return vs.map((v) => conditionText(c, k, v))
  }
  const keys = Object.keys(near.f.when).filter((k) => config[k] != null && !same(config[k]!, near.f.when[k]!))
  const used = keys.length ? `: the published runs use ${joinAnd(runs(keys[0]!), 'or')}` : ''
  return {
    missing: given.length
      ? `for ${joinAnd(given)}${used}`
      : `without ${joinAnd(near.m.map((m) => m.replace(/^a (value for )?/, '')))}`,
  }
}

/** acks 1 and acks "1" are one value: a definition may write either. */
const same = (a: ConditionValue, b: ConditionValue) => String(a) === String(b)

/**
 * A capacity from the catalog: the figure published for this configuration, labelled as such, or a capacity that says
 * there is none (the component is then not ranked, and the verdict says why). Who ran it and on which version are
 * metadata in its reference.
 *
 *     capacity: ({ brokers }) => published(kafka, { brokers, replication: 3, acks: 'all', messageSize: '1 KB' })
 */
export function published(c: Published, config: PublishedConfig = {}): Capacity {
  const { margin } = config
  if (margin != null && !(margin >= 0 && margin < 1))
    throw new Error(`loadmap: margin is a share from 0 to below 1 (0.3 is 30 %), not ${margin}`)
  const m = match(c, config)
  if ('missing' in m) {
    const f = c.figures.find((x) => x.measure === 'capacity' || x.measure === 'limit')
    return { value: Number.NaN, unit: f?.unit ?? '', provenance: 'published', missing: m.missing, source: c.name }
  }
  const f = m.figure
  if (margin && f.measure === 'limit')
    throw new Error(`loadmap: ${c.name}'s "${f.id}" is a documented limit: exact, so it takes no margin`)
  const ref: Reference = {
    component: c.id,
    name: c.name,
    edition: c.edition,
    figure: f.id,
    measure: f.measure,
    what: f.what,
    scope: f.scope,
    conditions: [...Object.entries(f.when).map(([k, v]) => conditionText(c, k, v)), ...f.conditions],
    versions: f.versions,
    ...(config.version != null && { version: String(config.version) }),
    source: f.source,
  }
  const cap: Capacity = { value: f.value, unit: f.unit, provenance: 'published', source: sourceText(ref), ref }
  if (f.measure === 'capacity') cap.ceiling = true
  if (margin) cap.within = margin
  return cap
}

/** "Apache Kafka, run by Confluent, 2020-08-21": the line a capacity's source shows. */
export function sourceText(r: Reference): string {
  return `${r.name}, ${r.measure === 'limit' ? 'documented by' : 'run by'} ${r.source.by}${r.source.date ? `, ${r.source.date}` : ''}`
}
