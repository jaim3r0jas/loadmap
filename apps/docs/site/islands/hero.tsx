// The home page's board: the checkout example filling its frame beside the pitch, the diagram with the load and the
// verdict (`fill` takes the frame's height, `panels={[]}` leaves the tabs out, `scrolls` the wheel to the page). The
// example's page has every panel.
import { Checkout } from '@loadmap/example-checkout'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

export function mount(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <Checkout theme="inherit" fill scrolls panels={[]} />
    </StrictMode>,
  )
}
