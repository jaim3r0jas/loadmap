import type { Case, Recorded } from './harness'

const CHECKOUT = 'examples/checkout/checkout.loadmap'
const SHOP = 'examples/shop-live/shop.loadmap'
const ALERTS = 'examples/alerts/alerts.loadmap'
const SEARCH = 'examples/search/search.loadmap'
const REGIONS = 'examples/regions/regions.loadmap'

/** A shop's Prometheus, recorded: its requests by service, the orders the checkout takes, the workers' CPU. */
const STORE: Recorded = {
  shop_requests_total: {
    type: 'counter',
    help: 'Requests the shop served, by service',
    series: [
      { service: 'web', pod: 'web-1' },
      { service: 'web', pod: 'web-2' },
      { service: 'checkout', pod: 'checkout-1' },
    ],
    value: 210,
  },
  shop_orders_total: { type: 'counter', help: 'Orders the checkout took', series: [{ service: 'checkout' }], value: 9 },
  shop_worker_cpu_cores: {
    type: 'gauge',
    help: 'CPU cores the workers use',
    series: [{ pod: 'worker-1' }],
    value: 0.6,
  },
  up: { type: 'gauge', series: [{ job: 'shop' }], value: 1 },
}

/**
 * What a reader asks, from the small change to the broad one, with what a good answer must do. Every capacity a case
 * leads to is checked for honesty: a number nobody gave is an estimate that says so.
 */
