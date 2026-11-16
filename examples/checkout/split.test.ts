import { compile } from '@loadmap/dsl'
import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import { checkout } from './model'
import data from './split/checkout.data.loadmap?raw'
import source from './split/checkout.loadmap?raw'
import story from './split/checkout.story.loadmap?raw'
import platform from './split/platform.loadmap?raw'
import { view } from './view'

// the same checkout in several files: the fit's data and the story as parts, the worker pod and the database from a
// library. It must be the model and the view that model.ts and view.ts are, as the one-file checkout.loadmap is
const files = {
  'checkout.loadmap': source,
  'checkout.data.loadmap': data,
  'checkout.story.loadmap': story,
  'platform.loadmap': platform,
}

describe('checkout in several files', () => {
  const def = compiled(source, 'checkout.loadmap', { path: 'checkout.loadmap', files })

  it('gives the same model as model.ts', () => {
    sameModel(checkout, def.model, grid(checkout))
    expect(def.options).toEqual({
      speed: 10,
      fullScreenMode: 'focus',
      transition: 0.8,
      assumptions: ['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.'],
    })
  })

  it('lays out the same as view.ts', async () => {
    await sameView(view, def.view, grid(checkout))
  })

  it('moves the same dots', () => {
    sameDots(checkout, def.model, { load: 40 })
  })

  it('is the same model from any of its files, and its library checks on its own', () => {
    for (const part of ['checkout.data.loadmap', 'checkout.story.loadmap'] as const) {
      const r = compile(files[part], { path: part, files })
      expect(r.diagnostics, part).toEqual([])
      expect(r.role).toBe('part')
      sameModel(checkout, r.definition!.model, [{}])
    }
    const library = compile(platform, { path: 'platform.loadmap', files })
    expect(library.role).toBe('library')
    expect(library.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
})
