import { Checkout } from '@loadmap/example-checkout'
import { download, exportPng, recordVideo } from '@loadmap/export'
import type { LoadmapHandle } from '@loadmap/react'
import { StrictMode, useRef } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const handle = useRef<LoadmapHandle>(null)
  const png = async () => handle.current && download(await exportPng(handle.current), 'checkout.png')
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
      'checkout.webm',
    )
  return (
    <>
      <Checkout ref={handle} />
      <p style={{ padding: '0 16px', display: 'flex', gap: 8 }}>
        <button type="button" onClick={png}>
          Export PNG
        </button>
        <button type="button" onClick={webm}>
          Record 6 s WebM
        </button>
      </p>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
