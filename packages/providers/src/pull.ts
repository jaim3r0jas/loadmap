import type { Origin, Snapshot, Stat, TimeSeries } from '@loadmap/core'
import { parseSnapshot, summarize } from '@loadmap/core/measure'

/** What a provider is asked: a query over a window, at a step. Instants are ISO 8601, the step in seconds. */
export interface ProviderQuery {
  query: string
  from: string
  to: string
  step: number
}

/** A provider answers with the points, or says why not: an error is data, never a throw. */
export type ProviderResult = { points: TimeSeries } | { error: string }

/** One metrics store: a query in, normalized points out. */
export interface Provider {
  /** "prometheus": the name a metric's block gives it. */
  id: string
  read(q: ProviderQuery): Promise<ProviderResult>
}

/** A measurement to read: a definition's `measure` with its query filled in (`compile(…).measures`). */
export interface PullRequest {
  id: string
  metric?: string
  label?: string
  provider: string
  query: string
  stat?: Stat
  min?: number
  unit: string
}

export interface PullOptions {
  /** The window, ISO 8601: every measurement reads the same one. */
  from: string
  to: string
  /** Seconds between points. */
  step: number
  /** When the pull ran, ISO 8601: the snapshot's date. */
  fetched: string
  providers: Readonly<Partial<Record<string, Provider>>>
}

/**
 * Reads every measurement and writes the snapshot: the value over the window by its stat (mean by default), the
 * points, and where they came from. What fails is missing, with why; a window with fewer samples than its `min`
 * counts as missing too, and the model then uses the definition's own value.
 */
export async function pull(requests: readonly PullRequest[], o: PullOptions): Promise<Snapshot> {
  const read = await Promise.all(
    requests.map(async (r) => {
      const provider = Object.hasOwn(o.providers, r.provider) ? o.providers[r.provider] : undefined
      const result: ProviderResult = provider
        ? await provider
            .read({ query: r.query, from: o.from, to: o.to, step: o.step })
            // a bug in a provider, not an answer: its name only, since a message may hold an address
            .catch((err: unknown) => ({ error: `${r.provider} failed (${(err as Error)?.name ?? 'error'})` }))
        : { error: `no ${r.provider} is configured` }
      const points = 'points' in result ? result.points : []
      const origin: Origin = {
        provider: r.provider,
        query: r.query,
        ...(r.metric != null && { metric: r.metric }),
        from: o.from,
        to: o.to,
        step: o.step,
        fetched: o.fetched,
        samples: points.length,
        ...(r.min != null && { min: r.min }),
        ...(r.stat != null && { stat: r.stat }),
      }
      const label = r.label != null ? { label: r.label } : {}
      if ('error' in result) return [r.id, { ...label, unit: r.unit, missing: result.error, origin }] as const
      if (!points.length)
        return [r.id, { ...label, unit: r.unit, missing: 'no samples in the window', origin }] as const
      const value = summarize(points, r.stat ?? 'mean')
      return [r.id, { ...label, unit: r.unit, value, series: points, origin }] as const
    }),
  )
  // through the same checks as a file that is read back: a thin window comes out missing, with why
  return parseSnapshot({
    format: 'loadmap-snapshot',
    version: 1,
    fetched: o.fetched,
    from: o.from,
    to: o.to,
    measurements: Object.fromEntries(read),
  })
}
