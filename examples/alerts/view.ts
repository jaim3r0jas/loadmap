import { compact } from '@loadmap/core/format'
import { cluster, defineView, edge, node, pool } from '@loadmap/layout'
import { alerts } from './model'

export const view = defineView(alerts, {
  nodes: {
    phones: node({ label: 'Devices', sub: 'alerts and positions' }),
    gateway: node({ label: 'Gateway', stage: 'gateway' }),
    brokers: cluster({
      label: 'Brokers',
      sub: 'two topics, three brokers',
      members: 3,
      stage: ['alertTopic', 'posTopic'],
      memberLabel: (i) => `broker ${i}`,
    }),
    alertPods: pool({
      label: 'Alert pipeline',
      sub: ({ alertPods }) => `${alertPods} pods × 8 · high priority`,
      stage: 'alertPods',
    }),
    posPods: pool({ label: 'Position consumer', sub: ({ posPods }) => `${posPods} pods × 16`, stage: 'posPods' }),
    db: node({ label: 'State store', sub: 'primary', component: 'db', shape: 'cylinder' }),
    push: node({ label: 'Push broker', sub: ({ pushNodes }) => `${pushNodes} nodes`, stage: 'push' }),
    contacts: node({ label: 'Contacts', sub: 'notified', stage: 'contacts' }),
    responders: node({ label: 'Responders', sub: 'on duty', stage: 'responders' }),
    watchers: node({ label: 'Watchers', sub: 'following live', stage: 'watchers' }),
  },
  edges: [
    edge('phones', 'gateway', { label: 'POST /events' }),
    edge('gateway', 'brokers', { label: ({ flows }) => `${compact(flows.positions)} positions/s` }),
    edge('brokers', 'alertPods'),
    edge('brokers', 'posPods'),
    edge('alertPods', 'db', { label: 'state writes' }),
    edge('alertPods', 'push'),
    edge('posPods', 'push', { label: ({ merge }) => (merge ? 'newest per user' : 'every fix') }),
    edge('push', 'contacts'),
    edge('push', 'responders'),
    edge('push', 'watchers', { label: ({ watchOnly }) => (watchOnly ? 'watchers only' : 'every receiver') }),
  ],
  flows: {
    alerts: { from: 'phones', color: 'alt', label: 'alerts' },
    positions: { from: 'phones', color: 'accent', label: 'positions' },
  },
})
