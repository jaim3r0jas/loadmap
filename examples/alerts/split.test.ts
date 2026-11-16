import { describe, expect, it } from 'vitest'
import { compiled, grid, sameDots, sameModel, sameView } from '../roundtrip'
import { alerts } from './model'
import data from './split/alerts.data.loadmap?raw'
import source from './split/alerts.loadmap?raw'
import story from './split/alerts.story.loadmap?raw'
import platform from './split/platform.loadmap?raw'
import { view } from './view'

// alerts in several files: the fit's series and the story as parts, and its two pools from one prototype of a library,
// each with its own inputs and its own named stage. The same model and view as model.ts and view.ts
const files = {
  'alerts.loadmap': source,
  'alerts.data.loadmap': data,
  'alerts.story.loadmap': story,
  'platform.loadmap': platform,
}

describe('alerts in several files', () => {
  const def = compiled(source, 'alerts.loadmap', { path: 'alerts.loadmap', files })

  it('gives the same model as model.ts', () => {
    sameModel(alerts, def.model, grid(alerts))
    expect(def.options.assumptions).toHaveLength(2)
  })

  it('lays out the same as view.ts', async () => {
    await sameView(view, def.view, grid(alerts))
  })

  it('moves the same dots', () => {
    sameDots(alerts, def.model, { load: 20, mergeNewest: true })
  })
})
