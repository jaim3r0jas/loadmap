// Product search: a rate limiter, an autoscaled API, a cache and clients that retry, the four building blocks in one
// system, and an index of two shards behind a coordinator that sends each miss to one. Made-up names and numbers.
import { cache, configured, defineModel, estimated, limit, measured, p, split, store, workers } from '@loadmap/core'

export const search = defineModel({
  title: 'Product search',
  load: p.load({ label: 'Searches, × today', max: 50, default: 4 }),
  params: {
    limit: p.select({
      label: 'Rate limit',
      options: [6_000, 12_000],
      default: 6_000,
      format: (v) => `${Number(v) / 1000}k req/s`,
    }),
    maxPods: p.select({ label: 'Most API pods', options: [8, 16], default: 8 }),
    hit: p.select({
      label: 'Cache hits',
      options: [0.9, 0.6, 0.3],
      default: 0.9,
      format: (v) => `${Number(v) * 100} %`,
    }),
    retries: p.select({ label: 'Client retries', options: [0, 3], default: 3 }),
    budget: p.switch({
      label: 'A retry budget of 10 %',
      hint: 'retries add at most a tenth of the searches',
      default: false,
    }),
  },
  presets: { 'Cold cache': { hit: 0.3 } },
  scenarios: { Today: {}, Proposed: { limit: 12_000, maxPods: 16, budget: true } },
  growth: { rate: 0.05, per: 'month', asOf: '2026-11-01' },
  expect: [
    { label: 'Today keeps 10×', target: 10 },
    { label: 'Proposed keeps 20×', scenario: 'Proposed', target: 20 },
  ],
  story: [
    {
      text: 'An ordinary peak: the API runs a few pods, and the cache answers nine searches in ten.',
      title: 'An ordinary peak',
    },
    {
      text: 'A cold cache answers three in ten: the misses reach the search index, the first limit now.',
      set: { hit: 0.3 },
      focus: 'db',
      title: 'A cold cache',
    },
    {
      text: 'At 30×, the limiter turns searches away, and every client tries three more times: the attempts multiply.',
      set: { load: 30 },
      focus: 'limiter',
    },
    {
      text: 'The proposal doubles the limit and the pods, and caps the retries at a tenth: at 30× nothing is turned away.',
      scenario: 'Proposed',
      set: { load: 30 },
      focus: 'api',
    },
  ],
  flows: {
    searches: {
      label: 'searches',
      unit: 'search',
      rate: ({ load }) => 300 * load,
      // without the budget, at most three retries a search: never more than 300 %
      retry: ({ retries, budget }) => ({ times: Number(retries), budget: budget ? 0.1 : 3 }),
    },
  },
  components: {
    limiter: {
      name: 'Rate limiter',
      short: 'the rate limiter',
      capacity: ({ limit }) => configured(limit, 'req/s', 'gateway config'),
      over: 'searches above the limit get 429s, and come back as retries',
    },
    api: {
      name: 'Search API',
      short: 'the search API',
      demand: ({ at }) => at.api.searches * 0.001,
      capacity: ({ maxPods }) => measured(maxPods * 1, 'cores', '1 core a pod'),
      over: 'the pool is at its most pods, and searches queue',
    },
    cache: {
      name: 'Cache',
      short: 'the cache',
      capacity: estimated(40_000, 'ops/s', 'vendor sizing'),
      over: 'lookups time out and fall through',
    },
    db: {
      name: 'Index shard 1',
      short: 'the first shard',
      capacity: estimated(1_000, 'queries/s', { source: 'a load test of one shard', within: 0.3 }),
      over: 'queries queue, and the API waits on them',
    },
    db2: {
      name: 'Index shard 2',
      short: 'the second shard',
      capacity: estimated(1_000, 'queries/s', { source: 'a load test of one shard', within: 0.3 }),
      over: 'queries queue, and the API waits on them',
    },
  },
  stages: {
    limiter: limit('limiter'),
    api: workers('api', { perPod: 4, autoscale: { min: 2, max: ({ maxPods }) => maxPods, target: 0.7 } }),
    cache: cache({ hit: ({ hit }) => hit, component: 'cache' }),
    // each miss goes to one shard: half to each
    shards: split({
      to: [
        { stages: ['db'], share: 0.5 },
        { stages: ['db2'], share: 0.5 },
      ],
    }),
    db: store('db'),
    db2: store('db2'),
  },
  routes: { searches: ['limiter', 'api', 'cache', 'shards'] },
})
