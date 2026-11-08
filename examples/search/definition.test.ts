import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import { search } from './model'
import source from './search.loadmap?raw'
import { view } from './view'

describe('search.loadmap', () => {
  const def = compiled(source, 'search.loadmap')

  it('gives the same model as model.ts', () => {
    sameModel(search, def.model, grid(search))
    expect(def.options).toEqual({
      speed: 10,
      transition: 0.8,
      assumptions: [
        '1× is the busiest hour of an ordinary week.',
        'A client retries a search the limiter turns away, at once.',
      ],
    })
  })

  it('lays out the same as view.ts, stable', async () => {
    expect(def.view.def.layout).toBe('stable')
    await sameView(view, def.view, grid(search))
  })

  it('moves the same dots', () => {
    sameDots(search, def.model, { load: 30 })
  })
})
