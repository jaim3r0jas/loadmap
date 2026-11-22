import { compile } from '@loadmap/dsl'
import { recorded } from '@loadmap/dsl/assist'
import { runExplore } from '@loadmap/providers'
import { describe, expect, it } from 'vitest'
import { CASES } from '../src/cases'
import { exampleProject, metricsIn, recordedStore, runCase, table } from '../src/harness'

const clock = () => 0

describe('the eval', () => {
  it('has forty cases with their own names, each on an example that compiles', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40)
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
    for (const example of new Set(CASES.map((c) => c.example))) {
      const p = exampleProject(example)
      const errors = compile(p.files[p.entry]!, { path: p.entry, files: p.files }).diagnostics.filter(
        (d) => d.severity === 'error',
      )
      expect(errors, example).toEqual([])
    }
  })

  it('runs the looks a model asks for against the recorded store, and says when it wrote without looking', async () => {
    const c = CASES.find((x) => x.id === 'explore-measure')!
    const model = recorded([
      '```explore\nsearch orders\n```',
      [
        '```ops',
        'put',
        '  metric orders "Orders taken" {',
        "    prometheus { query: 'sum(rate(shop_orders_total[1m]))' }",
        '  }',
        '  measure orderTaken orders { fallback: 10; unit: "orders/s" }',
        '```',
      ].join('\n'),
    ])
    const looked = await runCase(c, { model, reference: '# ref', clock })
    expect(looked).toMatchObject({ id: 'explore-measure', pass: true, failed: [] })
    // what the store read went back to the model, as data
    expect(model.requests[1]!.messages.at(-1)!.content).toContain(
      'shop_orders_total (counter): Orders the checkout took',
    )
    const blind = await runCase(c, {
      model: recorded([
        '```ops\nput\n  metric orders "Orders" {\n    prometheus { query: \'sum(rate(orders_total[1m]))\' }\n  }\n```',
      ]),
      reference: '# ref',
      clock,
    })
    expect(blind.failed).toEqual([
      'did not look in the store',
      'names orders_total, which the store lacks',
      'lacks shop_orders_total',
    ])
  })

  it('reads the metric names a query writes, and answers a look as a store would: by the name it gives', async () => {
    expect(metricsIn('sum by (service) (rate(shop_requests_total{service="web",status_code!="500"}[5m]))')).toEqual([
      'shop_requests_total',
    ])
    expect(metricsIn('histogram_quantile(0.95, sum(rate(http_seconds_bucket[5m])) by (le))')).toEqual([
      'http_seconds_bucket',
    ])
    const store = recordedStore({
      shop_orders_total: { type: 'counter', help: 'Orders', series: [{ service: 'checkout' }], value: 9 },
    })
    const now = new Date('2026-11-21T12:00:00Z')
    const read = await runExplore(
      store,
      [
        { tool: 'labels', arg: 'shop_orders_total' },
        { tool: 'labels', arg: 'cache_hits_total' },
        { tool: 'try', arg: 'sum(rate(cache_hits_total[1m]))' },
        { tool: 'try', arg: 'sum(rate(shop_orders_total[1m]))' },
      ],
      { now },
    )
    // a metric it lacks finds nothing, as on a real store: never another metric's numbers
    expect(read).toContain('labels shop_orders_total:\n  1 series\n  service: checkout (1)')
    expect(read).toContain('labels cache_hits_total:\n  0 series')
    expect(read).toContain('try over 1h sum(rate(cache_hits_total[1m])):\n  0 series, 0 samples')
    expect(read).toMatch(/try over 1h sum\(rate\(shop_orders_total\[1m\]\)\):\n {2}1 series, \d+ samples, mean 9/)
  })

  it('passes a case a good answer meets, and says why a poor one fails', async () => {
    const c = CASES.find((x) => x.id === 'scenario-add')!
    const good = await runCase(c, {
      model: recorded([
        '```ops\nput\n  param pods "Worker pods" { options: [2, 4, 8, 16]; default: 4 }\nput\n  scenario "Sixteen pods" { pods: 16 }\n```',
      ]),
      reference: '# ref',
      clock,
    })
    expect(good).toMatchObject({ id: 'scenario-add', pass: true, failed: [], repairs: 0 })
    const poor = await runCase(c, {
      model: recorded(['```ops\nput\n  scenario "Eight" { pods: 8 }\n```']),
      reference: '# ref',
      clock,
    })
    expect(poor.pass).toBe(false)
    expect(poor.failed).toEqual(['lacks scenario "Sixteen pods"', 'lacks 16'])
  })

  it('wants a question where the request cannot be done, and no change', async () => {
    const c = CASES.find((x) => x.id === 'vague')!
    expect(
      (await runCase(c, { model: recorded(['```questions\nBetter how?\n```']), reference: '# ref', clock })).pass,
    ).toBe(true)
    const changed = await runCase(c, {
      model: recorded(['```ops\nset web.short to "the web"\n```']),
      reference: '# ref',
      clock,
    })
    expect(changed.failed).toEqual(['no question back', 'changed the files instead of asking'])
  })

  it('counts a model that fails as a failed case, not a crash', async () => {
    const r = await runCase(CASES[0]!, { model: recorded([]), reference: '# ref', clock })
    expect(r).toMatchObject({ pass: false, error: 'the recording has no more answers' })
  })

  it('writes a table a model per row, then each case', () => {
    const md = table([
      {
        model: 'm',
        form: 'operations',
        results: [{ id: 'a', pass: true, failed: [], repairs: 1, input: 10, output: 2, cached: 5, ms: 2000 }],
      },
    ])
    expect(md).toContain('| m | operations | 1 of 1 | 1 | 10 | 5 | 2 | 2 |')
    expect(md).toContain('| a | pass (1 repair) |')
  })
})
