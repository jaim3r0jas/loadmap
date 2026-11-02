// Mounts the live parts of a page. Each island loads its own code, so a page without one loads almost nothing.
const ISLANDS: Record<string, () => Promise<{ mount: (el: HTMLElement) => void }>> = {
  loadmap: () => import('./islands/live'),
  example: () => import('./islands/example'),
  editor: () => import('./islands/editor'),
  templates: () => import('./islands/templates'),
  quickstart: () => import('./islands/quickstart'),
}

for (const el of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const load = ISLANDS[el.dataset.island ?? '']
  if (!load) continue
  load().then(
    (m) => m.mount(el),
    (err) => console.error(`loadmap docs: the ${el.dataset.island} island failed to load`, err),
  )
}
