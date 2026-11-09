import type { Evaluation, Model } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { alerts } from '../../../examples/alerts/model'
import { checkout } from '../../../examples/checkout/model'
import { handoverText, handsOver, rankLabels } from '../src/ranks'

/** The labels by component name, in rank order. */
const labels = (model: Model, ev: Evaluation) =>
  [...rankLabels(ev, model)].sort((a, b) => a[1].rank - b[1].rank).map(([c, r]) => [ev.components[c]!.name, r.text])

describe('the limit and the next in line', () => {
  it('tags the limit with its multiple and badges the next two that come within the load range', () => {
    // the gateway's ± range: the pessimistic edge, the number the ranking and the headline use. Postgres reaches the
    // target only at 1750×, far past the slider's 100×: no badge
    expect(labels(checkout, checkout.evaluate(checkout.defaults()))).toEqual([
      ['API gateway', 'LIMIT · 7.4×'],
      ['Worker pool', '2nd · 10×'],
    ])
    const [launch, push] = alerts.story.slice(2).map((st) => alerts.evaluate(st.values))
    expect(labels(alerts, launch!)).toEqual([
      ['Position consumer', 'LIMIT · 20×'],
      ['Brokers', '2nd · 35×'],
      ['Alert pipeline', '3rd · 38×'],
    ])
    expect(labels(alerts, push!)).toEqual([
      ['Push broker', 'LIMIT · 18×'],
      ['Position consumer', '2nd · 20×'],
      ['Brokers', '3rd · 35×'],
    ])
  })

  it('reads the same at every load: the multiples do not depend on it', () => {
    const at = (load: number) => labels(checkout, checkout.evaluate({ ...checkout.defaults(), load }))
    expect(at(1)).toEqual(at(100))
  })

  it('says how the limit passed on: the old one fixed, or another overtaking it', () => {
    const v = { ...checkout.defaults(), load: 20 }
    const a = checkout.evaluate(v)
    const b = checkout.evaluate({ ...v, gateways: 2 })
    expect(handsOver(a, b)).toBe(true)
    expect(handoverText(a, b, checkout)).toBe('API gateway fixed: the worker pool is next, at 10×')
    // back again: the workers stay where they were, the gateway comes closer
    expect(handoverText(b, a, checkout)).toBe('The API gateway overtakes the worker pool: the limit is 7.4× now')
    const [launch, push] = alerts.story.slice(2).map((st) => alerts.evaluate(st.values))
    expect(handoverText(launch!, push!, alerts)).toBe(
      'The push broker overtakes the position consumer: the limit is 18× now',
    )
    expect(handsOver(a, a)).toBe(false)
    expect(handoverText(a, checkout.evaluate({ ...v, load: 1 }), checkout)).toBeNull()
  })
})
