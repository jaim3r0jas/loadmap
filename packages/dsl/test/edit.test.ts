import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile } from '../src'
import { type EditValue, edit, type InspectField, inspect } from '../src/internal'

const root = new URL('../../../', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, root), 'utf8')
const checkout = read('examples/checkout/checkout.loadmap')
const files = execSync('git ls-files "*.loadmap"', { cwd: root }).toString().trim().split('\n')

/** The lines an edit takes out and puts in, as a unified diff without context. */
function diff(source: string, key: string, value: EditValue): string[] {
  const r = edit(source, key, value)
  if ('error' in r) throw new Error(r.error)
  const a = source.split('\n')
  const b = r.source.split('\n')
  let head = 0
  while (head < a.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && a.at(-1 - tail) === b.at(-1 - tail)) tail++
  return [...a.slice(head, a.length - tail).map((l) => `-${l}`), ...b.slice(head, b.length - tail).map((l) => `+${l}`)]
}

const refused = (source: string, key: string, value: EditValue) => {
  const r = edit(source, key, value)
  return 'error' in r ? r.error : null
}

/** A small definition that compiles, around the given lines. */
const mini = (...lines: string[]) =>
  ['loadmap 1', 'load { max: 2 }', 'flow f { rate: load; route: b; from: a }', ...lines, ''].join('\n')

const fieldsOf = (source: string, target: Parameters<typeof inspect>[1]) =>
  new Map(inspect(source, target)!.sections.flatMap((s) => s.fields.map((f): [string, InspectField] => [f.key, f])))

