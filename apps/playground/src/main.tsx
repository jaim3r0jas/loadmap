import { Alerts } from '@loadmap/example-alerts'
import { Checkout } from '@loadmap/example-checkout'
import { download, exportPng, expose, recordVideo } from '@loadmap/export'
import type { LoadmapHandle } from '@loadmap/react'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const EXAMPLES = { checkout: Checkout, alerts: Alerts } as const
type Name = keyof typeof EXAMPLES

const initial = (): Name => {
  const q = new URLSearchParams(location.search).get('example')
  return q && q in EXAMPLES ? (q as Name) : 'checkout'
}

function App() {
  const [name, setName] = useState<Name>(initial)
  const handle = useRef<LoadmapHandle>(null)
  const Example = EXAMPLES[name]
  // loadmap record finds the shown example as "default" and by its name
  useEffect(() => {
    const h = handle.current
    if (!h) return
    const off = [expose(h), expose(h, name)]
    return () => {
      for (const f of off) f()
    }
  }, [name])
  const pick = (n: Name) => {
    setName(n)
    history.replaceState(null, '', `?example=${n}`)
  }
  const png = async () => handle.current && download(await exportPng(handle.current), `${name}.png`)
  const webm = async () =>
    handle.current &&
    download(
      await recordVideo(handle.current, {
        seconds: 6,
        script: [
          { at: 0, set: { load: 5 } },
          { at: 2, set: { load: 30 } },
        ],
      }),
      `${name}.webm`,
    )
  return (
    <>
      <nav style={{ padding: '12px 16px 0', display: 'flex', gap: 8, fontFamily: 'system-ui' }}>
        {(Object.keys(EXAMPLES) as Name[]).map((n) => (
          <button type="button" key={n} aria-pressed={n === name} onClick={() => pick(n)}>
            {n}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={png}>
          Export PNG
        </button>
        <button type="button" onClick={webm}>
          Record 6 s WebM
        </button>
      </nav>
      <Example key={name} ref={handle} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
