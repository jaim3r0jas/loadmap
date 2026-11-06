// Alerts and positions: two flows on two topics that share three brokers, a pool of pods each, and a push broker
// that fans out to the people who receive them. Made-up names and numbers.
import { defineModel, estimated, fanout, measured, p, pass, queue, sink, workers } from '@loadmap/core'
import { fitLinear } from '@loadmap/core/calibrate'
import cpu from './alert-cpu.json'

// a synthetic series: 0.15 cores + 4 ms per alert, ±4 % noise
export const alertCores = fitLinear(cpu, { x: 'rate', y: 'cores', source: 'synthetic series' })

/** Push packets per position: to watchers only, or to every receiver. */
const perPosition = (watchOnly: boolean) => (watchOnly ? 0.3 : 1.2)

export const alerts = defineModel({
  title: 'Alerts and live positions',
  load: p.load({ label: 'Users, × today', max: 100, default: 10 }),
  params: {
    alertPods: p.select({ label: 'Alert pipeline pods (8 threads each)', options: [2, 3, 4, 6, 8], default: 3 }),
    posPods: p.select({ label: 'Position consumer pods (16 threads each)', options: [2, 3, 4, 6, 8], default: 3 }),
    pushNodes: p.select({ label: 'Push broker nodes', options: [2, 3, 4, 6], default: 3 }),
    merge: p.switch({
      label: 'Keep only the newest position per user',
      hint: 'under backlog a batch saves only the newest fix of each user',
      default: true,
    }),
    watchOnly: p.switch({
      label: 'Push positions only to users watching',
      hint: 'instead of to every receiver',
      default: true,
    }),
  },
  presets: { 'Launch week': { load: 25, posPods: 8, alertPods: 4 } },
  // the walk Play takes: the whole diagram, a close-up on what each step changes, the change, the whole again
  story: [
    {
      text: 'An ordinary peak: the position consumer is already past the 50 % target, and runs out first.',
      title: 'Today at 10×',
    },
    {
      text: 'At 25×, the position consumer is past 100 %: positions wait in their topic, and only the newest per user is kept.',
      set: { load: 25 },
      focus: 'posPods',
    },
    {
      text: 'Launch week runs eight position pods and four alert pods: the consumer is back under 100 %.',
      set: { load: 25, posPods: 8, alertPods: 4 },
      title: 'Launch week: more pods',
    },
    {
      text: 'Pushing every position to every receiver, not only to the users watching, more than triples what the push broker sends: it runs out first now.',
      set: { load: 25, posPods: 8, alertPods: 4, watchOnly: false },
      focus: 'push',
      title: 'Push to every receiver',
    },
  ],
  flows: {
    alerts: { label: 'alerts', unit: 'alert', rate: ({ load }) => 12 * load, priority: 1 },
    positions: {
      label: 'positions',
      unit: 'position',
      rate: ({ load }) => 260 * load,
      priority: 2,
      overload: ({ merge }) => (merge ? { merge: { share: 0.37, reason: 'newest kept' } } : {}),
    },
  },
  components: {
    gateway: {
      name: 'Gateway',
      short: 'the gateway',
      demand: ({ flows }) => flows.alerts + flows.positions,
      capacity: estimated(30_000, 'req/s', 'load test pending'),
      over: 'phones get timeouts, alerts and positions alike',
    },
    brokers: {
      name: 'Brokers',
      short: 'the brokers',
      plural: true,
      demand: ({ flows }) => (flows.alerts * 1.5 + flows.positions * 1.0) / 1000,
      capacity: estimated(20, 'MB/s', 'vendor sizing guide'),
      over: 'produce latency grows on both topics',
      describe: '3 brokers, both topics',
    },
    alertPods: {
      name: 'Alert pipeline',
      short: 'the alert pipeline',
      demand: ({ flows }) => alertCores(flows.alerts),
      capacity: ({ alertPods }) => measured(alertPods * 1, 'cores', 'pod CPU limit'),
      over: 'alerts wait in their topic: the one lag that pages',
      describe: ({ alertPods }) => `${alertPods} pods × 8 threads, 1 core each`,
    },
    posPods: {
      name: 'Position consumer',
      short: 'the position consumer',
      demand: ({ flows }) => flows.positions * 0.0015,
      capacity: ({ posPods }) => measured(posPods * 2, 'cores', 'pod CPU limit'),
      over: 'positions wait in their topic; under backlog only the newest per user is kept',
      describe: ({ posPods }) => `${posPods} pods × 16 threads, 1.5 ms a position`,
    },
    db: {
      name: 'State store',
      short: 'the state store',
      demand: ({ flows }) => flows.alerts * 2,
      capacity: estimated(2000, 'writes/s'),
      over: 'state writes queue on the primary',
    },
    push: {
      name: 'Push broker',
      short: 'the push broker',
      demand: ({ flows, watchOnly }) => flows.alerts * 1.4 + flows.positions * perPosition(watchOnly),
      capacity: ({ pushNodes }) => estimated(pushNodes * 4000, 'packets/s', 'about 4,000 packets/s per node'),
      over: 'pushes queue on the broker, so positions and alert updates arrive late',
    },
  },
  stages: {
    gateway: pass('gateway', { label: 'the gateway' }),
    alertTopic: queue({
      label: 'alerts topic',
      component: 'brokers',
      partitions: ({ alertPods }) => ({ alerts: alertPods * 8 }),
    }),
    posTopic: queue({
      label: 'positions topic',
      component: 'brokers',
      partitions: ({ posPods }) => ({ positions: posPods * 16 }),
    }),
    alertPods: workers('alertPods', { label: 'alert pipeline', pods: ({ alertPods }) => alertPods, perPod: 8 }),
    posPods: workers('posPods', { label: 'position consumer', pods: ({ posPods }) => posPods, perPod: 16 }),
    push: fanout({
      label: 'push broker',
      component: 'push',
      to: ({ watchOnly }) => ({
        alerts: [
          { stage: 'contacts', share: 1 },
          { stage: 'responders', share: 0.4 },
        ],
        positions: [{ stage: 'watchers', share: perPosition(watchOnly) }],
      }),
    }),
    contacts: sink({ label: 'contacts' }),
    responders: sink({ label: 'responders' }),
    watchers: sink({ label: 'watchers' }),
  },
  routes: {
    alerts: ['gateway', 'alertTopic', 'alertPods', 'push'],
    positions: ['gateway', 'posTopic', 'posPods', 'push'],
  },
  calibration: { 'Alert pipeline CPU per alert': alertCores },
})
