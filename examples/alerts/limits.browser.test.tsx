import { recordVideo } from '@loadmap/export'
import type { LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Alerts } from './Alerts'
import { alerts } from './model'

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
})

async function mount() {
  await page.viewport(1440, 1000)
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Alerts ref={ref} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  const handle = ref.current!
  handle.pause()
  return { handle, el: host.querySelector<HTMLElement>('.lm')! }
}

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
const opacity = (e: Element | null | undefined) => Number(e?.getAttribute('opacity') ?? 1)
/** How much of a ring shows: its box's fade and the engine's fade in and out. */
const shows = (g: Element) => opacity(g)
const rings = (el: HTMLElement) =>
  [...el.querySelectorAll('g[data-halo]')].map((g) => ({
    kind: (g as SVGGElement).dataset.halo!,
    component: (g as SVGGElement).dataset.component!,
    shows: shows(g),
  }))
/** The "LIMIT" tags a viewer sees. */
const tags = (el: HTMLElement) =>
  [...el.querySelectorAll<SVGGElement>('g[data-halo] [data-tag]')]
    .filter((t) => shows(t.closest('[data-halo]')!) > 0)
    .map((t) => t.dataset.tag)
const badges = (el: HTMLElement) =>
  [...el.querySelectorAll<SVGGElement>('g[data-badge]')].map((b) => b.dataset.badge).sort()
/** The values of a story step, by its title. */
const step = (title: string) => alerts.story.find((s) => s.title === title)!.values

async function advance(handle: LoadmapHandle, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    await handle.ready()
    handle.step(dt)
  }
  await handle.ready()
}

it('tags the limit with its multiple and badges the next two in line', async () => {
  const { el } = await mount()
  expect(tags(el)).toEqual(['LIMIT · 7.6×'])
  expect(badges(el)).toEqual(['2nd · 28×', '3rd · 35×'])
  expect(el.querySelectorAll('g[data-halo]')).toHaveLength(1)
})

it('hands the limit over in the story: one tag at a time, and the title says where it went', async () => {
  const { handle, el } = await mount()
  handle.playStory()
  const seen: { shot: string; rings: ReturnType<typeof rings>; tags: number; title: string }[] = []
  for (let i = 0; i < 600 && handle.engine.story; i++) {
    await handle.ready()
    handle.step(0.1)
    await handle.ready()
    await frames()
    seen.push({
      shot: handle.engine.story?.shot ?? 'end',
      rings: rings(el),
      tags: tags(el).length,
      title: el.querySelector('.lm-title span')?.textContent ?? '',
    })
  }
  // never two tags, and never two rings showing at once
  expect(Math.max(...seen.map((s) => s.tags))).toBe(1)
  expect(seen.filter((s) => s.rings.filter((r) => r.shows > 0).length > 1)).toEqual([])
  // the last step hands it on: the old ring fades out, the new one comes in, with the hand shot between the change
  // and the flight out
  const order = seen.map((s) => s.shot).filter((x, i, a) => x !== a[i - 1])
  expect(order.slice(-6)).toEqual(['close', 'change', 'hand', 'out', 'wide', 'end'])
  const was = seen.filter((s) => s.rings.some((r) => r.kind === 'was'))
  expect(was[0]!.rings.find((r) => r.kind === 'was')).toMatchObject({ component: 'posPods', shows: 1 })
  expect(was.at(-1)!.rings.find((r) => r.kind === 'limit')).toMatchObject({ component: 'push', shows: 1 })
  expect(seen.map((s) => s.title)).toContain('The push broker overtakes the position consumer: the limit is 18× now')
  // after the story the push broker is the limit, and the consumer is next in line
  expect(tags(el)).toEqual(['LIMIT · 18×'])
  expect(badges(el)).toEqual(['2nd · 20×', '3rd · 35×'])
  expect(el.querySelectorAll('g[data-halo]')).toHaveLength(1)
}, 120_000)

