// The home page's board: the checkout example filling its frame beside the pitch, the diagram and its verdict only
// (fill lays it out as full screen does, with the panels named in fullScreen). The example's page has every panel.
import { Checkout } from '@loadmap/example-checkout'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <Checkout theme="inherit" fill panels={[]} />
    </StrictMode>,
  )
}
