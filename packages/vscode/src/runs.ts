import { type ConditionValue, type Published, published } from '@loadmap/core'
import { fmt } from '@loadmap/core/format'
import { conditionText } from '@loadmap/core/internal'
import type { CatalogPick } from '@loadmap/dsl/internal'

/** A published run as a row to pick: the figure, its conditions, who ran it, and what it writes. */
export interface Run {
  /** "90 000 msg/s", or "No published benchmark". */
  label: string
  /** The deciding conditions and the version: "3 brokers · acks all · 3.6". */
  description: string
  /** What it measures and its source: "published, a best case: peak produce throughput, cluster · run by Confluent…". */
  detail: string
  /** The rest of the run (hardware, tool, settings), for the step after. */
  more: readonly string[]
  /** The source page, an http(s) link. */
  url?: string
  pick: Omit<CatalogPick, 'into' | 'component'>
}

/** The components to pick from, by name; those that publish nothing say so. */
export function componentRows(components: readonly Published[]) {
  return [...components]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      label: c.name,
      // searched too: the id and the names it is found by
      description: [c.id, ...c.tags].join(' · '),
      detail: c.figures.some((f) => f.measure === 'capacity' || f.measure === 'limit')
        ? c.about
        : `Nothing published with its conditions. ${c.about}`,
      component: c,
    }))
}

/**
 * Each published run of a component as a row: a capacity or a limit, once per version where the version decides.
 * The figure shown is the one `published()` gives for what the row writes, never read off the run by hand. A
 * component without one has a single row that says there is no published benchmark.
 */
export function runs(c: Published): Run[] {
  const usable = c.figures.filter((f) => f.measure === 'capacity' || f.measure === 'limit')
  const rows = usable.flatMap((f) =>
    (c.versionMatters ? f.versions : [undefined]).map((version): Run => {
      // the figure by name only where another run has the same conditions
      const same = usable.filter((g) => sameConditions(g.when, f.when)).length > 1
      const { conditions, ...which } = {
        conditions: f.when,
        ...(version ? { version } : {}),
        ...(same ? { figure: f.id } : {}),
      }
      const pick = { conditions, ...which }
      const cap = published(c, { ...conditions, ...which })
      const ref = cap.ref
      const where = Object.entries(f.when).map(([k, v]) => conditionText(c, k, v))
      const s = f.source
      return {
        label: ref ? `${fmt(cap.value)} ${cap.unit}` : 'No published benchmark',
        description: [...where, ...(version ? [version] : [])].join(' · '),
        detail: `${f.measure === 'limit' ? 'published limit' : 'published, a best case'}: ${f.what}, ${f.scope} · run by ${s.by}${s.date ? `, ${s.date}` : ''}: ${s.title}`,
        more: f.conditions,
        ...(/^https?:\/\//.test(s.url) ? { url: s.url } : {}),
        pick,
      }
    }),
  )
  if (rows.length) return rows
  return [
    {
      label: 'No published benchmark',
      description: '',
      detail: `${published(c).missing ?? ''}: the box will say so, and give no number`.replace(/^: /, ''),
      more: [],
      pick: { conditions: {} },
    },
  ]
}

const sameConditions = (a: Readonly<Record<string, ConditionValue>>, b: Readonly<Record<string, ConditionValue>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v)
