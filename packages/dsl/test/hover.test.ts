import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, hover, loadCatalog, signatureHelp } from '../src'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cache = read('../../editor/src/templates/cache.loadmap')
const checkout = read('../../../examples/checkout/checkout.loadmap')
const every = read('../../../docs/every-statement.loadmap')

/** The hover where "|" is in `src`, with the definition its text compiles to (none when it has an error). */
function at(src: string) {
  const i = src.indexOf('|')
  const text = src.slice(0, i) + src.slice(i + 1)
  const h = hover(text, i, compile(text).definition)
  return h && { ...h, word: text.slice(h.from, h.to) }
}
/** `src` with "|" put `k` characters into the first `needle`. */
const put = (src: string, needle: string, k = 1) => {
  const i = src.indexOf(needle)
  if (i < 0) throw new Error(`no "${needle}"`)
  return `${src.slice(0, i + k)}|${src.slice(i + k)}`
}

// docs/every-statement.loadmap has a published statement
beforeAll(() => loadCatalog())

describe('hover', () => {
  it('says what a statement and a property are, from the schema', () => {
    expect(at(put(cache, 'node db'))).toMatchObject({ word: 'node', head: expect.stringMatching(/^node gateway/) })
    expect(at(put(cache, 'capacity: estimated(3_000'))).toMatchObject({
      word: 'capacity',
      head: 'capacity: measured(…), estimated(…) or configured(…)',
      body: [expect.stringMatching(/^What it can handle/)],
    })
    expect(at(put(cache, 'shape: cylinder', 9))?.head).toBe('shape: box | cylinder')
    expect(
      at(put(checkout.replace('rate: 40 * load', 'rate: 40 * load\n  route: gateway'), 'from: phones'))?.body,
    ).toEqual(['The node its dots start from.', 'Required.'])
  })

  it("gives a flow's rate at the defaults, and what of it reaches a stage", () => {
    expect(at(put(cache, 'flows.reads', 7))).toEqual({
      from: expect.any(Number),
      to: expect.any(Number),
      word: 'reads',
      head: 'flow reads "reads"',
      body: ['2,000 a second at the defaults (load 1×).', 'Route: api → cache → db.', 'One unit: read.'],
    })
    expect(at(put(cache, 'at.db.reads', 7))?.body[0]).toBe('400 a second of reads reach db at the defaults (load 1×).')
    expect(at(put(cache, 'flows.reads', 1))).toMatchObject({
      head: 'flows.…',
      body: [expect.stringMatching(/^`flows/)],
    })
  })

  it("gives a component's utilization, its capacity and where it runs out", () => {
    const db = [
      '13 % at the defaults (load 1×): 400 of 3,000 queries/s ±30 %.',
      'Capacity estimated: load test of a replica.',
      '50 % at 2.6×–4.8× (between November 2028 and March 2030); full at 5.2×–9.7× (between May 2030 and September 2031).',
    ]
    expect(at(put(cache, 'node db', 6))).toMatchObject({
      head: 'node db "Database" "primary"',
      body: ['Runs the stage db.', ...db],
    })
    expect(at(put(cache, 'at.db.reads', 3))).toMatchObject({ word: 'db', body: expect.arrayContaining(db) })
    // a route names the stage, util. the component
    expect(at(put(cache, 'api -> cache -> db', 16))?.body).toEqual(expect.arrayContaining(db))
    const util = put(
      cache.replace('over: "queries queue', 'describe: `${pct(util.db)} busy`\n  over: "queries queue'),
      'util.db',
      5,
    )
    expect(at(util)?.body).toEqual(db)
  })

  it('describes parameters, the load, lets, fits and builtins where formulas name them', () => {
    expect(at(put(cache, 'pods * 1', 1))).toEqual(
      expect.objectContaining({ head: 'param pods "API pods"', body: ['A select: 2, 4 or 6. Default 2.'] }),
    )
    expect(at(put(cache, '2_000 * load', 9))?.body).toEqual([
      'The load, as a multiple of today. It drives the limits.',
      'From 1× to 50×, 1× at first.',
    ])
    expect(at(put(every, 'let perEvent', 6))).toMatchObject({
      head: 'let perEvent = newest ? 1 : 2',
      body: [expect.any(String), '1 at the defaults (load 2×).'],
    })
    expect(at(put(checkout, 'workerCores(', 2))?.body[0]).toBe(
      'A line fitted to 21 measured points: call it as `workerCores(rate)`.',
    )
    expect(at(put(cache, 'compact(', 2))).toMatchObject({
      head: 'compact(x)',
      body: ['A compact number: 980 / 1.2k / 34k / 1.5M.'],
    })
    // inside a template's ${…}
    expect(at(put(cache, '`${pods} pods`', 4))?.head).toBe('param pods "API pods"')
  })

  it('names nodes in edges, tiers, scenarios and the parameters a scenario sets', () => {
    expect(at(put(cache, 'clients -> api', 1))?.head).toBe('node clients "Clients" "web and mobile"')
    const tier = at(put(checkout, 'tier: edge', 7))
    expect(tier).toMatchObject({
      head: 'tier edge "Edge"',
      body: [expect.any(String), expect.stringMatching(/^Named by gateway/)],
    })
    expect(at(put(checkout, 'tier edge', 6))?.head).toBe('tier edge "Edge"')
    expect(at(put(cache, '{ hit: 0.95 }', 3))?.head).toBe('param hit "Cache hit ratio"')
    // bare, as `expect` and `step` usually name it, and where it is declared
    expect(at(put(checkout, 'scenario: Proposed', 12))?.head).toBe('scenario "Proposed"')
    expect(at(put(checkout, 'scenario "Proposed"', 11))?.body).toEqual([
      'Sets gateways 2, pods 6; every other value is the default.',
    ])
    expect(at(put(every, 'scenario: "Bigger API"', 12))).toMatchObject({
      head: 'scenario "Bigger API"',
      body: expect.arrayContaining(['Sets pods 8; every other value is the default.']),
    })
  })

  it('says nothing in a comment or a text', () => {
    expect(at(put(cache, '# no demand', 4))).toBeNull()
    expect(at(put(cache, '"Database"', 3))).toBeNull()
    expect(at(put(cache, '`${pods} pods`', 10))).toBeNull()
  })

  it('still says what a name is while the text has an error, without values', () => {
    const broken = put(cache.replace('rate: 2_000 * load', 'rate: 2_000 *'), 'flows.reads', 7)
    expect(at(broken)).toMatchObject({
      head: 'flow reads "reads"',
      body: ['Route: api → cache → db.', 'One unit: read.'],
    })
  })

  it('never throws, at any offset of a file or of a prefix of it', () => {
    for (const [src, step] of [
      [cache, 3],
      [checkout, 11],
      [every, 11],
    ] as const) {
      const def = compile(src).definition
      for (let i = 0; i <= src.length; i += step) {
        hover(src, i, def)
        hover(src.slice(0, i), i)
        signatureHelp(src, i)
      }
    }
  })
})

describe('signature help', () => {
  const sig = (src: string) => {
    const i = src.indexOf('|')
    return signatureHelp(src.slice(0, i) + src.slice(i + 1), i)
  }

  it("names a builtin's arguments and the one being written", () => {
    expect(sig('let x = estimated(3000 ± 30%, "|')).toMatchObject({
      label: 'estimated(value, unit, source)',
      active: 1,
    })
    expect(sig('let x = pow(max(1, |), 2)')).toMatchObject({ name: 'max', label: 'max(a, b, …)', active: 1 })
    expect(sig('let x = pow(max(1, 2), |')).toMatchObject({ name: 'pow', active: 1 })
    // the rest of a variadic call stays on its last argument
    expect(sig('let x = min(1, 2, 3, |')).toMatchObject({ active: 1, variadic: true })
    expect(sig('let x = round(1, |')).toMatchObject({ active: 1, params: ['x'] })
  })

  it('names a fit by its x, and nothing outside a call', () => {
    expect(sig(put(checkout, 'workerCores(flows', 12))).toMatchObject({ label: 'workerCores(rate)', active: 0 })
    expect(sig('let x = 2 * |')).toBeNull()
    expect(sig('let x = max(1, 2) |')).toBeNull()
    expect(sig('# max(|')).toBeNull()
  })
})
