// The quick start of @loadmap/react's README, drawn. quickstart.ts holds its code; a test keeps the two the same.
import { createRoot } from 'react-dom/client'
import { App } from './quickstart-app'

export function mount(el: HTMLElement) {
  createRoot(el).render(<App />)
}