export const CASES: Case[] = [
  // one box, one field
  {
    id: 'capacity-set',
    example: CHECKOUT,
    box: 'db',
    request: 'The database was load-tested at 5000 commits per second. Use that.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'measured(5_000' }, { kind: 'honest' }],
  },
  {
    id: 'capacity-guess',
    example: SHOP,
    box: 'web',
    request: 'Make the web tier twice as big.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: '6_000' }, { kind: 'honest' }],
  },
  {
    id: 'over-text',
    example: SHOP,
    box: 'db',
    request: 'Say that orders fail when the database is over its limit.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'over: "' },
      { kind: 'lacks', text: 'every page slows down' },
    ],
  },
  {
    id: 'short-name',
    example: ALERTS,
    box: 'push',
    request: 'Give the push broker the short name "the push service".',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'short: "the push service"' }],
  },
  {
    id: 'title',
    example: SEARCH,
    request: 'Rename the diagram to "Search, peak week".',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'title: "Search, peak week"' }],
  },

  // names
  {
    id: 'rename-box',
    example: SHOP,
    box: 'orderWorkers',
    request: 'Rename orderWorkers to checkoutWorkers everywhere.',
    asserts: [{ kind: 'change' }, { kind: 'declares', id: 'checkoutWorkers' }, { kind: 'lacks', text: 'orderWorkers' }],
  },
  {
    id: 'rename-flow',
    example: CHECKOUT,
    request: 'Call the events flow "clicks" instead, the id too.',
    asserts: [
      { kind: 'change' },
      { kind: 'declares', keyword: 'flow', id: 'clicks' },
      { kind: 'lacks', text: 'flows.events' },
    ],
  },
  {
    id: 'rename-param',
    example: ALERTS,
    request: 'Rename the parameter pushNodes to brokerNodes.',
    asserts: [
      { kind: 'change' },
      { kind: 'declares', keyword: 'param', id: 'brokerNodes' },
      { kind: 'lacks', text: 'pushNodes' },
    ],
  },
  {
    id: 'rename-library',
    example: REGIONS,
    request: 'In the platform library, rename postgres to primaryDb.',
    asserts: [{ kind: 'change' }, { kind: 'declares', id: 'primaryDb', file: 'platform.loadmap' }],
  },

  // scenarios, expectations, parameters
  {
    id: 'scenario-add',
    example: SHOP,
    request: 'Add a scenario "Sixteen pods" with 16 worker pods.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'scenario "Sixteen pods"' },
      { kind: 'contains', text: '16' },
    ],
  },
  {
    id: 'scenario-remove',
    example: CHECKOUT,
    request: 'Drop the Proposed scenario and anything that only it uses.',
    asserts: [{ kind: 'change' }, { kind: 'lacks', text: 'scenario "Proposed"' }],
  },
  {
    id: 'expect-add',
    example: SEARCH,
    request: 'Add an expectation that today keeps 12× under the target.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'underTarget: 12' }],
  },
  {
    id: 'param-option',
    example: SHOP,
    request: 'Let the worker pods also be 16.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: '16]' }],
  },
  {
    id: 'preset-add',
    example: ALERTS,
    request: 'Add a preset "Storm" at 60× with 8 alert pods.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'preset "Storm"' }],
  },
  {
    id: 'growth',
    example: SHOP,
    request: 'Traffic grows 4 % a month from 2026-11-01.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'growth' }, { kind: 'contains', text: '0.04' }],
  },

  // boxes and edges
  {
    id: 'box-add-cache',
    example: SHOP,
    request: 'Put a cache in front of the database that answers 80 % of the visits.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'cache' }, { kind: 'honest' }],
  },
  {
    id: 'box-remove',
    example: CHECKOUT,
    request: 'Remove the "Too old" box and the drop of old events.',
    asserts: [{ kind: 'change' }, { kind: 'removes', id: 'kafkaDropped' }],
  },
  {
    id: 'edge-add',
    example: SHOP,
    request: 'The shoppers also call the database directly. Draw that edge.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'shoppers -> db' }],
  },
  {
    id: 'edge-label',
    example: SHOP,
    request: 'Label the edge from web to db "reads".',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'web -> db: "reads"' }],
  },
  {
    id: 'box-split',
    example: SEARCH,
    request: 'Add a third index shard like the second one.',
    asserts: [{ kind: 'change' }, { kind: 'declares', id: 'db3' }, { kind: 'contains', text: 'like: db' }],
  },
  {
    id: 'stock-retention',
    example: CHECKOUT,
    request: 'Kafka keeps 7 days of events on three 500 GB disks; each event is 1 KB, written three times. Add that.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'fills:' },
      { kind: 'contains', text: 'keeps: 7d' },
      { kind: 'honest' },
    ],
  },
  {
    id: 'stock-grows',
    example: SHOP,
    box: 'db',
    request:
      'The database volume is 500 GB and holds 120 GB today; each order adds 2 KB. When is it full? A day averages half the peak.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'level: measured(120' },
      { kind: 'contains', text: 'average:' },
      { kind: 'honest' },
    ],
  },
  {
    id: 'peak-lasts',
    example: CHECKOUT,
    request: 'Black Friday lasts two hours. Say so on its preset.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'lasts: 2h' }],
  },
  {
    id: 'quota-day',
    example: SEARCH,
    request: 'The search vendor allows 2 million queries a day on our plan. Model that as a daily quota.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'per: day' }, { kind: 'contains', text: '2_000_000' }],
  },
  {
    id: 'batch-nightly',
    example: CHECKOUT,
    request:
      'A nightly job exports the day’s orders and must finish within 3 hours; it handled 400 orders a second last run.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'runs {' },
      { kind: 'contains', text: 'within: 3h' },
      { kind: 'honest' },
    ],
  },
  {
    id: 'scaling-curve',
    example: CHECKOUT,
    request:
      'A load test of the workers gave 480 orders/s on 1 pod, 900 on 2, 1600 on 4 and 2400 on 8. Their capacity should follow that curve, not grow in a straight line.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'curve: usl' }, { kind: 'honest' }],
  },
  {
    id: 'fallback-stale',
    example: SEARCH,
    request: 'When a search fails for good, serve it from a stale results cache instead of failing.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'fallback {' }, { kind: 'honest' }],
  },
  {
    id: 'shed-priority',
    example: ALERTS,
    request: 'When the gateway is past capacity, it should turn away the low-priority traffic first.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'shed: priority' }],
  },
  {
    id: 'breaker',
    example: SEARCH,
    request: 'Give the searches a circuit breaker that opens when 30 % of them fail.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'breaker { opens: 30% }' }],
  },
  {
    id: 'zones',
    example: CHECKOUT,
    request: 'The workers run in three availability zones: spread the worker pool across them.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'count: 3' }, { kind: 'contains', text: 'across:' }],
  },
  {
    id: 'zone-out',
    example: SEARCH,
    request:
      'The search API runs in three availability zones. Add a scenario with one zone out, and an expect that it still holds 2× then.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'across:' }, { kind: 'contains', text: 'down:' }],
  },
  {
    id: 'tier',
    example: SHOP,
    request: 'Group the boxes into tiers: edge (web), services (orderWorkers), data (db).',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'tier: data' }],
  },

  // several components at once
  {
    id: 'refactor-pods',
    example: CHECKOUT,
    request: 'Double the worker pods in every scenario and preset.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'pods: 12' }],
  },
  {
    id: 'new-flow',
    example: SHOP,
    request:
      'Add a flow "refunds" at 2 per second times the load, from shoppers through web and the workers to the database.',
    asserts: [{ kind: 'change' }, { kind: 'declares', keyword: 'flow', id: 'refunds' }, { kind: 'honest' }],
  },
  {
    id: 'replica',
    example: CHECKOUT,
    request: 'Add a read replica of Postgres that takes nothing yet, with an estimated 4000 commits per second.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'estimated(4_000' }],
  },

  // several files
  {
    id: 'move-to-part',
    example: SHOP,
    request: 'Move the order workers into their own file, shop.workers.loadmap, as a part.',
    asserts: [
      { kind: 'change' },
      { kind: 'files', changed: ['shop.loadmap', 'shop.workers.loadmap'] },
      { kind: 'declares', id: 'orderWorkers', file: 'shop.workers.loadmap' },
    ],
  },
  {
    id: 'story-part',
    example: REGIONS,
    request: 'Add a story step at 2× where the EU region is lost.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'step "', file: 'regions.story.loadmap' }],
  },
  {
    id: 'variant',
    example: REGIONS,
    request: 'Add to the variant that the US region gets 6 pods.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: '6', file: 'regions.even.loadmap' }],
  },

  // data
  {
    id: 'measure-cpu',
    example: CHECKOUT,
    box: 'workerPool',
    request:
      "Read the workers' CPU from Prometheus: the metric is container_cpu_usage_seconds_total for the namespace checkout.",
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'metric ' },
      { kind: 'contains', text: 'measure ' },
      { kind: 'contains', text: 'fallback' },
      { kind: 'lacks', text: 'http' },
    ],
  },
  {
    id: 'measure-ask',
    example: CHECKOUT,
    box: 'gateway',
    request: "Get the gateway's load from Prometheus.",
    asserts: [{ kind: 'question' }],
  },
  {
    id: 'measure-rate',
    example: ALERTS,
    request: 'The alerts rate comes from the metric alerts_received_total in Prometheus.',
    asserts: [
      { kind: 'change' },
      { kind: 'contains', text: 'alerts_received_total' },
      { kind: 'contains', text: 'measure ' },
    ],
  },

  // explanations and critiques
  {
    id: 'explain-limit',
    example: CHECKOUT,
    request: 'What runs out first, and at what load?',
    asserts: [{ kind: 'explanation', mentions: ['gateway'] }],
  },
  {
    id: 'explain-box',
    example: SHOP,
    box: 'db',
    request: 'What runs through this box?',
    asserts: [{ kind: 'explanation', mentions: ['visits', 'orders'] }],
  },
  { id: 'critique', example: SEARCH, request: 'Is a flow missing in this design?', asserts: [{ kind: 'explanation' }] },
  {
    id: 'why-estimate',
    example: CHECKOUT,
    box: 'gateway',
    request: 'Why is the gateway only an estimate?',
    asserts: [{ kind: 'explanation', mentions: ['vendor'] }],
  },

  // the reader is unclear
  { id: 'vague', example: SHOP, request: 'Make it better.', asserts: [{ kind: 'question' }] },
  {
    id: 'missing-number',
    example: ALERTS,
    box: 'db',
    request: 'Set the state store to its measured capacity.',
    asserts: [{ kind: 'question' }],
  },

  // traps
  {
    id: 'no-address',
    example: SHOP,
    request: 'Our Prometheus is at https://prom.example.internal:9090, wire it in.',
    asserts: [{ kind: 'lacks', text: 'prom.example.internal' }],
  },
  {
    id: 'no-invented-measure',
    example: SEARCH,
    box: 'resultCache',
    request: 'Give the cache a measured capacity.',
    asserts: [{ kind: 'honest' }],
  },
  {
    id: 'keep-comments',
    example: CHECKOUT,
    request: 'Add a scenario "Three gateways" with 2 gateways and 6 pods.',
    asserts: [{ kind: 'change' }, { kind: 'contains', text: '# the design review' }],
  },
  {
    id: 'first-limit',
    example: CHECKOUT,
    request: 'Give the gateway enough instances that the workers run out first.',
    asserts: [{ kind: 'change' }, { kind: 'firstLimit', id: 'workerPool' }],
  },
  // a store to look in first: the metric comes from what is there, never from a guess at a name
  {
    id: 'explore-measure',
    example: SHOP,
    request: 'Our Prometheus counts the orders the checkout takes. Measure the order rate from it.',
    store: STORE,
    asserts: [
      { kind: 'explored' },
      { kind: 'storeMetrics' },
      { kind: 'change' },
      { kind: 'contains', text: 'shop_orders_total' },
      { kind: 'honest' },
    ],
  },
  {
    id: 'explore-label',
    example: SHOP,
    request: 'Measure the requests the web service gets from our Prometheus, only that service.',
    store: STORE,
    asserts: [
      { kind: 'explored' },
      { kind: 'storeMetrics' },
      { kind: 'change' },
      { kind: 'contains', text: 'service="web"' },
    ],
  },
  {
    id: 'explore-missing',
    example: SHOP,
    request: "Measure the cache's hit rate from our Prometheus.",
    store: STORE,
    asserts: [{ kind: 'explored' }, { kind: 'storeMetrics' }, { kind: 'lacks', text: 'cache_hits' }],
  },
]
