import { describe, it } from 'vitest'
import { expectCompact, expectSteady, laidOut } from '../phases'
import { search } from './model'
import { view } from './view'

describe('search layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    it(`moves no box in any scenario, story step, preset or control, laid out stable (${direction})`, () =>
      expectSteady(view, search, direction))
    // the view is stable; laid out compact instead, it keeps the compact promises too
    it(`laid out compact, never moves with the load, and lays out each phase on its own (${direction})`, () =>
      expectCompact(laidOut(view, 'compact'), search, direction))
  }
})
