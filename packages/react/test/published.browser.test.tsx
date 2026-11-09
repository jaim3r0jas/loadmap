import {
  cluster,
  defineModel,
  defineView,
  edge,
  estimated,
  Loadmap,
  type LoadmapHandle,
  node,
  p,
  pass,
  published,
} from '@loadmap/react'
import { kafka } from '@loadmap/react/catalog'
import { LoadmapSource } from '@loadmap/react/source'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

const brokers = (count: number) =>
  defineModel({
    title: 'Events',
    load: p.load({ max: 20 }),
    params: { brokers: p.select({ label: 'Brokers', options: [3, 6] as number[], default: count }) },
    flows: { events: { rate: ({ load }) => 150 * load } },
    components: {
      brokers: {
        name: 'Brokers',
        short: 'the brokers',
        plural: true,
        demand: ({ flows }) => flows.events,
        capacity: ({ brokers }) =>
          published(kafka, { brokers, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4, version: '4.4' }),
        over: 'producers wait',
      },
      consumers: {
        name: 'Consumers',
        short: 'the consumers',
        plural: true,
        demand: ({ flows }) => flows.events,
        capacity: estimated(1200, 'MB/s', { within: 0.2 }),
        over: 'a backlog grows',
      },
    },
    stages: { brokers: pass('brokers'), consumers: pass('consumers') },
    routes: { events: ['brokers', 'consumers'] },
  })

const viewOf = (m: ReturnType<typeof brokers>) =>
  defineView(m, {
    nodes: {
      producers: node({ label: 'Producers' }),
      brokers: cluster({ label: 'Brokers', sub: 'Apache Kafka', members: 3, stage: 'brokers' }),
      consumers: node({ label: 'Consumers', stage: 'consumers' }),
    },
    edges: [edge('producers', 'brokers'), edge('brokers', 'consumers')],
    flows: { events: { from: 'producers', color: 'accent' } },
  })

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(count: number) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  const m = brokers(count)
  root = createRoot(host)
  root.render(<Loadmap ref={ref} model={m} view={viewOf(m)} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return host
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('a published capacity', () => {
  it('is tagged, named in the verdict, and its source linked in the assumptions', async () => {
    const el = await mount(3)
    expect(el.querySelector('.lm-verdict')?.textContent).toContain('(capacity published, a best case)')
    const row = el.querySelector('.lm-lim[data-component="brokers"]')!
    expect(row.querySelector('.lm-tag[data-kind="published"]')?.textContent).toBe('published')
    const facts = [...el.querySelectorAll('.lm-facts li')].map((li) => li.textContent ?? '')
    const line = facts.find((t) => t.startsWith('Brokers:'))!
    expect(line).toContain('605 MB/s')
    expect(line).toContain('3 brokers; replication factor 3; acks all; message size 1 KB; 4 producers')
    expect(line).toContain('Apache Kafka 2.6, you run 4.4')
    expect(line).toContain('not a measurement of this system')
    const a = el.querySelector<HTMLAnchorElement>('.lm-facts a')!
    expect(a.href).toBe('https://www.confluent.io/blog/kafka-fastest-messaging-system/')
    expect(a.rel).toBe('noopener noreferrer')
  })

  it('says when there is no published benchmark, and leaves the component unranked', async () => {
    const el = await mount(6)
    expect(el.querySelector('.lm-verdict')?.textContent).toContain(
      'The brokers have no published benchmark for 6 brokers: the published runs use 3 brokers, so they are not ranked.',
    )
    const row = el.querySelector('.lm-lim[data-component="brokers"]')!
    expect(row.querySelector('.lm-tag[data-kind="none"]')?.textContent).toBe('no published benchmark')
    expect(row.textContent).toContain('No published benchmark for 6 brokers')
    // the consumers are the first limit now
    expect(
      el.querySelector('.lm-lim .lm-tag[data-kind="first"]')?.closest('.lm-lim')?.getAttribute('data-component'),
    ).toBe('consumers')
  })
})

const SOURCE = `loadmap 1
title: "Events"
load { max: 20 }
param brokers "Brokers" { options: [3, 6]; default: 6 }

published brokersRef kafka {
  edition: "2026-11"
  brokers: brokers
  replication: 3
  acks: "all"
  messageSize: "1 KB"
  producers: 4
}

flow events "events" { unit: "MB"; from: producers; rate: 150 * load; route: kafka }

node producers "Producers"
cluster kafka "Brokers" {
  members: brokers
  queue topic { partitions { events: 12 } }
  short: "the brokers"
  plural: true
  demand: flows.events
  capacity: brokersRef
  over: "producers wait"
}

producers -> kafka
`

describe('a .loadmap with a published statement', () => {
  it('loads the catalog, then draws it, saying when no published run matches', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE} />)
    await expect
      .poll(() => host!.querySelector('.lm-verdict')?.textContent, { timeout: 5000 })
      .toContain('The brokers have no published benchmark for 6 brokers')
    // never the error of a catalog not yet loaded
    expect(host.querySelector('.lm-problems')).toBeNull()
  })
})
