import { type ElasticsearchOptions, elasticsearch } from './elasticsearch'
import { type PrometheusOptions, prometheus } from './prometheus'
import type { Provider } from './pull'

export { type ElasticsearchOptions, elasticsearch } from './elasticsearch'
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
export function providersFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  /** `only`: the providers to build, so an address set for another one cannot fail this pull. */
  o: { fetch?: typeof fetch; only?: readonly string[] } = {},
): Record<string, Provider> {
  const out: Record<string, Provider> = {}
  const wanted = (id: string) => !o.only || o.only.includes(id)
  const url = env.LOADMAP_PROMETHEUS_URL
  if (url && wanted('prometheus')) {
    const p: PrometheusOptions = { url, ...(o.fetch && { fetch: o.fetch }) }
    if (env.LOADMAP_PROMETHEUS_TOKEN) p.token = env.LOADMAP_PROMETHEUS_TOKEN
    else if (env.LOADMAP_PROMETHEUS_USER) {
      p.user = env.LOADMAP_PROMETHEUS_USER
      p.password = env.LOADMAP_PROMETHEUS_PASSWORD ?? ''
    }
    out.prometheus = prometheus(p)
  }
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

/** What a provider needs to be configured, as a line to print. */
export const PROVIDER_ENV: Readonly<Record<string, string>> = {
  prometheus: 'LOADMAP_PROMETHEUS_URL (and LOADMAP_PROMETHEUS_TOKEN, or LOADMAP_PROMETHEUS_USER and _PASSWORD)',
  elasticsearch:
    'LOADMAP_ELASTICSEARCH_URL (and LOADMAP_ELASTICSEARCH_API_KEY, or LOADMAP_ELASTICSEARCH_USER and _PASSWORD)',
}
