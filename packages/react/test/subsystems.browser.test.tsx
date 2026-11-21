import { compile, type Definition } from '@loadmap/dsl'
import { Diagram, Loadmap, type LoadmapHandle, LoadmapRoot, useLoadmap } from '@loadmap/react'
import { LoadmapSource } from '@loadmap/react/source'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

// a region that holds a gateway and its orders line; at the default load the consumers are past their capacity
const SOURCE = `loadmap 1.5
load { max: 100; default: 10 }

flow orders "orders" { rate: 100 * load; from: shop; route: eu.gw -> eu.line.topic -> eu.line.pool }

node shop "Shop"

subsystem eu "EU region" {
  node gw "Gateway" { pass; capacity: estimated(100_000, "req/s"); over: "requests are refused" }
  subsystem line "Orders" {
    cluster kafka "Kafka" {
      members: 3
      queue topic { partitions { orders: 6 } }
    }
    pool pool "Consumers" {
      pods: 4
      perPod: 4
      demand: flows.orders * 0.01
      capacity: measured(4, "cores", "pod CPU limit")
      over: "orders wait in their topic"
    }
    kafka -> pool
  }
  gw -> line.kafka
}

shop -> eu.gw
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

/** A page of its own with the board alone: a page's board zooms only when the page says so. */
function Board({ model, view }: Pick<Definition, 'model' | 'view'>) {
  const lm = useLoadmap(model, view)
  return (
    <LoadmapRoot lm={lm}>
      <Diagram lm={lm} />
    </LoadmapRoot>
  )
}

describe('a subsystem on the board', () => {
  it('is a frame with its name around its boxes, in the state of the worst of them', async () => {
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE} />)
    await expect.poll(() => host!.querySelectorAll('[data-subsystem-id]').length, { timeout: 5000 }).toBe(2)
    const frame = (id: string) => host!.querySelector<SVGGElement>(`[data-subsystem-id="${id}"]`)!
    expect(frame('eu').querySelector('text')?.textContent).toBe('\u25BE EU region')
    expect(frame('eu.line').querySelector('text')?.textContent).toBe('\u25BE Orders')
    // the frames are drawn before the boxes: behind them
    const svg = frame('eu').ownerSVGElement!
    const order = [...svg.children]
    const firstBox = order.findIndex((el) => el.hasAttribute('data-node'))
    expect(order.indexOf(frame('eu'))).toBeLessThan(order.indexOf(frame('eu.line')))
    expect(order.indexOf(frame('eu.line'))).toBeLessThan(firstBox)
    const holds = (id: string, box: string) => {
      const a = frame(id).querySelector('rect')!.getBoundingClientRect()
      const b = svg.querySelector(`[data-node="${box}"]`)!.getBoundingClientRect()
      return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom
    }
    for (const box of ['eu.gw', 'eu.line.kafka', 'eu.line.pool']) expect(holds('eu', box), box).toBe(true)
    expect(holds('eu.line', 'eu.line.pool')).toBe(true)
    expect(holds('eu.line', 'eu.gw')).toBe(false)
    expect(holds('eu', 'shop')).toBe(false)
    // the consumers are past their capacity: both frames around them say so
    expect(frame('eu').dataset.state).toBe('over')
    expect(frame('eu.line').dataset.state).toBe('over')
  })

  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const frames = () => [...host!.querySelectorAll<SVGGElement>('[data-subsystem-id]')].map((g) => g.dataset.subsystemId)
  const box = (id: string) => host!.querySelector<SVGGElement>(`[data-node="${id}"]`)

  it('is one box while it is closed: a click opens it, and a click on a name closes one', async () => {
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE.replace('load {', 'view { closed: [eu.line] }\nload {')} />)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    // the orders line is one box in the region's frame, named with the mark of a closed folder and its busiest component
    expect(frames()).toEqual(['eu'])
    expect(box('eu.line.pool')).toBeNull()
    expect(box('eu.line')!.textContent).toContain('\u25B8 Orders')
    expect(box('eu.line')!.textContent).toMatch(/Consumers 250\s?%/)
    expect(box('eu.line')!.getAttribute('aria-label')).toBe('\u25B8 Orders: closed. Open it')
    // the limit is inside it: the box wears it
    expect(host.querySelector('[data-subsystem-id="eu"]')!.getAttribute('data-state')).toBe('over')
    click(box('eu.line')!)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    await expect.poll(() => box('eu.line.pool'), { timeout: 5000 }).toBeTruthy()
    // a click on the region's name closes the region, with everything in it
    click(host.querySelector('[data-subsystem-id="eu"] text')!)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual([])
    expect(box('eu')!.textContent).toContain('\u25B8 EU region')
  })

  it("shows a story step with the subsystems the step closes, and the page's own outside the story", async () => {
    const def = compile(
      `${SOURCE}step "The region as one box." { closed: [eu] }\nstep "Every box." { closed: [] }\n`.replace(
        'load {',
        'view { closed: [eu.line] }\nload {',
      ),
    ).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} closed={def.options.closed} />)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    ref.current!.setStoryStep(0)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    ref.current!.setStoryStep(1)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    ref.current!.setStoryStep(null)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    // the frame that goes fades out with its boxes: gone once the move is over
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu'])
  })

  it('keeps what the reader opened and closed when the text is edited: a new view closes and opens nothing', async () => {
    const text = SOURCE.replace('load {', 'view { closed: [eu.line] }\nload {')
    const first = compile(text).definition!
    // an edit that leaves every box as it is: only what the verdict says of the gateway
    const edited = compile(text.replace('requests are refused', 'requests are turned away')).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    const draw = (d: Definition) =>
      root!.render(<Loadmap ref={ref} model={d.model} view={d.view} closed={d.options.closed} transition={0} />)
    const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const places = () =>
      [...host!.querySelectorAll('[data-node]')].map((n) => {
        const r = n.getBoundingClientRect()
        return `${n.getAttribute('data-node')} ${Math.round(r.x)} ${Math.round(r.y)}`
      })
    const camera = () => box('shop')!.ownerSVGElement!.getAttribute('viewBox')
    draw(first)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    // the reader opens the orders line
    click(box('eu.line')!)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    await expect.poll(() => box('eu.line.pool'), { timeout: 5000 }).toBeTruthy()
    await ref.current!.ready()
    await twoFrames()
    const was = { places: places(), camera: camera() }
    draw(edited)
    await expect.poll(() => ref.current!.engine.model).toBe(edited.model)
    await ref.current!.ready()
    await twoFrames()
    expect(frames()).toEqual(['eu', 'eu.line'])
    expect(box('eu.line')).toBeNull()
    expect(places()).toEqual(was.places)
    expect(camera()).toBe(was.camera)
    // the page's own `closed` edited is the newer word for the subsystems it changes: opened by both, then closed again
    const page = (closed: string[]) =>
      root!.render(<Loadmap ref={ref} model={edited.model} view={edited.view} closed={closed} transition={0} />)
    page([])
    await twoFrames()
    expect(frames()).toEqual(['eu', 'eu.line'])
    page(['eu.line'])
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu'])
    click(box('eu.line')!)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    // and what they closed stays closed
    click(host.querySelector('[data-subsystem-id="eu"] text')!)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    draw(first)
    await expect.poll(() => ref.current!.engine.model).toBe(first.model)
    await ref.current!.ready()
    await twoFrames()
    expect(box('eu')).toBeTruthy()
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual([])
  })

  it('shows what a story step closes only while the step shows: a new view of the model is outside the story', async () => {
    const text = `${SOURCE}step "The region as one box." { closed: [eu] }\n`
    const first = compile(text).definition!
    const edited = compile(text.replace('requests are refused', 'requests are turned away')).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    root.render(<Loadmap ref={ref} model={first.model} view={first.view} transition={0} />)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    ref.current!.setStoryStep(0)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    // the text edited: the story is left, and with it what its step closed
    root.render(<Loadmap ref={ref} model={edited.model} view={edited.view} transition={0} />)
    await expect.poll(() => ref.current!.storyStep()).toBeNull()
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
  })

  it('plays a story through a step that closes a subsystem: the story goes on, and so do the dots', async () => {
    const def = compile(
      `${SOURCE}step "The region as one box." { closed: [eu]; seconds: 1 }\nstep "Every box." { closed: []; seconds: 1 }\n`,
    ).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} transition={0} />)
    await expect.poll(() => ref.current).toBeTruthy()
    const handle = ref.current!
    await handle.ready()
    handle.pause()
    const engine = handle.engine
    const sim = engine.sim
    const seconds = handle.playStory()
    const seen = new Set<number | null>()
    for (let t = 0; t < seconds + 2; t += 0.1) {
      handle.step(0.1)
      await handle.ready()
      seen.add(handle.storyStep())
    }
    // both steps were shown, the first with the region closed
    expect(seen.has(0) && seen.has(1)).toBe(true)
    // closing and opening drew the same model another way: the sim was never started over
    expect(engine.sim).toBe(sim)
  })

  it('flies in to a frame on a click, and says where the view is over the board', async () => {
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE} zoom transition={0} />)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    const crumbs = () => host!.querySelector('.lm-crumbs')?.textContent ?? null
    // the whole diagram shows: no path to say
    expect(crumbs()).toBeNull()
    const rect = host.querySelector('[data-subsystem-id="eu.line"] rect')!
    expect(rect.getAttribute('aria-label')).toBe('Orders: fly in to it')
    click(rect)
    await expect.poll(crumbs, { timeout: 5000 }).toBe('Whole diagram›EU region›Orders')
    // every step is a button, the last the place the view is; one back flies out to the region
    const back = [...host.querySelectorAll<HTMLButtonElement>('.lm-crumbs button')]
    expect(back.map((b) => b.textContent)).toEqual(['Whole diagram', 'EU region', 'Orders'])
    expect(back[2]!.getAttribute('aria-current')).toBe('location')
    back[1]!.click()
    await expect.poll(crumbs, { timeout: 5000 }).toBe('Whole diagram›EU region')
    host.querySelector<HTMLButtonElement>('.lm-crumbs button')!.click()
    await expect.poll(crumbs, { timeout: 5000 }).toBeNull()
  })

  // `<Loadmap>`'s board is a canvas, which always zooms: a board put on a page from the parts does not
  it('leaves a frame still on a board that does not zoom', async () => {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<Board model={def.model} view={def.view} />)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    expect(host.querySelector('[data-subsystem-id="eu"] rect')!.getAttribute('role')).toBeNull()
  })
})
