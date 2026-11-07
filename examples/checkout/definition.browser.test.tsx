import { compile } from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Checkout } from './Checkout'
import source from './checkout.loadmap?raw'

const roots: Root[] = []
afterEach(() => {
  for (const r of roots.splice(0)) r.unmount()
  document.body.replaceChildren()
})

async function mount(el: React.ReactElement<{ ref?: unknown }>, ref: React.RefObject<LoadmapHandle | null>) {
  const host = document.createElement('div')
  // a fixed width: the second board must not change the first one's size (a scrollbar appearing would). Both in the
  // same place, one over the other: a canvas has the device pixels it covers, which its place can change by one
  host.style.cssText = 'position: absolute; top: 0; left: 0; width: 1200px'
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  root.render(el)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return host
}

async function hash(data: Uint8ClampedArray<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

it('draws checkout.loadmap exactly like the TypeScript example', async () => {
  await page.viewport(1280, 900)
  const def = compile(source).definition!
  const a = createRef<LoadmapHandle>()
  const b = createRef<LoadmapHandle>()
  const ts = await mount(<Checkout ref={a} />, a)
  const dsl = await mount(
    <Loadmap
      ref={b}
      model={def.model}
      view={def.view}
      speed={def.options.speed}
      transition={def.options.transition}
      assumptions={def.options.assumptions}
    />,
    b,
  )
  for (const h of [a.current!, b.current!]) {
    h.pause()
    h.setValues({ load: 40, pods: 4 })
    await h.ready()
  }
  // a new layout resizes the board, and its ResizeObserver clears the canvas a frame later: let that pass first
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  for (const h of [a.current!, b.current!]) {
    h.reset(3)
    for (let i = 0; i < 300; i++) h.step(1 / 30)
  }
  // React's ids differ between two roots, and the live meters refresh on a wall-clock timer; the rest must match
  const html = (el: HTMLElement) => {
    const lm = el.querySelector('.lm')!.cloneNode(true) as HTMLElement
    lm.querySelector('.lm-meters')?.remove()
    return lm.outerHTML.replace(/ (id|for|aria-labelledby)="[^"]*"/g, '').replace(/_r_\w+_/g, '_r_')
  }
  expect(html(dsl)).toBe(html(ts))
  // both read in the same task, before a frame could draw either again
  const pixels = [b, a].map((h) => {
    const c = h.current!.board()!.canvas
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  })
  expect(await hash(pixels[0]!)).toBe(await hash(pixels[1]!))
})