it('hands it over in 0.6 s when the reader changes the values, the old limit keeping a note a moment', async () => {
  const { handle, el } = await mount()
  handle.setValues(step('Launch week: more pods'))
  await advance(handle, 3)
  expect(tags(el)).toEqual(['LIMIT · 20×'])
  handle.setValues(step('Push to every receiver'))
  await advance(handle, 0.15)
  const mid = rings(el)
  expect(mid.find((r) => r.kind === 'was')!.shows).toBeGreaterThan(0)
  expect(mid.find((r) => r.kind === 'was')!.shows).toBeLessThan(1)
  expect(mid.find((r) => r.kind === 'limit')!.shows).toBe(0)
  await advance(handle, 0.6)
  expect(rings(el)).toEqual([
    { kind: 'was', component: 'posPods', shows: 0 },
    { kind: 'limit', component: 'push', shows: 1 },
  ])
  expect(badges(el)).toEqual(['2nd · 20×', '3rd · 35×'])
  // the handover ends: only the limit's ring is left
  await advance(handle, 2)
  expect(el.querySelectorAll('g[data-halo]')).toHaveLength(1)
})

it('cuts the handover on a paused board nothing steps', async () => {
  const { handle, el } = await mount()
  handle.setValues(step('Push to every receiver'))
  await handle.ready()
  expect(rings(el)).toEqual([{ kind: 'limit', component: 'push', shows: 1 }])
  expect(tags(el)).toEqual(['LIMIT · 18×'])
})

it('fades a ring back from what showed of it: there and back again flashes nothing', async () => {
  const { handle, el } = await mount()
  handle.setValues(step('Launch week: more pods'))
  await advance(handle, 3)
  handle.setValues(step('Push to every receiver'))
  await advance(handle, 0.1)
  // the push broker's ring has not come in yet; back to the consumer, it does not show on its way out either
  handle.setValues(step('Launch week: more pods'))
  for (let i = 0; i < 12; i++) {
    await advance(handle, 0.05)
    expect(rings(el).find((r) => r.component === 'push')?.shows ?? 0).toBe(0)
    expect(rings(el).filter((r) => r.shows > 0).length).toBeLessThanOrEqual(1)
  }
  expect(tags(el)).toEqual(['LIMIT · 20×'])
})

it('cuts the handover with reduced motion', async () => {
  const real = window.matchMedia
  window.matchMedia = (q: string) =>
    q.includes('reduced-motion')
      ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
      : real.call(window, q)
  try {
    const { handle, el } = await mount()
    handle.setValues(step('Launch week: more pods'))
    await advance(handle, 3)
    handle.setValues(step('Push to every receiver'))
    await advance(handle, 0.05)
    expect(rings(el)).toEqual([
      { kind: 'was', component: 'posPods', shows: 0 },
      { kind: 'limit', component: 'push', shows: 1 },
    ])
    expect(el.querySelector('g[data-halo="limit"] [data-ring]')!.getAttribute('transform') ?? '').toBe('')
  } finally {
    window.matchMedia = real
  }
})

it('moves no box and changes no tag when only the load changes', async () => {
  const { handle, el } = await mount()
  const look = () => ({
    boxes: [...el.querySelectorAll('[data-node] > rect:first-child')].map((r) =>
      ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)).join(' '),
    ),
    tags: tags(el),
    badges: badges(el),
    places: [...el.querySelectorAll('[data-tag] > rect, [data-badge] rect')].map((r) =>
      ['x', 'y', 'width'].map((a) => r.getAttribute(a)).join(' '),
    ),
  })
  handle.setValues({ load: 1 })
  await advance(handle, 1)
  const low = look()
  handle.setValues({ load: alerts.load.max })
  await advance(handle, 1)
  expect(look()).toEqual(low)
})

it('records the story with its handover the same twice', async () => {
  const { handle } = await mount()
  const run = async () => {
    const out: string[] = []
    await recordVideo(handle, {
      format: 'gif',
      story: true,
      fps: 2,
      scale: 0.4,
      caption: true,
      onFrame: async (_, c) => {
        const d = await crypto.subtle.digest('SHA-256', c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
        out.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''))
      },
    })
    return out
  }
  const a = await run()
  expect(await run()).toEqual(a)
}, 120_000)
