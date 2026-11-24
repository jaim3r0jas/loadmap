import { collisions, layout, type Scene } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { moved } from '../phases'
import { compiled } from '../roundtrip'
import source from './checkout.loadmap?raw'

const middles = (s: Scene) => s.nodes.map((n) => [n.id, Math.round(n.x + n.w / 2), Math.round(n.y + n.h / 2)])

// what an editor does after an edit: the new version laid out from where the boxes are drawn (`from`)
describe('checkout, a box added in the editor', () => {
  const version = (add = '') => {
    const d = compiled(`${source}\n${add}`, 'checkout.loadmap')
    return { view: d.view, ev: d.model.evaluate(d.model.defaults()) }
  }
  const AUDIT = 'node audit "Audit log"\nworkerPool -> audit\n'

  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`keeps the boxes the edit did not touch where they are drawn, where a layout from scratch moves them (${direction})`, async () => {
      const a = version()
      const b = version(AUDIT)
      const first = await layout(a.view, a.ev, { direction })
      const scratch = await layout(b.view, b.ev, { direction })
      const held = await layout(b.view, b.ev, { direction, from: first })
      // from scratch the new box rearranges its layer and the ones after it
      expect(moved(first, scratch)).toBeGreaterThanOrEqual(3)
      // held, only the database gives way to the box beside it
      expect(moved(first, held)).toBeLessThanOrEqual(1)
      expect(held.nodes.map((n) => n.id)).toEqual(scratch.nodes.map((n) => n.id))
      expect(collisions(held)).toEqual([])
      // the same structure: one key, two layouts of it
      expect(held.key).toBe(scratch.key)
      // and it rests: laid out again from itself, nothing moves
      const c = version(AUDIT)
      const again = await layout(c.view, c.ev, { direction, from: held })
      expect(middles(again)).toEqual(middles(held))
    })

  it('places a chain of new boxes after the box that feeds the first, and a box nothing ties where it is in no way', async () => {
    const a = version()
    const b = version(
      'node audit "Audit log"\nnode archive "Archive"\nnode spare "Spare"\nworkerPool -> audit\naudit -> archive\n',
    )
    const first = await layout(a.view, a.ev, { direction: 'RIGHT' })
    const held = await layout(b.view, b.ev, { direction: 'RIGHT', from: first })
    const x = (id: string) => held.nodes.find((n) => n.id === id)!.x
    // each after the one that feeds it: no edge runs back
    expect(x('audit')).toBeGreaterThan(x('workerPool'))
    expect(x('archive')).toBeGreaterThan(x('audit'))
    expect(moved(first, held)).toBeLessThanOrEqual(1)
    expect(collisions(held)).toEqual([])
    // the spare box was put anywhere: tied later, it is placed by its edge, after the box that feeds it
    const c = version(
      'node audit "Audit log"\nnode archive "Archive"\nnode spare "Spare"\nworkerPool -> audit\naudit -> archive\narchive -> spare\n',
    )
    const tied = await layout(c.view, c.ev, { direction: 'RIGHT', from: held })
    const at = (id: string) => tied.nodes.find((n) => n.id === id)!.x
    expect(at('spare')).toBeGreaterThan(at('archive'))
    expect(collisions(tied)).toEqual([])
  })

  it('holds nothing of a scene that was folded into rows', async () => {
    const a = version()
    const b = version(AUDIT)
    const folded = await layout(a.view, a.ev, { direction: 'RIGHT', rows: 2 })
    expect(await layout(b.view, b.ev, { direction: 'RIGHT', from: { ...folded, rows: 2 } })).toBe(
      await layout(b.view, b.ev, { direction: 'RIGHT' }),
    )
  })

  it('leaves the layout from scratch as it is: a page, a reload and a recording never see a held one', async () => {
    const a = version()
    const b = version(AUDIT)
    const first = await layout(a.view, a.ev, { direction: 'RIGHT' })
    await layout(b.view, b.ev, { direction: 'RIGHT', from: first })
    const after = await layout(b.view, b.ev, { direction: 'RIGHT' })
    // another compile of the same text, never held
    const c = version(AUDIT)
    expect(after).toEqual(await layout(c.view, c.ev, { direction: 'RIGHT' }))
  })

  it('holds nothing of a scene that runs the other way, nor folded into rows: laid out as ever', async () => {
    const a = version()
    const b = version(AUDIT)
    const first = await layout(a.view, a.ev, { direction: 'RIGHT' })
    expect(await layout(b.view, b.ev, { direction: 'DOWN', from: first })).toBe(
      await layout(b.view, b.ev, { direction: 'DOWN' }),
    )
    expect(await layout(b.view, b.ev, { direction: 'RIGHT', rows: 2, from: first })).toBe(
      await layout(b.view, b.ev, { direction: 'RIGHT', rows: 2 }),
    )
  })
})
