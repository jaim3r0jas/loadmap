import { type PrometheusOptions, prometheus } from './prometheus'
import type { Provider } from './pull'

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
 * The providers the environment configures: `LOADMAP_PROMETHEUS_URL`, with `LOADMAP_PROMETHEUS_TOKEN` or
 * `LOADMAP_PROMETHEUS_USER` and `LOADMAP_PROMETHEUS_PASSWORD`. A definition never names an address or a credential.
 */
export function providersFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  o: { fetch?: typeof fetch } = {},
): Record<string, Provider> {
  const out: Record<string, Provider> = {}
  const url = env.LOADMAP_PROMETHEUS_URL
  if (url) {
    const p: PrometheusOptions = { url, ...(o.fetch && { fetch: o.fetch }) }
    if (env.LOADMAP_PROMETHEUS_TOKEN) p.token = env.LOADMAP_PROMETHEUS_TOKEN
    else if (env.LOADMAP_PROMETHEUS_USER) {
      p.user = env.LOADMAP_PROMETHEUS_USER
      p.password = env.LOADMAP_PROMETHEUS_PASSWORD ?? ''
    }
    out.prometheus = prometheus(p)
  }
  return out
}

/** What a provider needs to be configured, as a line to print. */
export const PROVIDER_ENV: Readonly<Record<string, string>> = {
  prometheus: 'LOADMAP_PROMETHEUS_URL (and LOADMAP_PROMETHEUS_TOKEN, or LOADMAP_PROMETHEUS_USER and _PASSWORD)',
}
