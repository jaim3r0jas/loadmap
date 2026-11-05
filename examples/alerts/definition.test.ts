import { PANELS } from '@loadmap/dsl/internal'
import { LOADMAP_PANELS } from '@loadmap/react'
import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import source from './alerts.loadmap?raw'
import { alerts } from './model'
import { view } from './view'

describe('alerts.loadmap', () => {
  const def = compiled(source, 'alerts.loadmap')

  it('gives the same model as model.ts', () => {
    sameModel(alerts, def.model, grid(alerts))
    expect(def.options).toEqual({
      speed: 10,
      transition: 1,
      fullScreen: ['verdict', 'live', 'limits', 'controls', 'headroom'],
      fullScreenMode: 'panels',
      assumptions: [
        'Load scales linearly with users; 1× is the busiest five minutes of an ordinary week.',
        'Alerts come first at every hop: their own topic, their own pods, served before positions.',
      ],
    })
  })

  it('names the panels of full screen as <Loadmap> does', () => {
    expect(PANELS).toEqual(LOADMAP_PANELS)
  })

  it('lays out the same as view.ts', async () => {
    await sameView(view, def.view, grid(alerts))
  })

  it('moves the same dots', () => {
    sameDots(alerts, def.model, { load: 20, merge: true })
  })
})
