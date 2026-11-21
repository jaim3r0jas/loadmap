import type { Case } from './harness'

const CHECKOUT = 'examples/checkout/checkout.loadmap'
const SHOP = 'examples/shop-live/shop.loadmap'
const ALERTS = 'examples/alerts/alerts.loadmap'
const SEARCH = 'examples/search/search.loadmap'
const REGIONS = 'examples/regions/regions.loadmap'

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
    asserts: [{ kind: 'change' }, { kind: 'contains', text: 'like: db' }, { kind: 'declares', id: 'db3' }],
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
]
