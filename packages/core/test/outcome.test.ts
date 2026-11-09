import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { check, defineModel, estimated, measured, p, pass } from '../src'
import { fromSnapshot, parseSnapshot } from '../src/measure'

const snapshot = parseSnapshot(readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8'))

// 100 req/s at 1× against 1,000 req/s: the 50 % target at 5×, or 3.5× to 6.5× with a ± 30 %
const model = (capacity = measured(1000, 'req/s'), o: { snapshot?: typeof snapshot; target?: number } = {}) =>
  defineModel({
    load: p.load({ max: 100 }),
    ...(o.snapshot && { snapshot: o.snapshot }),
    flows: { req: { rate: ({ load }) => 100 * load } },
    components: { api: { name: 'API', capacity, over: 'clients get 503s' } },
    stages: { api: pass('api') },
    routes: { req: ['api'] },
    expect: [{ label: 'Keeps it', target: o.target ?? 4 }],
  })

describe('check outcomes', () => {
  it('passes, fails, or is inconclusive when only the high edge of a ± holds', () => {
    expect(check(model())[0]).toMatchObject({ outcome: 'pass', ok: true, reasons: [] })
    expect(check(model(measured(1000, 'req/s'), { target: 6 }))[0]).toMatchObject({ outcome: 'fail', ok: false })
    const ranged = estimated(1000, 'req/s', { within: 0.3 })
    expect(check(model(ranged, { target: 4 }))[0]).toMatchObject({ outcome: 'inconclusive', ok: false })
    expect(check(model(ranged, { target: 4 }))[0]!.reasons).toEqual(['holds at 4× only at the high edge of a ±'])
    expect(check(model(ranged, { target: 7 }))[0]!.outcome).toBe('fail')
    expect(check(model(ranged, { target: 3 }))[0]!.outcome).toBe('pass')
  })

  it('is inconclusive while data it rests on is missing, saying which', () => {
    const read = fromSnapshot(snapshot)
    const r = check(model(read.capacity('lag', measured(1000, 'req/s')), { snapshot }))[0]!
    expect(r.outcome).toBe('inconclusive')
    expect(r.reasons).toEqual(['API: 3 of at least 30 samples', 'hit: the query returned no series'])
    // the claim still says what the fallback gives
    expect(r.message).toBe('the 50 % target holds up to 5×, limited by API')
  })

  it('keeps a certain failure a failure beside a component with no published benchmark', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: {
        api: { name: 'API', capacity: measured(600, 'req/s'), over: 'x' },
        // not ranked: it can only run out sooner, never move a failure later
        db: {
          name: 'DB',
          capacity: { value: Number.NaN, unit: 'req/s', provenance: 'published', missing: 'for 6 brokers' },
          over: 'y',
        },
      },
      stages: { api: pass('api'), db: pass('db') },
      routes: { req: ['api', 'db'] },
      expect: [{ target: 5 }, { target: 2 }],
    })
    const [fails, holds] = check(m)
    expect(fails).toMatchObject({ outcome: 'fail', reasons: [] })
    expect(holds).toMatchObject({ outcome: 'inconclusive', reasons: ['DB: no published benchmark for 6 brokers'] })
  })

  it('takes a severity, which check() keeps for the runner to read', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: { api: { name: 'API', capacity: measured(1000, 'req/s'), over: 'x' } },
      stages: { api: pass('api') },
      routes: { req: ['api'] },
      expect: [{ target: 9, severity: 'warn' }],
    })
    expect(check(m)[0]).toMatchObject({ outcome: 'fail', expectation: { severity: 'warn' } })
  })
})
