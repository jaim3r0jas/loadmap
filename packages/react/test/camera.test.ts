import type { Model } from '@loadmap/core'
import { layout, type Scene, type View } from '@loadmap/layout'
import { shapesOf } from '@loadmap/layout/internal'
import { describe, expect, it } from 'vitest'
import { alerts } from '../../../examples/alerts/model'
import { view as alertsView } from '../../../examples/alerts/view'
import { checkout } from '../../../examples/checkout/model'
import { view as checkoutView } from '../../../examples/checkout/view'
import { between, framing, type Rect, stepSeconds, stepTitle, storySeconds, targets, whole } from '../src/camera'

/** Each step as Play takes it from the defaults: the boxes it frames, the framing, and the title. */
async function played(model: Model, view: View) {
  let values = model.defaults()
  let ev = model.evaluate(values)
  const out = []
  for (const [i, st] of model.story.entries()) {
    const scene = await layout(view, ev)
    const after = model.evaluate(st.values)
    const ids = targets(scene, ev, after, { a: shapesOf(view, ev), b: shapesOf(view, after) }, st.focus)
    out.push({ ids, close: framing(scene, ids), scene, title: stepTitle(model, values, st, i) })
    values = st.values
    ev = after
  }
  return out
}

/** The framing shows every box framed, at the scene's shape, inside it, at most 2.5× closer. */
function frames(s: Awaited<ReturnType<typeof played>>[number]) {
  const { close: c, scene, ids } = s
  expect(c.w / c.h).toBeCloseTo(scene.width / scene.height, 6)
  expect(c.x).toBeGreaterThanOrEqual(0)
  expect(c.y).toBeGreaterThanOrEqual(0)
  expect(c.x + c.w).toBeLessThanOrEqual(scene.width + 1e-9)
  expect(c.y + c.h).toBeLessThanOrEqual(scene.height + 1e-9)
  expect(c.w).toBeGreaterThanOrEqual(scene.width / 2.5 - 1e-9)
  for (const n of scene.nodes.filter((x) => ids.includes(x.id))) {
    expect(n.x).toBeGreaterThanOrEqual(c.x)
    expect(n.y).toBeGreaterThanOrEqual(c.y)
    expect(n.x + n.w).toBeLessThanOrEqual(c.x + c.w)
    expect(n.y + n.h).toBeLessThanOrEqual(c.y + c.h)
  }
}

describe('the camera of a story played', () => {
  it("frames what each of checkout's steps changes", async () => {
    const steps = await played(checkout, checkoutView)
    // 1: the load falls and the gateway, the one past the target, drops below it; 2: the step points at the gateway;
    // 3: it points at the workers, whose pods double (the gateway's instances change no box)
    expect(steps.map((s) => s.ids)).toEqual([['gateway'], ['gateway'], ['workers']])
    for (const s of steps) {
      expect(s.close).not.toEqual(whole(s.scene))
      frames(s)
    }
    expect(steps.map((s) => s.title)).toEqual([
      '1 · An ordinary peak',
      '2 · Users 1× → 20×',
      '3 · Proposed: Gateway instances 1 → 2, Worker pods 3 → 6',
    ])
  })

  it("frames several boxes together, and the box a step points at, in alerts' steps", async () => {
    const steps = await played(alerts, alertsView)
    expect(steps[1]!.ids).toEqual(['posPods'])
    // launch week reshapes both pools, and the brokers that show a partition per pod: one framing holds the three
    expect([...steps[2]!.ids].sort()).toEqual(['alertPods', 'brokers', 'posPods'])
    expect(steps[3]!.ids).toContain('push')
    for (const s of steps.slice(1)) frames(s)
    expect(steps.map((s) => s.title)).toEqual([
      '1 · Today at 10×',
      '2 · Users 10× → 25×',
      '3 · Launch week: more pods',
      '4 · Push to every receiver',
    ])
  })

  it('shows the whole diagram when there is nothing to frame, or the boxes fill it', async () => {
    const scene = await layout(checkoutView, checkout.evaluate())
    expect(framing(scene, [])).toEqual(whole(scene))
    expect(framing(scene, ['phones', 'db'])).toEqual(whole(scene))
    // boxes that grow past the share kept as the change runs: the framing widens with them, it does not jump out
    // two boxes 870 apart on a board 1000 wide: past the 80 % kept, inside the board
    const flat = {
      width: 1000,
      height: 250,
      nodes: [
        { id: 'a', x: 50, y: 100, w: 60, h: 40 },
        { id: 'b', x: 860, y: 100, w: 60, h: 40 },
      ],
    } as unknown as Scene
    const wide = framing(flat, ['a', 'b'])
    const held = framing(flat, ['a', 'b'], { hold: true })
    expect(wide).toEqual(whole(flat))
    expect(held.w).toBeLessThan(flat.width)
    expect(held.w).toBeGreaterThan(0.8 * flat.width)
  })

  it('flies evenly between two framings, and lands on them', () => {
    const a: Rect = { x: 0, y: 0, w: 1200, h: 300 }
    const b: Rect = { x: 400, y: 100, w: 300, h: 75 }
    expect(between(a, b, 0)).toEqual(a)
    const end = between(a, b, 1)
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(end[k]).toBeCloseTo(b[k], 9)
    // halfway the size is the geometric mean: a zoom feels as fast going in as coming out
    expect(between(a, b, 0.5).w).toBeCloseTo(600, 9)
    expect(between(a, b, 0.5).w / between(a, b, 0.5).h).toBeCloseTo(4, 9)
  })

  it('says what a step changes when it has no title of its own', () => {
    const st = { ...checkout.story[1]!, title: undefined }
    expect(stepTitle(checkout, checkout.defaults(), st, 1)).toBe('2 · Users 10× → 20×')
    expect(stepTitle(checkout, checkout.story[1]!.values, st, 1)).toBe('2 · Nothing changes')
    const batch = { ...st, values: { ...st.values, batch: false } }
    expect(stepTitle(checkout, st.values, batch, 1)).toBe('2 · Batch DB writes off')
  })

  it('times a step as its shots, and the story from the whole diagram', () => {
    // in 1, close 0.5, the change held until the structure has moved (at least 1.6), out 1, then the step's seconds
    expect(stepSeconds({ seconds: 4 }, 0.8)).toBeCloseTo(8.1, 9)
    expect(stepSeconds({ seconds: 4 }, 2)).toBeCloseTo(9.2, 9)
    expect(storySeconds(checkout.story, 0.8)).toBeCloseTo(25.5, 9)
  })
})
