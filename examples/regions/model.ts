// Two regions, each sized for its own users: pure TypeScript, tested in Vitest without a browser. The language writes a
// region once, as a subsystem of a library, and each region takes it with its own sizes (region.loadmap); here a
// function does the same, and the ids say where each part stands (`eu.orders.workers`: the workers of the EU region's
// orders), as the language names them.
import {
  type ComponentDef,
  type Dyn,
  defineModel,
  estimated,
  measured,
  p,
  pass,
  queue,
  type StageDef,
  store,
  workers,
} from '@loadmap/core'

type Ctx = { flows: Record<string, number>; usPods: number }
type Size = { pods: number | ((c: Ctx) => number); apiPods: number; dbLimit: number }
/** A region's parts, by the ids the language gives them. */
type Parts<R extends string> = `${R}.lb` | `${R}.api` | `${R}.orders.workers` | `${R}.db`

/** What one order costs a worker, measured once for every team. */
const ORDER_COST = 0.002

/**
 * One region's components and stages: a load balancer, the API, the line that takes orders and the database. `main`
 * is its own orders, `spill` those of a region that is lost.
 */
function region<const R extends string>(id: R, label: string, main: string, spill: string, size: Size) {
  const both = ({ flows }: Ctx) => flows[main]! + flows[spill]!
  const pods = size.pods
  const named = (name: string, short: string) => ({ name: `${label} › ${name}`, short: `${short} in ${label}` })
  return {
    components: {
      [`${id}.lb`]: {
        ...named('Load balancer', 'the load balancer'),
        demand: both,
        capacity: estimated(20_000, 'req/s', { source: 'vendor sizing guide', within: 0.3 }),
        over: 'requests are refused at the door',
      },
      [`${id}.api`]: {
        ...named('API', 'the API'),
        demand: (c: Ctx) => both(c) * 0.004,
        capacity: measured(size.apiPods, 'cores', 'pod CPU limit'),
        over: 'requests queue in the API',
      },
      [`${id}.orders.workers`]: {
        ...named('Workers', 'the workers'),
        demand: (c: Ctx) => both(c) * ORDER_COST,
        capacity:
          typeof pods === 'number'
            ? measured(pods, 'cores', 'pod CPU limit')
            : (c: Ctx) => measured(pods(c), 'cores', 'pod CPU limit'),
        over: 'orders wait in the topic',
      },
      [`${id}.db`]: {
        ...named('Postgres', 'the database'),
        demand: both,
        capacity: estimated(size.dbLimit, 'commits/s', { source: 'load test of the primary', within: 0.3 }),
        over: 'commits queue on the primary',
      },
    } as Record<Parts<R>, ComponentDef<any>>,
    stages: {
      [`${id}.lb`]: pass(`${id}.lb`),
      [`${id}.api`]: workers(`${id}.api`, { pods: size.apiPods, perPod: 16 }),
      [`${id}.orders.topic`]: queue({ partitions: { [main]: 12, [spill]: 12 } }),
      [`${id}.orders.workers`]: workers(`${id}.orders.workers`, { pods: pods as Dyn<number>, perPod: 8 }),
      [`${id}.db`]: store(`${id}.db`),
    } as Record<Parts<R> | `${R}.orders.topic`, StageDef<Parts<R>>>,
    route: ['router', `${id}.lb`, `${id}.api`, `${id}.orders.topic`, `${id}.orders.workers`, `${id}.db`] as const,
  }
}

const eu = region('eu', 'EU region', 'eu', 'usInEu', { pods: 4, apiPods: 10, dbLimit: 6_000 })
const us = region('us', 'US region', 'us', 'euInUs', { pods: ({ usPods }) => usPods, apiPods: 8, dbLimit: 4_000 })

export const regions = defineModel({
  title: 'Two regions',
  load: p.load({ label: 'Users, × today', max: 10, default: 1 }),
  params: {
    euLost: p.switch({ label: 'Lose the EU region', default: false }),
    usLost: p.switch({ label: 'Lose the US region', default: false }),
    usPods: p.select({ label: 'US order workers (pods)', options: [2, 3, 4], default: 2 }),
  },
  scenarios: {
    Today: {},
    'EU lost': { euLost: true },
    'US lost': { usLost: true },
    'EU lost, four US pods': { euLost: true, usPods: 4 },
  },
  expect: [
    { label: 'Today keeps 2×', underTarget: 2 },
    { label: 'With the US lost, the EU keeps 1.5×', scenario: 'US lost', underTarget: 1.5 },
    {
      label: 'With the EU lost and four US pods, the US keeps 1.5×',
      scenario: 'EU lost, four US pods',
      underTarget: 1.5,
    },
  ],
  // each step says which regions it shows closed, each as one box: the overview first, then into the one that runs out
  story: [
    {
      text: 'An ordinary peak, each region closed into one box: each says how busy the busiest part in it is.',
      title: 'Today, at a glance',
      closed: ['eu', 'us'],
    },
    {
      text: 'The EU region is lost: every order goes to the US, and the US region wears the limit at 1×: today.',
      title: 'The EU region lost',
      closed: ['eu', 'us'],
      set: { euLost: true },
    },
    {
      text: 'Open the US region: its order workers run out first, at their target already.',
      title: 'Inside the US region',
      focus: 'us.orders.workers',
      closed: ['eu'],
      set: { euLost: true },
    },
    {
      text: 'Twice the order workers in the US, and losing the EU region holds again.',
      title: 'Proposed: four pods',
      focus: 'us.orders.workers',
      closed: ['eu'],
      set: { euLost: true, usPods: 4 },
    },
  ],
  flows: {
    eu: { label: 'EU orders', rate: ({ load, euLost }) => (euLost ? 0 : 300 * load) },
    euInUs: { label: 'EU orders in the US', rate: ({ load, euLost }) => (euLost ? 300 * load : 0) },
    us: { label: 'US orders', rate: ({ load, usLost }) => (usLost ? 0 : 200 * load) },
    usInEu: { label: 'US orders in the EU', rate: ({ load, usLost }) => (usLost ? 200 * load : 0) },
  },
  components: {
    router: {
      name: 'Traffic router',
      short: 'the traffic router',
      capacity: estimated(50_000, 'req/s', 'vendor sizing guide'),
      over: 'users get timeouts',
    },
    ...eu.components,
    ...us.components,
  },
  stages: { router: pass('router'), ...eu.stages, ...us.stages },
  routes: { eu: eu.route, euInUs: us.route, us: us.route, usInEu: eu.route },
})
