// The home page's board: the checkout example filling its frame beside the pitch, the diagram and its verdict only
// (fill lays it out as full screen does, with the panels named in fullScreen). The example's page has every panel.
import { checkout, view } from '@loadmap/example-checkout'
import { Loadmap } from '@loadmap/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <Loadmap
        model={checkout}
        view={view}
        theme="inherit"
        speed={10}
        zoom
        fill
        fullScreen={['verdict']}
        headroom={false}
        compare={false}
      />
    </StrictMode>,
  )
}
