import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import source from './checkout.loadmap?raw'
import { checkout } from './model'
import { view } from './view'

describe('checkout.loadmap', () => {
  const def = compiled(source, 'checkout.loadmap')

  it('gives the same model as model.ts', () => {
    sameModel(checkout, def.model, grid(checkout))
    expect(def.options).toEqual({
      speed: 10,
      assumptions: ['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.'],
    })
  })

  it('lays out the same as view.ts', async () => {
    await sameView(view, def.view, grid(checkout))
  })

  it('moves the same dots', () => {
    sameDots(checkout, def.model, { load: 40 })
  })
})
