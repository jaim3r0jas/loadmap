// The examples page: the walkthroughs, a card each that leads to its page, and the starters (the editor's templates),
// a card each with the picked one drawn below. Every card lists what its model shows, read from the model; the
// starters and the walkthroughs grown from them link to each other.
import { compile } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
import { TEMPLATES } from '@loadmap/editor/templates'
import { alertsSource } from '@loadmap/example-alerts'
import { checkoutSource } from '@loadmap/example-checkout'
import { searchSource } from '@loadmap/example-search'
import { Loadmap } from '@loadmap/react'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { features } from '../features'
import { Actions } from './actions'

interface Walkthrough {
  id: string
  title: string
  summary: string
  source: string
  /** The starters it is grown from: the one hand-kept list of the page. */
  from: readonly string[]
}

const WALKTHROUGHS: readonly Walkthrough[] = [
  {
    id: 'checkout',
    title: 'Checkout',
    summary: 'Orders through a gateway, a queue, workers and Postgres.',
    source: checkoutSource,
    from: ['queue-workers'],
  },
  {
    id: 'alerts',
    title: 'Alerts',
    summary: 'Two topics on shared brokers, then a fan-out to the receivers.',
    source: alertsSource,
    from: ['notifications'],
  },
  {
    id: 'search',
    title: 'Search',
    summary: 'Clients that retry, a rate limiter, an autoscaled API and a cache.',
    source: searchSource,
    from: ['cache', 'rate-limit', 'autoscale', 'retry-storm'],
  },
]

const title = (id: string) => TEMPLATES.find((t) => t.id === id)?.title ?? id

/** What a definition shows, compiled once. */
function useFeatures(source: string) {
  return useMemo(() => {
    const def = compile(source).definition
    return def ? features(def.model, def.view) : []
  }, [source])
}

function Chips({ source }: { source: string }) {
  const list = useFeatures(source)
  return (
    // phrasing content only: a starter's card is a button
    <span className="chips">
      {list.map((f) => (
        <i key={f}>{f}</i>
      ))}
    </span>
  )
}

function Walkthroughs({ root }: { root: string }) {
  return (
    <ul className="cards">
      {WALKTHROUGHS.map((w) => (
        <li key={w.id}>
          <a href={`${root}examples/${w.id}/`}>
            <b>{w.title}</b>
            <span>{w.summary}</span>
            <Chips source={w.source} />
            <small>Grown from {w.from.map(title).join(', ')}</small>
          </a>
        </li>
      ))}
    </ul>
  )
}

function Starters({ root }: { root: string }) {
  const [id, setId] = useState(TEMPLATES[0]!.id)
  const t = TEMPLATES.find((x) => x.id === id)!
  const def = useMemo(() => compile(t.source).definition, [t])
  const grown = WALKTHROUGHS.find((w) => w.from.includes(t.id))
  return (
    <>
      <ul className="cards">
        {TEMPLATES.map((x) => (
          <li key={x.id}>
            <button type="button" aria-pressed={x.id === id} onClick={() => setId(x.id)}>
              <b>{x.title}</b>
              <span>{x.summary}</span>
              <Chips source={x.source} />
            </button>
          </li>
        ))}
      </ul>
      <Actions name={t.id} source={t.source} edit={`${root}editor/?template=${t.id}`} editLabel="Open in the editor ⤢">
        {grown && (
          <a className="grown" href={`${root}examples/${grown.id}/`}>
            Grown up: {grown.title} →
          </a>
        )}
      </Actions>
      {def && (
        <Loadmap key={t.id} model={def.model} view={def.view} theme="inherit" zoom {...pageOptions(def.options)} />
      )}
    </>
  )
}

export function mount(el: HTMLElement) {
  const root = el.dataset.root ?? '../'
  createRoot(el).render(el.dataset.show === 'walkthroughs' ? <Walkthroughs root={root} /> : <Starters root={root} />)
}
