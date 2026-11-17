import { compile, flatten } from '@loadmap/dsl'
import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import { regionsFiles } from './index'
import { regions } from './model'
import { view } from './view'

// the regions in their files: the model, its story as a part, a region from one library and the building blocks it is
// made of from another, and a variant. They must be the model and the view that model.ts and view.ts are
const { files } = regionsFiles

describe('regions.loadmap in several files', () => {
  const def = compiled(files['regions.loadmap'], 'regions.loadmap', regionsFiles)

  it('gives the same model as model.ts', () => {
    sameModel(regions, def.model, grid(regions))
    expect(def.options).toEqual({
      speed: 10,
      transition: 0.8,
      closed: ['eu', 'us'],
      assumptions: [
        '1× is the busiest hour of an ordinary week, in both regions at once.',
        'A region that is lost sends every order to the other one, at once.',
      ],
    })
  })

  it('lays out the same as view.ts: each region and its orders a subsystem', async () => {
    expect(def.view.def.subsystems).toEqual({
      eu: { label: 'EU region' },
      'eu.orders': { label: 'Orders' },
      us: { label: 'US region' },
      'us.orders': { label: 'Orders' },
    })
    await sameView(view, def.view, grid(regions))
  })

  it('moves the same dots', () => {
    sameDots(regions, def.model, { load: 5, euLost: true })
  })

  it('names the copies of one region apart, as model.ts does', () => {
    const names = Object.values(def.model.def.components as Record<string, { name: string }>).map((c) => c.name)
    expect(names).toContain('EU region › Workers')
    expect(names).toContain('US region › Workers')
    expect(new Set(names).size).toBe(names.length)
  })

  it('is the same model from its part, its libraries check on their own, and the variant sizes the US alike', () => {
    const part = compile(files['regions.story.loadmap'], { path: 'regions.story.loadmap', files })
    expect(part.diagnostics).toEqual([])
    expect(part.role).toBe('part')
    sameModel(regions, part.definition!.model, [{}])
    for (const lib of ['region.loadmap', 'platform.loadmap'] as const) {
      const r = compile(files[lib], { path: lib, files })
      expect(r.role, lib).toBe('library')
      expect(
        r.diagnostics.filter((d) => d.severity === 'error'),
        lib,
      ).toEqual([])
    }
    const even = compile(files['regions.even.loadmap'], { path: 'regions.even.loadmap', files })
    expect(even.diagnostics).toEqual([])
    expect(even.definition!.model.defaults()).toMatchObject({ usPods: 4 })
  })

  it('flattens to one file that draws the same frames and computes the same', async () => {
    const flat = flatten(files['regions.loadmap'], regionsFiles)
    if ('error' in flat) throw new Error(flat.error)
    const one = compiled(flat.text, 'flat.loadmap')
    sameModel(regions, one.model, grid(regions))
    await sameView(view, one.view, [{}])
  })
})