describe('inspect', () => {
  it("shows a box's label, capacity and the parameters its formulas read", () => {
    const i = inspect(checkout, { node: 'gateway' })!
    expect(i.title).toBe('API gateway')
    expect(i.sections.map((s) => `${s.keyword} ${s.title}`)).toEqual(['node API gateway', 'param Gateway instances'])
    const f = fieldsOf(checkout, { node: 'gateway' })
    expect(f.get('node:gateway/@label')).toMatchObject({ kind: 'text', value: 'API gateway', more: false })
    expect(f.get('node:gateway/capacity')).toMatchObject({
      kind: 'capacity',
      provenance: 'estimated',
      value: [{ slot: 0, value: 20_000 }, ' * gateways'],
      within: 30,
      percent: true,
      unit: 'req/s',
      source: 'vendor benchmark, not load-tested',
      more: false,
    })
    expect(f.get('node:gateway/over')).toMatchObject({ kind: 'text', more: true })
    expect(f.get('param:gateways/options')).toMatchObject({ kind: 'options', value: [1, 2] })
    expect(f.get('param:gateways/default')).toMatchObject({ kind: 'choice', value: 1, choices: [1, 2] })
  })

  it('shows a stage, a template label read-only, and parameters read through a let', () => {
    const f = fieldsOf(checkout, { node: 'workers' })
    expect(f.get('pool:workers/@sub')).toMatchObject({
      kind: 'formula',
      parts: ['`${pods} pods × ${threads} threads`'],
    })
    expect(f.get('pool:workers/workers/perPod')).toMatchObject({ kind: 'formula', parts: ['threads'] })
    expect([...f.keys()].filter((k) => k.endsWith('/options'))).toEqual(['param:pods/options', 'param:threads/options'])
    const uploads = fieldsOf(read('apps/docs/site/uploads.loadmap'), { node: 'resizers' })
    // demand: flows.photos * files * 0.005, and files = webp ? 6 : 3
    expect(uploads.has('param:webp/default')).toBe(true)
  })

  it('shows the model: title, load, growth, parameters and flows', () => {
    const i = inspect(checkout, 'model')!
    expect(i.title).toBe('Checkout pipeline')
    expect(i.sections.map((s) => s.keyword)).toEqual([
      '',
      'load',
      'param',
      'param',
      'param',
      'param',
      'param',
      'growth',
      'fit',
      'flow',
      'flow',
      'drop',
    ])
    const f = fieldsOf(checkout, 'model')
    expect(f.get('flow:orders/rate')).toMatchObject({ kind: 'formula', parts: [{ slot: 0, value: 40 }, ' * load'] })
    expect(f.get('growth/per')).toMatchObject({ kind: 'choice', value: 'month', choices: ['month', 'year'] })
    expect(f.get('param:batch/default')).toMatchObject({ kind: 'boolean', value: true })
  })

  it('covers the building blocks', () => {
    const cache = fieldsOf(read('packages/editor/src/templates/cache.loadmap'), { node: 'cache' })
    expect(cache.get('node:cache/cache/hit')).toMatchObject({ kind: 'formula', parts: ['hit'], more: false })
    expect(cache.get('param:hit/options')).toMatchObject({ kind: 'options' })
    const api = fieldsOf(read('packages/editor/src/templates/autoscale.loadmap'), { node: 'api' })
    expect(api.get('pool:api/workers/perPod')).toMatchObject({ kind: 'number', value: 4, more: false })
    expect(api.get('pool:api/workers/autoscale/min')).toMatchObject({ kind: 'number', value: 2, more: false })
    const limiter = fieldsOf(read('packages/editor/src/templates/rate-limit.loadmap'), { node: 'limiter' })
    expect(limiter.get('node:limiter/capacity')).toMatchObject({
      kind: 'capacity',
      provenance: 'configured',
      within: null,
    })
    const retry = fieldsOf(read('packages/editor/src/templates/retry-storm.loadmap'), 'model')
    expect(retry.get('flow:requests/retry/times')).toMatchObject({ kind: 'formula', parts: ['retries'], more: false })
  })

  it('tells sections apart by their place, also two flows with the same rule', () => {
    const src = mini(
      'flow g { rate: load; route: b; from: a; retry { times: 3 } }',
      'node a',
      'node b { pass; capacity: measured(9, "x"); over: "y" }',
    ).replace(
      'flow f { rate: load; route: b; from: a }',
      'flow f { rate: load; route: b; from: a; retry { times: 2 } }',
    )
    const paths = inspect(src, 'model')!.sections.map((s) => s.path)
    expect(paths.filter((p) => p.endsWith('/retry'))).toEqual(['flow:f/retry', 'flow:g/retry'])
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('finds nothing in a text with a syntax error, or for a box that is not there', () => {
    expect(inspect('node a {', { node: 'a' })).toBeNull()
    expect(inspect(checkout, { node: 'nope' })).toBeNull()
  })
})

describe('edit', () => {
  it('changes a number of a formula, written as the text writes numbers', () => {
    expect(diff(checkout, 'node:gateway/capacity#0', 25_000)).toEqual([
      '-  capacity: estimated(20_000 * gateways ± 30%, "req/s", "vendor benchmark, not load-tested")',
      '+  capacity: estimated(25_000 * gateways ± 30%, "req/s", "vendor benchmark, not load-tested")',
    ])
    expect(diff(checkout, 'flow:orders/rate#0', 52.5)).toEqual(['-  rate: 40 * load', '+  rate: 52.5 * load'])
    expect(diff(checkout, 'pool:workers/capacity#0', -1)[1]).toBe(
      '+  capacity: measured(pods * (-1), "cores", "pod CPU limit")',
    )
  })

  it('changes a label in its own quotes, escaped', () => {
    expect(diff(checkout, 'node:gateway/@label', 'Edge "v2" \\ west')).toEqual([
      '-node gateway "API gateway" {',
      '+node gateway "Edge \\"v2\\" \\\\ west" {',
    ])
    const after = edit(checkout, 'node:gateway/@label', 'Edge "v2" \\ west')
    expect('source' in after && fieldsOf(after.source, { node: 'gateway' }).get('node:gateway/@label')).toMatchObject({
      value: 'Edge "v2" \\ west',
    })
    const single = mini("node a 'A' { sub: 'x' }", 'node b { pass; capacity: measured(9, "x"); over: "y" }')
    expect(diff(single, 'node:a/@label', "it's")).toEqual(["-node a 'A' { sub: 'x' }", "+node a 'it\\'s' { sub: 'x' }"])
  })

  it('writes a label on a box that has none, after its id', () => {
    const src = mini('node a', 'node b { pass; capacity: measured(9, "x"); over: "y" }')
    expect(diff(src, 'node:a/@label', 'Apps')).toEqual(['-node a', '+node a "Apps"'])
  })

  it('takes a ± out, puts one in, and makes a configured capacity exact', () => {
    expect(diff(checkout, 'node:gateway/capacity.within', null)[1]).toBe(
      '+  capacity: estimated(20_000 * gateways, "req/s", "vendor benchmark, not load-tested")',
    )
    expect(diff(checkout, 'node:gateway/capacity.within', 50)[1]).toBe(
      '+  capacity: estimated(20_000 * gateways ± 50%, "req/s", "vendor benchmark, not load-tested")',
    )
    expect(diff(checkout, 'pool:workers/capacity.within', 10)).toEqual([
      '-  capacity: measured(pods * 2, "cores", "pod CPU limit")',
      '+  capacity: measured(pods * 2 ± 10%, "cores", "pod CPU limit")',
    ])
    expect(diff(checkout, 'node:gateway/capacity.provenance', 'configured')[1]).toBe(
      '+  capacity: configured(20_000 * gateways, "req/s", "vendor benchmark, not load-tested")',
    )
    const limit = read('packages/editor/src/templates/rate-limit.loadmap')
    expect(refused(limit, 'node:limiter/capacity.within', 10)).toBe('a configured capacity is exact: it takes no ±')
  })

  it('changes the unit and the source, and adds or takes out a source', () => {
    expect(diff(checkout, 'node:db/capacity.unit', 'tx/s')).toEqual([
      '-  capacity: estimated(4_000 ± 30%, "commits/s")',
      '+  capacity: estimated(4_000 ± 30%, "tx/s")',
    ])
    expect(diff(checkout, 'node:db/capacity.source', 'pgbench')[1]).toBe(
      '+  capacity: estimated(4_000 ± 30%, "commits/s", "pgbench")',
    )
    expect(diff(checkout, 'node:gateway/capacity.source', null)[1]).toBe(
      '+  capacity: estimated(20_000 * gateways ± 30%, "req/s")',
    )
  })

  it('changes options, moving a default that is no longer one of them', () => {
    expect(diff(checkout, 'param:rows/options', [20, 100])).toEqual([
      '-param rows "Rows per batch" { options: [10, 50]; default: 50; enabled: batch }',
      '+param rows "Rows per batch" { options: [20, 100]; default: 20; enabled: batch }',
    ])
    expect(diff(checkout, 'param:threads/options', [4, 8, 32])).toEqual([
      '-param threads "Threads per pod" { options: [4, 8, 16]; default: 8 }',
      '+param threads "Threads per pod" { options: [4, 8, 32]; default: 8 }',
    ])
    // a scenario and a preset still use 6 pods
    expect(refused(checkout, 'param:pods/options', [2, 4, 8])).toBe('6 is not an option of "pods"')
    expect(refused(checkout, 'param:pods/options', [])).toBe('at least one option')
  })

  it('changes a default, a switch, an enum and the numbers of the model', () => {
    expect(diff(checkout, 'param:pods/default', 4)[1]).toBe(
      '+param pods "Worker pods" { options: [2, 3, 4, 6]; default: 4 }',
    )
    expect(refused(checkout, 'param:pods/default', 5)).toBe('one of the options')
    expect(diff(checkout, 'param:batch/default', false)[1]).toBe('+param batch "Batch DB writes" { default: false }')
    expect(diff(checkout, 'growth/per', 'year')[1]).toBe('+growth { rate: 0.06; per: year; asOf: "2026-11-01" }')
    expect(diff(checkout, 'load/max', 200)[1]).toBe('+load "Users, × today" { max: 200; default: 10 }')
    expect(diff(checkout, '/title', 'Checkout')).toEqual(['-title: "Checkout pipeline"', '+title: "Checkout"'])
  })

  it('changes the building blocks', () => {
    const api = read('packages/editor/src/templates/autoscale.loadmap')
    expect(diff(api, 'pool:api/workers/autoscale/min', 3)).toEqual([
      '-  workers { perPod: 4; autoscale { min: 2; max: maxPods; target: scaleAt } }',
      '+  workers { perPod: 4; autoscale { min: 3; max: maxPods; target: scaleAt } }',
    ])
    const limit = read('packages/editor/src/templates/rate-limit.loadmap')
    expect(diff(limit, 'node:limiter/capacity.unit', 'calls/s')[1]).toBe(
      '+  capacity: configured(limit, "calls/s", "gateway config")',
    )
  })

  it('writes a text in parentheses in its own quotes', () => {
    const src = checkout.replace('short: "the API gateway"', 'short: ("the API gateway")')
    expect(diff(src, 'node:gateway/short', 'the gate')).toEqual([
      '-  short: ("the API gateway")',
      '+  short: "the gate"',
    ])
  })

  it('refuses only the errors an edit brings, not one the text already had', () => {
    const src = checkout.replace('demand: flows.orders + flows.events', 'demand: flows.orders + flows.evnts')
    expect(diff(src, '/title', 'Checkout')).toEqual(['-title: "Checkout pipeline"', '+title: "Checkout"'])
    expect(refused(src, 'param:pods/options', [2, 4, 8])).toBe('6 is not an option of "pods"')
  })

  it('refuses what does not fit, and what would break the definition', () => {
    expect(refused(checkout, 'node:gateway/@label', 3)).toBe('a text')
    expect(refused(checkout, 'load/max', Number.NaN)).toBe('a number')
    expect(refused(checkout, 'node:gateway/demand', 3)).toBe(
      'a formula: change its numbers, or the formula in the text',
    )
    expect(refused(checkout, 'node:gateway/demand#0', 3)).toBe('the formula has no number #0')
    expect(refused(checkout, 'node:nope/@label', 'x')).toBe('nothing to change at "node:nope/@label"')
    expect(refused('node a {', 'node:a/@label', 'x')).toBe('the text has a syntax error')
    expect(refused(checkout, 'load/max', 0)).toBe('the load goes from 1 to 0')
  })

  it.each(files)(
    '%s: every field set to its own value leaves the text as it is',
    (f) => {
      const src = read(f)
      expect(compile(src).ok).toBe(true)
      const boxes = compile(src).definition!.view.def.nodes as Record<string, unknown>
      const targets = [...Object.keys(boxes).map((node) => ({ node })), 'model' as const]
      let n = 0
      for (const t of targets)
        for (const s of inspect(src, t)?.sections ?? [])
          for (const fl of s.fields) {
            const same: [string, EditValue][] = []
            if (fl.kind === 'formula' || fl.kind === 'capacity')
              for (const p of fl.kind === 'formula' ? fl.parts : fl.value)
                if (typeof p !== 'string') same.push([`${fl.key}#${p.slot}`, p.value])
            if (fl.kind === 'capacity') {
              same.push(
                [`${fl.key}.provenance`, fl.provenance],
                [`${fl.key}.unit`, fl.unit],
                [`${fl.key}.source`, fl.source],
              )
              if (typeof fl.within === 'number') same.push([`${fl.key}.within`, fl.within])
            } else if (fl.kind !== 'formula') same.push([fl.key, fl.value])
            for (const [k, v] of same) {
              const r = edit(src, k, v)
              expect(r, k).toMatchObject({ source: src })
              n++
            }
          }
      expect(n).toBeGreaterThan(10)
      // a compile a field: docs/every-statement.loadmap, with every statement, has the most fields by far
    },
    90_000,
  )
})
