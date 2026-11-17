// A diagram fed by Prometheus while it is open. Nothing in a definition fetches anything, so the page does it: every
// few seconds it pulls the definition's measures into a snapshot (the same `pull` the command line runs) and compiles
// the text again with it. The diagram keeps the reader's values; only what was measured moves.
import { compile, sharedValues } from '@loadmap/dsl'
import { prometheus, pull } from '@loadmap/providers'
import { fromSnapshot, Loadmap, type LoadmapHandle } from '@loadmap/react'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import source from './shop.loadmap?raw'

/** Seconds between two reads, and between two points of a read. */
const EVERY = 10
/** Seconds a read looks back: its mean is "now". */
const WINDOW = 120

// the page's own origin (a provider takes a whole URL): vite.config.ts passes /prometheus on to the server
const providers = { prometheus: prometheus({ url: new URL('/prometheus', location.href).href }) }

async function read() {
  // on the step's grid, so two reads in the same step ask for the same points
  const to = Math.floor(Date.now() / (EVERY * 1000)) * EVERY * 1000
  const snapshot = await pull(compile(source).measures, {
    from: new Date(to - WINDOW * 1000).toISOString(),
    to: new Date(to).toISOString(),
    step: EVERY,
    fetched: new Date().toISOString(),
    providers,
  })
  const measurements = Object.values(snapshot.measurements)
  return {
    result: compile(source, { snapshot: fromSnapshot(snapshot) }),
    // a measurement that could not be read says why, and the model uses the definition's own value for it
    missing: measurements.filter((m) => 'missing' in m).length,
    of: measurements.length,
    at: snapshot.fetched,
  }
}

function Live() {
  const [live, setLive] = useState<Awaited<ReturnType<typeof read>> | null>(null)
  const [error, setError] = useState('')
  const board = useRef<LoadmapHandle | null>(null)
  useEffect(() => {
    let open = true
    const tick = () =>
      read().then(
        (next) => {
          if (!open) return
          setLive(next)
          setError('')
        },
        (err) => open && setError(String(err)),
      )
    tick()
    const timer = setInterval(tick, EVERY * 1000)
    return () => {
      open = false
      clearInterval(timer)
    }
  }, [])
  // until the first read, and whenever Prometheus is away: the definition's own values
  const { definition } = live?.result.definition ? live.result : compile(source)
  if (!definition) return <p>shop.loadmap does not compile.</p>
  return (
    <>
      <p id="read">
        {error
          ? `No data: ${error}. The diagram shows the definition's own values.`
          : live
            ? `${live.of - live.missing} of ${live.of} measurements read from Prometheus at ${live.at.slice(11, 19)} UTC`
            : 'Reading Prometheus…'}
      </p>
      <Loadmap
        model={definition.model}
        view={definition.view}
        ref={board}
        initial={sharedValues(definition.model, board.current?.values() ?? {})}
      />
    </>
  )
}

createRoot(document.getElementById('app')!).render(<Live />)
