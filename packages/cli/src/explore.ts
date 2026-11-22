import { parseArgs } from 'node:util'
import { type Explorer, explorersFromEnv, runExplore } from '@loadmap/providers'

export interface ExploreCommandOptions {
  log?: (s: string) => void
  env?: Readonly<Record<string, string | undefined>>
  /** For tests: the store, instead of the one the environment names. */
  explorer?: Explorer
  now?: () => Date
}

const USAGE = 'loadmap explore (search <words> | labels <metric> | try <query>) [--window 1h] [--provider prometheus]'

/**
 * `loadmap explore`: what a metrics store has, read only, as an assistant reads it: the metrics that match some
 * words, a metric's labels, or what a query gives over a window. The store is the one `loadmap pull` reads
 * (`LOADMAP_PROMETHEUS_URL` and its credentials); nothing it prints names the address.
 */
export async function explore(argv: string[], o: ExploreCommandOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let tool: string
  let arg: string
  let window: string | undefined
  let provider: string
  try {
    const p = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { window: { type: 'string' }, provider: { type: 'string' } },
    })
    tool = p.positionals[0] ?? ''
    arg = p.positionals.slice(1).join(' ').trim()
    window = p.values.window
    provider = p.values.provider ?? 'prometheus'
    if (!['search', 'labels', 'try'].includes(tool) || !arg) throw new Error(USAGE)
    if (window && !/^\d+[mhd]$/.test(window)) throw new Error('--window is minutes, hours or days: 30m, 6h, 1d')
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  const explorer = o.explorer ?? explorersFromEnv(o.env ?? process.env)[provider]
  if (!explorer) {
    log(`loadmap explore: no ${provider} to read: set LOADMAP_PROMETHEUS_URL (and its token or user)`)
    return 2
  }
  const text = await runExplore(explorer, [{ tool: tool as 'search', arg, ...(window && { window }) }], {
    now: o.now?.() ?? new Date(),
  })
  // what the store answered, a refusal too: a refusal is an answer the reader reads
  log(text)
  return 0
}
