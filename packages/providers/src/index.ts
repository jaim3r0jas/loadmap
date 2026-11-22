import { type ElasticsearchOptions, elasticsearch } from './elasticsearch'
import { type Explorer, prometheusExplorer } from './explore'
import { type PrometheusOptions, prometheus } from './prometheus'
import type { Provider } from './pull'

export { type ElasticsearchOptions, elasticsearch } from './elasticsearch'
export {
  EXPLORE_LIMITS,
  type ExploreCall,
  type Explorer,
  type LabelInfo,
  type MetricInfo,
  prometheusExplorer,
  runExplore,
  type TryResult,
  type Window,
} from './explore'
export { type PrometheusOptions, prometheus } from './prometheus'
export {
  type Provider,
  type ProviderQuery,
  type ProviderResult,
  type PullOptions,
  type PullRequest,
  pull,
} from './pull'

/**
 * The providers the environment configures: `LOADMAP_PROMETHEUS_URL`, with `LOADMAP_PROMETHEUS_TOKEN` or a user and
 * password; `LOADMAP_ELASTICSEARCH_URL`, with `LOADMAP_ELASTICSEARCH_API_KEY` or a user and password. A definition
 * never names an address or a credential.
 */
/** The Prometheus the environment names, with its credentials: what pull and explore both read. */
function prometheusFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  f?: typeof fetch,
): PrometheusOptions | undefined {
  const url = env.LOADMAP_PROMETHEUS_URL
  if (!url) return undefined
  const p: PrometheusOptions = { url, ...(f && { fetch: f }) }
  if (env.LOADMAP_PROMETHEUS_TOKEN) p.token = env.LOADMAP_PROMETHEUS_TOKEN
  else if (env.LOADMAP_PROMETHEUS_USER) {
    p.user = env.LOADMAP_PROMETHEUS_USER
    p.password = env.LOADMAP_PROMETHEUS_PASSWORD ?? ''
  }
  return p
}

export function providersFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  /** `only`: the providers to build, so an address set for another one cannot fail this pull. */
  o: { fetch?: typeof fetch; only?: readonly string[] } = {},
): Record<string, Provider> {
  const out: Record<string, Provider> = {}
  const wanted = (id: string) => !o.only || o.only.includes(id)
  const p = prometheusFromEnv(env, o.fetch)
  if (p && wanted('prometheus')) out.prometheus = prometheus(p)
  const es = env.LOADMAP_ELASTICSEARCH_URL
  if (es && wanted('elasticsearch')) {
    const e: ElasticsearchOptions = { url: es, ...(o.fetch && { fetch: o.fetch }) }
    if (env.LOADMAP_ELASTICSEARCH_API_KEY) e.apiKey = env.LOADMAP_ELASTICSEARCH_API_KEY
    else if (env.LOADMAP_ELASTICSEARCH_USER) {
      e.user = env.LOADMAP_ELASTICSEARCH_USER
      e.password = env.LOADMAP_ELASTICSEARCH_PASSWORD ?? ''
    }
    out.elasticsearch = elasticsearch(e)
  }
  return out
}

/**
 * The stores the environment configures that can say what they hold, for an assistant to look in: Prometheus (the
 * same address and credentials `loadmap pull` reads). Read only.
 */
export function explorersFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  o: { fetch?: typeof fetch } = {},
): Record<string, Explorer> {
  const p = prometheusFromEnv(env, o.fetch)
  return p ? { prometheus: prometheusExplorer(p) } : {}
}

/** What a provider needs to be configured, as a line to print. */
export const PROVIDER_ENV: Readonly<Record<string, string>> = {
  prometheus: 'LOADMAP_PROMETHEUS_URL (and LOADMAP_PROMETHEUS_TOKEN, or LOADMAP_PROMETHEUS_USER and _PASSWORD)',
  elasticsearch:
    'LOADMAP_ELASTICSEARCH_URL (and LOADMAP_ELASTICSEARCH_API_KEY, or LOADMAP_ELASTICSEARCH_USER and _PASSWORD)',
}
