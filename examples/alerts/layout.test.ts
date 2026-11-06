import { describe, it } from 'vitest'
import { expectSteady } from '../phases'
import { alerts } from './model'
import { view } from './view'

describe('alerts layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`moves no box in any scenario, story step, preset or control (${direction})`, () =>
      expectSteady(view, alerts, direction))
})
