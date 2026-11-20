import { compile } from '@loadmap/dsl'
import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Canvas } from '../src/Canvas'
import { CANVAS } from '../src/canvasSize'
import type { Engine } from '../src/engine'
import { LoadmapRoot } from '../src/Loadmap'
import { useLoadmap } from '../src/useLoadmap'

const SOURCE = `loadmap 1.1
title: "Orders"
load { max: 10; default: 2 }

flow req "requests" { rate: 1_000 * load; route: gateway -> api -> db; from: users }

node users "Users"
node gateway "Gateway" { pass; capacity: measured(8_000, "req/s"); over: "502s" }
node api "API" { pass; capacity: measured(5_000, "req/s"); over: "503s" }
node db "Database" { pass; capacity: measured(3_000, "req/s"); over: "timeouts" }

users -> gateway -> api -> db
`

const compiled = compile(SOURCE)
if (!compiled.ok || !compiled.definition) throw new Error('the test model does not compile')
const { model, view } = compiled.definition

let engine: Engine | null = null

function Page({ panel, height }: { panel: number; height?: number }) {
  const lm = useLoadmap(model, view)
  useEffect(() => {
    engine = lm.engine
  }, [lm.engine])
  return (
    <LoadmapRoot lm={lm}>
      <Canvas lm={lm} panel={panel} style={height ? { height } : undefined}>
        <Canvas.Bar>
          <div style={{ height: 30 }}>bar</div>
        </Canvas.Bar>
        <Canvas.Console>
          <div style={{ height: 50 }}>console</div>
        </Canvas.Console>
      </Canvas>
    </LoadmapRoot>
  )
}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
  engine = null
})

const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r))
}

async function mount(width: number, height?: number) {
  host = document.createElement('div')
  host.style.width = `${width}px`
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Page panel={0} height={height} />)
  await expect.poll(() => host!.querySelector('[data-node="db"]'), { timeout: 5000 }).not.toBeNull()
  await expect.poll(() => engine?.room ?? null, { timeout: 5000 }).not.toBeNull()
  await frames()
  return host.querySelector<HTMLElement>('.lm-canvas')!
}

const px = (el: Element, name: string) => (el as HTMLElement).style.getPropertyValue(name)
const high = (el: Element | null) => Math.ceil(el!.getBoundingClientRect().height)

describe('a canvas on a page', () => {
  it('has the height its page gives it, the bar over its top and the console over its bottom', async () => {
    const canvas = await mount(1000, 500)
    const box = canvas.getBoundingClientRect()
    expect(box.height).toBe(500)
    expect(canvas.getAttribute('role')).toBe('region')
    expect(canvas.getAttribute('aria-label')).toBe('Orders')
    expect(canvas.dataset.width).toBe('wide')
    const bar = canvas.querySelector('.lm-canvas-bar')!.getBoundingClientRect()
    const cons = canvas.querySelector('.lm-canvas-console')!.getBoundingClientRect()
    expect(Math.round(bar.top - box.top)).toBe(1)
    expect(Math.round(box.bottom - cons.bottom)).toBe(1)
    // the bar, then the diagram, then the console: the order a keyboard and a screen reader take
    expect([...canvas.children].map((c) => c.className.split(' ')[0])).toEqual([
      'lm-canvas-bar',
      'lm-wrap',
      'lm-canvas-console',
    ])
  })

  it('takes a default height when the page gives none', async () => {
    const canvas = await mount(1000)
    const h = canvas.getBoundingClientRect().height
    expect(h).toBeGreaterThanOrEqual(420)
    expect(h).toBeLessThanOrEqual(760)
  })

  it('arranges the diagram for what the bars and the rail leave', async () => {
    const canvas = await mount(1000, 500)
    const wrap = canvas.querySelector('.lm-wrap')!
    const top = high(canvas.querySelector('.lm-canvas-bar'))
    const bottom = high(canvas.querySelector('.lm-canvas-console'))
    expect(px(wrap, '--lm-inset-top')).toBe(`${top}px`)
    expect(px(wrap, '--lm-inset-bottom')).toBe(`${bottom}px`)
    expect(px(wrap, '--lm-inset-right')).toBe(`${CANVAS.rail}px`)
    // the box inside its border, less the reserved sides and Fit's margin of 24 px on each side
    expect(engine!.room).toEqual({ w: canvas.clientWidth - CANVAS.rail - 48, h: 498 - top - bottom - 48 })
  })

  it('moves the view and not the layout when a panel opens', async () => {
    const canvas = await mount(1000, 500)
    const wrap = canvas.querySelector('.lm-wrap')!
    const room = engine!.room
    const scene = engine!.scene
    root!.render(<Page panel={340} height={500} />)
    await expect.poll(() => px(wrap, '--lm-inset-right'), { timeout: 5000 }).toBe('340px')
    await frames()
    expect(engine!.room).toBe(room)
    expect(engine!.scene).toBe(scene)
    expect(canvas.getBoundingClientRect().height).toBe(500)
    root!.render(<Page panel={0} height={500} />)
    await expect.poll(() => px(wrap, '--lm-inset-right'), { timeout: 5000 }).toBe(`${CANVAS.rail}px`)
    expect(engine!.room).toBe(room)
  })

  it('reads its size class from its own width, and tells the room again when that changes', async () => {
    const canvas = await mount(1000, 500)
    const wide = engine!.room!
    host!.style.width = '480px'
    await expect.poll(() => canvas.dataset.width, { timeout: 5000 }).toBe('compact')
    const top = high(canvas.querySelector('.lm-canvas-bar'))
    const bottom = high(canvas.querySelector('.lm-canvas-console'))
    // no rail, and Fit's margin of 16 px on a board under 640 px
    await expect
      .poll(() => engine!.room, { timeout: 5000 })
      .toEqual({ w: canvas.clientWidth - 32, h: 498 - top - bottom - 32 })
    expect(engine!.room!.w).toBeLessThan(wide.w)
    host!.style.width = '700px'
    await expect.poll(() => canvas.dataset.width, { timeout: 5000 }).toBe('regular')
  })

  it('is short under 420 px of height', async () => {
    const canvas = await mount(1000, 320)
    expect(canvas.dataset.short).toBe('')
    expect(canvas.getBoundingClientRect().height).toBe(320)
  })
})
