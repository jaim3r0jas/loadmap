import { describe, it } from 'vitest'
import { expectCompact, expectSteady } from '../phases'
import { alerts } from './model'
import { view } from './view'

describe('alerts layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    it(`moves no box in any scenario, story step, preset or control, laid out stable (${direction})`, () =>
      expectSteady(view, alerts, direction))
    it(`never moves with the load, and lays out each phase the same whatever came before (${direction})`, () =>
      expectCompact(view, alerts, direction))
  }
})
