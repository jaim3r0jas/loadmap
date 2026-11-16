import { readdirSync, readFileSync } from 'node:fs'
import {
  cache,
  configured,
  defineModel,
  estimated,
  limit,
  lost,
  type Model,
  measured,
  p,
  pass,
  queue,
  store,
  workers,
} from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { compile, type Diagnostic } from '../src'
import { failure, placed } from '../src/expr'
import { pageOptions } from '../src/internal'

/** A small valid definition; `top` goes after the header, `flow` inside the flow, `extra` at the end. */
const def = (o: { top?: string; flow?: string; api?: string; extra?: string } = {}) => `loadmap 1.1
${o.top ?? ''}
load { max: 10; default: 2 }
param pods "Pods" { options: [1, 2, 3]; default: 2 }
param fast "Fast path" { default: false }
flow req "requests" {
  unit: "request"
  rate: 100 * load
  route: api
  from: client
${o.flow ?? ''}
}
node client "Client"
node api "API" {
  pass
  demand: flows.req
  capacity: ${o.api ?? 'measured(pods * 400, "req/s", "load test")'}
  over: "requests fail"
}
client -> api
${o.extra ?? ''}`

const errors = (src: string) =>
  compile(src)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => ({ message: d.message, hint: d.hint, text: src.slice(d.from, d.to) }))

/** The value of `let x = …`, at the given values. */
function value(formula: string, values: Record<string, number | boolean> = {}, lets = '') {
  const r = compile(def({ top: `${lets}\nlet x = ${formula}` }))
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return r.definition!.model.evaluate(values).ctx.derived.x
}

describe('compile', () => {
  it('builds a model and a view', () => {
    const r = compile(def())
    expect(r.ok).toBe(true)
    const ev = r.definition!.model.evaluate({ load: 7 })
    expect(ev.flows.req).toBe(700)
    expect(ev.components.api!.util).toBeCloseTo(700 / 800)
    expect(ev.verdict.text).toBe(
      'At 7×, everything still fits, but API runs above the 50 % target. The 50 % target holds up to 4×, limited by API.',
    )
    expect(r.definition!.view.def.edges).toEqual([{ from: 'client', to: 'api' }])
    expect(r.symbols.map((s) => `${s.kind}:${s.id}`)).toEqual([
      'param:pods',
      'param:fast',
      'flow:req',
      'node:client',
      'node:api',
      'stage:api',
      'component:api',
    ])
  })

  it('reads the options of the page', () => {
    const r = compile(def({ top: 'title: "T"\ndirection: down\nspeed: 4\ntransition: 1.2\nassume: "a"\nassume: "b"' }))
    expect(r.definition!.options).toEqual({ direction: 'DOWN', speed: 4, transition: 1.2, assumptions: ['a', 'b'] })
    expect(r.definition!.model.title).toBe('T')
  })

  it('lays out compact unless it says stable, and names a wrong word', () => {
    expect(compile(def({})).definition!.view.def.layout).toBeUndefined()
    expect(compile(def({ top: 'layout: stable' })).definition!.view.def.layout).toBe('stable')
    expect(compile(def({ top: 'layout: "compact"' })).definition!.view.def.layout).toBe('compact')
    expect(errors(def({ top: 'layout: stabel' }))).toEqual([
      expect.objectContaining({ message: '"stabel" is not one of compact, stable', text: 'stabel' }),
    ])
  })

  it('still reads the direction under its old name, layout, and says what to write instead', () => {
    const r = compile(def({ top: 'layout: down' }))
    expect(r.definition!.options.direction).toBe('DOWN')
    expect(r.definition!.view.def.layout).toBeUndefined()
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'layout: down is now direction: down',
        hint: 'loadmap fmt rewrites it',
      }),
    ])
    const both = compile(def({ top: 'direction: right\nlayout: down' }))
    expect(both.definition!.options.direction).toBe('RIGHT')
    expect(both.diagnostics.map((d) => d.message)).toEqual(['layout: down is ignored: direction sets the direction'])
  })

  it('reads an overloaded word under its old name: a warning from 1.1, the spelling of 1.0', () => {
    const old = 'expect "keeps 3×" { target: 3 }\nexpect { component: api; full: 9 }'
    const r = compile(def({ top: old }))
    expect(r.definition!.model.expectations).toEqual([
      { label: 'keeps 3×', underTarget: 3 },
      { component: 'api', notFull: 9 },
    ])
    expect(r.diagnostics.map((d) => ({ code: d.code, message: d.message, hint: d.hint, data: d.data }))).toEqual([
      {
        code: 'deprecated',
        message: 'target is now underTarget',
        hint: 'loadmap fmt rewrites it',
        data: { to: 'underTarget' },
      },
      { code: 'deprecated', message: 'full is now notFull', hint: 'loadmap fmt rewrites it', data: { to: 'notFull' } },
    ])
    // in a definition of 1.0 the old name is the only one: nothing to say, and the new one is from 1.1
    const v1 = (top: string) => def({ top }).replace('loadmap 1.1', 'loadmap 1')
    expect(compile(v1(old)).diagnostics).toEqual([])
    expect(compile(v1(old)).definition!.model.expectations).toEqual(r.definition!.model.expectations)
    expect(errors(v1('expect { underTarget: 3 }'))).toEqual([
      expect.objectContaining({ message: '"underTarget:" is from loadmap 1.1; this definition says loadmap 1' }),
    ])
    expect(errors(v1('expect { target: 0 }'))).toEqual([
      expect.objectContaining({ message: 'target is a load multiple above 0' }),
    ])
    expect(errors(v1('expect "nothing" {}'))).toEqual([
      expect.objectContaining({ message: 'an expect needs a target or a full multiple', hint: 'expect { target: 8 }' }),
    ])
    // both names are one property: that error, and no rename that would set it twice
    expect(compile(def({ top: 'expect { target: 3; underTarget: 4 }' })).diagnostics.map((d) => d.code)).toEqual([
      'duplicate',
    ])
    expect(errors(def({ top: 'expect { target: 3; underTarget: 4 }' }))).toEqual([
      expect.objectContaining({
        message: '"target" and "underTarget" are one property in expect',
        text: 'underTarget',
      }),
    ])
  })

  it('takes a transition of 0 to 5 seconds: a shared link cannot ask for a move that never ends', () => {
    expect(compile(def({ top: 'transition: 0' })).definition!.options.transition).toBe(0)
    expect(errors(def({ top: 'transition: 600' }))).toEqual([
      expect.objectContaining({ message: 'transition is 600 seconds; 0 to 5', text: '600' }),
    ])
  })

  it('reads the panels full screen shows, and names a wrong one', () => {
    const r = compile(def({ top: 'fullScreen: [verdict, "controls", headroom]' }))
    expect(r.definition!.options.fullScreen).toEqual(['verdict', 'controls', 'headroom'])
    expect(compile(def({ top: 'fullScreen: []' })).definition!.options.fullScreen).toEqual([])
    expect(errors(def({ top: 'fullScreen: [verdict, contrls]' }))).toEqual([
      {
        message: '"contrls" is not one of verdict, live, limits, controls, headroom, compare, assumptions',
        hint: 'did you mean "controls"?',
        text: 'contrls',
      },
    ])
    expect(errors(def({ top: 'fullScreen: verdict' }))[0]).toMatchObject({ message: 'a list: [verdict, live]' })
  })

  it('reads what full screen opens with, and names a wrong one', () => {
    expect(compile(def({ top: 'fullScreenMode: focus' })).definition!.options.fullScreenMode).toBe('focus')
    expect(pageOptions(compile(def({ top: 'fullScreenMode: panels' })).definition!.options)).toMatchObject({
      fullScreenMode: 'panels',
    })
    expect(pageOptions(compile(def({})).definition!.options)).not.toHaveProperty('fullScreenMode')
    expect(errors(def({ top: 'fullScreenMode: focs' }))[0]).toMatchObject({ hint: 'did you mean "focus"?' })
  })

  it('compiles every example and the starter without a warning', () => {
    const dir = new URL('../../../examples/', import.meta.url)
    for (const ex of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()))
      for (const f of readdirSync(new URL(`${ex.name}/`, dir)).filter((f) => f.endsWith('.loadmap')))
        expect(compile(readFileSync(new URL(`${ex.name}/${f}`, dir), 'utf8')).diagnostics, f).toEqual([])
    const starter = new URL('../../../apps/docs/site/uploads.loadmap', import.meta.url)
    expect(compile(readFileSync(starter, 'utf8')).diagnostics).toEqual([])
  })
})

describe('tiers', () => {
  it('compile to the view in their order, each box in the one it names', () => {
    const src = def({ top: 'tier app "Services"\ntier data', api: 'measured(400, "req/s")' }).replace(
      'node api "API" {',
      'node api "API" {\n  tier: app',
    )
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const v = r.definition!.view.def
    expect(v.tiers).toEqual({ app: { label: 'Services' }, data: { label: 'data' } })
    expect(Object.keys(v.tiers!)).toEqual(['app', 'data'])
    expect((v.nodes as Record<string, { tier?: string }>).api!.tier).toBe('app')
    expect((v.nodes as Record<string, { tier?: string }>).client!.tier).toBeUndefined()
  })

  it('name a tier nobody declared, and one declared twice', () => {
    const src = def({ top: 'tier app "Services"' }).replace('node api "API" {', 'node api "API" {\n  tier: ap')
    expect(errors(src)).toMatchObject([{ message: 'unknown tier "ap"', hint: 'did you mean "app"?', text: 'ap' }])
    expect(errors(def({ top: 'tier app\ntier app' }))).toMatchObject([{ message: '"app" is declared twice' }])
  })

  it("take a fill of their own, a lanes style and the editor's grid", () => {
    const src = def({
      top: 'lanes: striped\ngrid: false\ntier app "Services" { fill: "#e6f2ec"; fillDark: "#1c2b26" }',
    })
    const d = compile(src).definition!
    expect(d.view.def.tiers).toEqual({ app: { label: 'Services', fill: '#e6f2ec', fillDark: '#1c2b26' } })
    expect(d.view.def.lanes).toBe('striped')
    expect(d.options.grid).toBe(false)
    // only the editor reads the grid: <Loadmap> never sees it
    expect(pageOptions(d.options)).not.toHaveProperty('grid')
  })

  it('refuse a fill that is not a colour, and take a dark one alone', () => {
    expect(errors(def({ top: 'tier app { fill: "url(https://example.com/x)" }' }))).toMatchObject([
      { message: '"url(https://example.com/x)" is not a colour', text: '"url(https://example.com/x)"' },
    ])
    // only whole colours: one a browser cannot read draws the lane black
    for (const c of ['#12345', '#1234567', 'rgb(1)', 'rgb( )', 'hsl(,,)', 'accent'])
      expect(errors(def({ top: `tier app { fill: "${c}" }` })).map((e) => e.message)).toEqual([
        `"${c}" is not a colour`,
      ])
    for (const c of [
      '#abc',
      '#abcd',
      '#aabbcc',
      '#aabbccdd',
      'rgb(1, 2, 3)',
      'rgb(1 2 3 / 50%)',
      'hsla(120, 50%, 40%, 0.5)',
    ])
      expect(errors(def({ top: `tier app { fill: "${c}" }` }))).toEqual([])
    expect(compile(def({ top: 'tier app { fillDark: "#000" }' })).definition!.view.def.tiers).toEqual({
      app: { label: 'app', fillDark: '#000' },
    })
    expect(errors(def({ top: 'lanes: dotted' }))).toMatchObject([{ text: 'dotted' }])
  })

  it('warn about an edge that runs back to an earlier tier', () => {
    const src = def({ top: 'tier front\ntier back' })
      .replace('node client "Client"', 'node client "Client" { tier: back }')
      .replace('node api "API" {', 'node api "API" {\n  tier: front')
    const warnings = compile(src).diagnostics.filter((d) => d.severity === 'warning')
    expect(warnings.map((d) => [d.message, src.slice(d.from, d.to)])).toEqual([
      ['client -> api runs back from the tier "back" to "front"', 'api'],
    ])
  })
})

describe('units', () => {
  // a timeout's losses no lost box counts warn too: not what these tests look at
  const warnings = (src: string) =>
    compile(src)
      .diagnostics.filter((d) => d.severity === 'warning' && !d.message.startsWith('units of'))
      .map((d) => ({ message: d.message, text: src.slice(d.from, d.to) }))
  /** The small definition with the API's demand line and capacity replaced. */
  const api = (demand: string, capacity: string, o: Parameters<typeof def>[0] = {}) =>
    def({ ...o, api: capacity }).replace('  demand: flows.req\n', demand ? `  demand: ${demand}\n` : '')

  it('warn where a demand per second meets a capacity that counts something, and the reverse', () => {
    expect(warnings(api('flows.req', 'measured(4, "cores")'))).toEqual([
      { message: 'the demand is per second, the capacity in "cores"', text: 'flows.req' },
    ])
    expect(warnings(api('flows.req * 2ms', 'measured(400, "req/s")'))).toEqual([
      {
        message: 'the demand is a plain number (a share or a count), the capacity in "req/s"',
        text: 'flows.req * 2ms',
      },
    ])
    // requests a second times CPU seconds each: cores
    expect(warnings(api('flows.req * 2ms', 'measured(4, "cores")'))).toEqual([])
    expect(warnings(api('flows.req * 80%', 'measured(400, "req/s")'))).toEqual([])
  })

  it('say nothing where a bare number hides the unit: every definition from before compiles as it did', () => {
    // the review's c11: 0.002 may be seconds
    expect(warnings(api('flows.req * 0.002', 'estimated(1000, "req/s")'))).toEqual([])
    expect(warnings(api('flows.req / pods', 'measured(4, "cores")'))).toEqual([])
    // one a second at 1×
    expect(warnings(def({ flow: 'rate: load' }).replace('  rate: 100 * load\n', ''))).toEqual([])
    // a rate however it is spelled
    for (const unit of ['rps', 'req/sec', 'requests per second', 'Mbps'])
      expect(warnings(api('flows.req', `measured(400, "${unit}")`)), unit).toEqual([])
    expect(warnings(api('', 'measured(400, "qps")'))).toEqual([])
  })

  it('read a fit\'s y and a demand\'s "as", and compare counts by their word', () => {
    const fit = 'fit cpu "CPU" { points rate cores {\n 1 3\n 2 5\n } }'
    expect(warnings(api('cpu(flows.req)', 'measured(4, "cores")', { top: fit }))).toEqual([])
    expect(warnings(api('cpu(flows.req)', 'measured(4, "connections")', { top: fit }))).toEqual([
      { message: 'the demand is in "cores", the capacity in "connections"', text: 'cpu(flows.req)' },
    ])
    expect(warnings(api('flows.req * 0.002 as "cores"', 'measured(4, "core")'))).toEqual([])
    // a y that names a time or a rate is not a count
    for (const y of ['cpu_seconds', 'rps', 'p99', 'latency']) {
      const timed = fit.replace('rate cores', `rate ${y}`)
      expect(warnings(api('cpu(flows.req)', 'measured(4, "cores")', { top: timed })), y).toEqual([])
    }
    expect(warnings(api('flows.req * 0.002 as "cores"', 'measured(4, "connections")'))).toEqual([
      { message: 'the demand is in "cores", the capacity in "connections"', text: '"cores"' },
    ])
    expect(warnings(api('flows.req as "cores"', 'measured(4, "cores")'))).toEqual([
      { message: '"as" says "cores", but the formula is per second', text: '"cores"' },
    ])
    // a let carries its formula's unit
    expect(warnings(api('perReq * flows.req', 'measured(4, "cores")', { top: 'let perReq = 2ms' }))).toEqual([])
    expect(warnings(api('perReq', 'measured(400, "req/s")', { top: 'let perReq = flows.req * 2ms' }))).toHaveLength(1)
  })

  it('warn where no demand line leaves a count against the units a second, and at an empty unit', () => {
    expect(warnings(api('', 'measured(4, "cores")'))).toEqual([
      {
        message: 'without a demand line the demand is what reaches its stages, per second; the capacity is in "cores"',
        text: 'measured(4, "cores")',
      },
    ])
    expect(warnings(api('', 'measured(400, "req/s")'))).toEqual([])
    expect(warnings(api('flows.req', 'measured(400, "")'))).toEqual([
      { message: "a capacity's unit is empty", text: '""' },
    ])
    // a held component counts slots
    const held = (unit: string) =>
      api('', `measured(200, "${unit}")`).replace('  capacity:', '  held: 20ms\n  capacity:')
    expect(warnings(held('connections'))).toEqual([])
    expect(warnings(held('req/s'))).toEqual([
      {
        message: 'a held component\'s demand is the slots in use, a count; the capacity is in "req/s"',
        text: 'measured(200, "req/s")',
      },
    ])
  })

  it('warn where a property in seconds, a share or units a second gets another unit', () => {
    expect(warnings(def({ flow: 'timeout: 80%', api: 'measured(400, "req/s")\n  service: flows.req' }))).toEqual([
      { message: 'timeout is in seconds, and this is a share', text: '80%' },
      { message: 'service is in seconds, and this is per second', text: 'flows.req' },
    ])
    expect(warnings(def({ top: 'thresholds { target: 5s }' }))).toEqual([
      { message: 'target is a share, and this is in seconds', text: '5s' },
    ])
    expect(warnings(def({ flow: 'timeout: 2s', api: 'measured(400, "req/s")\n  service: 10ms' }))).toEqual([])
  })

  it('refuse a share where a load multiple goes, and a multiple where a share goes, from loadmap 1.2', () => {
    const at = (version: string, extra: string) =>
      compile(def({ extra }).replace('loadmap 1.1', `loadmap ${version}`))
        .diagnostics.filter((d) => d.code === 'unit-mismatch')
        .map((d) => ({ severity: d.severity, message: d.message, hint: d.hint }))
    const multiple = "write a multiple of today's load: 7×; a utilization goes in thresholds { target: … }"
    const share = 'write a share: 0.8 or 80%; a load multiple goes in expect { underTarget: … }'
    expect(at('1.2', 'expect "x" { underTarget: 70% }')).toEqual([
      { severity: 'error', message: 'underTarget is a load multiple, and this is a share', hint: multiple },
    ])
    expect(at('1.2', 'expect "x" { notFull: 50% }')).toEqual([
      { severity: 'error', message: 'notFull is a load multiple, and this is a share', hint: multiple },
    ])
    expect(at('1.2', 'thresholds { target: 7× }')).toEqual([
      { severity: 'error', message: 'target is a share, and this is a load multiple', hint: share },
    ])
    expect(at('1.2', 'preset "Peak" { load: 50% }\nstep "Up" { load: 50% }').map((d) => d.message)).toEqual([
      'load is a load multiple, and this is a share',
      'load is a load multiple, and this is a share',
    ])
    expect(at('1.2', 'load "Users" { max: 90% }').map((d) => d.message)).toEqual([
      'max is a load multiple, and this is a share',
    ])
    // a file stamped 1.1 compiled with them: a warning, and the same value as before
    expect(at('1.1', 'expect "x" { underTarget: 70% }')).toEqual([
      {
        severity: 'warning',
        message: 'underTarget is a load multiple, and this is a share (an error from loadmap 1.2)',
        hint: multiple,
      },
    ])
    expect(at('1.1', 'thresholds { target: 7× }')[0]?.severity).toBe('warning')
    // what each takes, a bare number as before
    expect(
      at(
        '1.2',
        'expect "x" { underTarget: 2×; notFull: 3 }\nthresholds { target: 60%; full: 0.9 }\npreset "P" { load: 4x }',
      ),
    ).toEqual([])
  })

  it('refuse a "%" glued to a number where it reads as the remainder, from loadmap 1.2', () => {
    const at = (version: string, top: string) =>
      compile(def({ top }).replace('loadmap 1.1', `loadmap ${version}`))
        .diagnostics.filter((d) => d.code === 'glued-percent')
        .map((d) => ({ severity: d.severity, message: d.message, hint: d.hint }))
    expect(at('1.2', 'let a = 30%+1')).toEqual([
      {
        severity: 'error',
        message: '"30%+1" is the remainder of 30 divided by +1, not a share',
        hint: 'write mod(30, +1), or 30% + 1 for the share',
      },
    ])
    expect(at('1.2', 'let a = 30%-pods')[0]?.hint).toBe('write mod(30, -pods), or 30% - pods for the share')
    expect(at('1.2', 'let a = 10%3\nlet b = 2 * 10% pods').map((d) => d.hint)).toEqual([
      'write mod(10, 3)',
      'write mod(2 * 10, pods)',
    ])
    // a file from before computes what it did, and is told
    expect(at('1.1', 'let a = 30%+1')).toEqual([
      {
        severity: 'warning',
        message: '"30%+1" is the remainder of 30 divided by +1, not a share (an error from loadmap 1.2)',
        hint: 'write mod(30, +1), or 30% + 1 for the share',
      },
    ])
    expect(value('30%+1')).toBe(0)
    // spelled as what it means, either way
    expect(at('1.2', 'let a = 30% + 1\nlet b = 30 % 7\nlet c = pods % 2\nlet d = mod(30, 7)')).toEqual([])
  })

  it('bring a demand written with a size to the size its capacity counts in', () => {
    const demand = (o: { api: string; demand: string; top?: string }) => {
      const src = def(o).replace('loadmap 1.1', 'loadmap 1.2').replace('demand: flows.req', `demand: ${o.demand}`)
      const r = compile(src)
      expect(r.diagnostics).toEqual([])
      return r.definition!.model.evaluate({}).components.api!.demand
    }
    const broker = (demand: string, unit = 'MB/s') => ({ demand, api: `estimated(20, "${unit}", "sizing guide")` })
    // 200 requests a second of 1.5 KB each are 0.3 MB a second
    expect(demand(broker('flows.req * 1.5KB'))).toBeCloseTo(0.3, 12)
    expect(demand(broker('flows.req * 1.5KB', 'KB/s'))).toBeCloseTo(300, 9)
    expect(demand(broker('flows.req * 0.0015MB + flows.req * 500KB / 1000', 'GB per second'))).toBeCloseTo(0.0004, 12)
    // through a let and a parameter's default
    expect(demand({ ...broker('flows.req * size'), top: 'let size = 1.5KB' })).toBeCloseTo(0.3, 12)
    expect(
      demand({ ...broker('flows.req * size'), top: 'param size "Size" { options: [1.5KB, 3KB]; default: 1.5KB }' }),
    ).toBeCloseTo(0.3, 12)
    // a size divided out is a plain number again, and a formula without one computes as it always did
    expect(demand(broker('flows.req * (3KB / 1.5KB)', 'req/s'))).toBe(400)
    expect(demand(broker('flows.req * 1.5 / 1000'))).toBeCloseTo(0.3, 12)
  })

  it('refuse a size its capacity cannot count, and a size mixed with a plain number', () => {
    const found = (api: string, demand = 'flows.req') =>
      compile(
        def({ api }).replace('loadmap 1.1', 'loadmap 1.2').replace('demand: flows.req', `demand: ${demand}`),
      ).diagnostics.map((d) => ({ severity: d.severity, message: d.message }))
    expect(found('estimated(400, "req/s", "x")', 'flows.req * 1.5KB')).toEqual([
      { severity: 'error', message: 'the demand is a size, in bytes; the capacity is in "req/s"' },
    ])
    // megabits are not megabytes
    expect(found('estimated(400, "Mb/s", "x")', 'flows.req * 1.5KB')[0]?.message).toBe(
      'the demand is a size, in bytes; the capacity is in "Mb/s"',
    )
    expect(found('estimated(20, "MB/s", "x")', 'flows.req * 1.5KB + 3')).toEqual([
      { severity: 'error', message: 'a size and a plain number are mixed here' },
    ])
    expect(found('estimated(20, "MB/s", "x")', 'flows.req * 1.5KB * 2KB')[0]?.message).toBe(
      'the demand multiplies sizes together: it counts no bytes',
    )
    expect(found('estimated(20MB, "MB/s", "x")')).toEqual([
      { severity: 'error', message: "a capacity's size goes in its unit" },
    ])
    expect(
      errors(def({ api: 'estimated(20, "MB/s", "x")' }).replace('demand: flows.req', 'demand: flows.req * 1.5KB')),
    ).toMatchObject([
      { message: 'a size (1.5KB, 20MB) is from loadmap 1.2; this definition says loadmap 1.1', text: '1.5KB' },
    ])
  })

  it('have mod(a, b) for the remainder, from loadmap 1.2', () => {
    const v12 = (top: string) => compile(def({ top }).replace('loadmap 1.1', 'loadmap 1.2'))
    expect(v12('let x = mod(7, 3) + mod(pods, 2)').definition!.model.evaluate({}).ctx.derived.x).toBe(1)
    expect(errors(def({ top: 'let x = mod(7, 3)' }))).toMatchObject([
      { message: 'mod(a, b) is from loadmap 1.2; this definition says loadmap 1.1', text: 'mod' },
    ])
    // the name was free before 1.2: a file that took it keeps it, and is told
    const old = compile(def({ top: 'let mod = 3\nlet x = mod + 1' }))
    expect(old.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(old.diagnostics.map((d) => d.message)).toContain(
      '"mod" is a reserved name; pick another (an error from loadmap 1.2)',
    )
    expect(old.definition!.model.evaluate({}).ctx.derived.x).toBe(4)
    expect(v12('let mod = 3').diagnostics.map((d) => d.severity)).toEqual(['error'])
  })

  it('warn about an id that names two kinds of thing, or is also a keyword', () => {
    const found = (o: Parameters<typeof def>[0]) =>
      compile(def(o))
        .diagnostics.filter((d) => d.code === 'shadowed-name')
        .map((d) => ({ severity: d.severity, message: d.message, hint: d.hint, line: d.line }))
    // a parameter beside a box: ${api} reads one, focus: api the other
    expect(found({ top: 'param api "Pods" { options: [1, 2]; default: 1 }' })).toEqual([
      {
        severity: 'warning',
        message: '"api" is already a parameter (line 2)',
        hint: 'give the box its own id, or rename the parameter',
        line: 14,
      },
    ])
    expect(found({ top: 'let req = 2' }).map((d) => d.message)).toEqual(['"req" is already a let (line 2)'])
    expect(found({ extra: 'tier api "Tier"' }).map((d) => d.message)).toEqual(['"api" is already a box (line 14)'])
    // a keyword as an id: a parameter, and a box
    expect(found({ top: 'param store "Keep" { default: true }' })).toEqual([
      {
        severity: 'warning',
        message: '"store" is also a keyword of the language',
        hint: 'pick an id that is no statement: storeTier, mainStore',
        line: 2,
      },
    ])
    expect(
      found({ extra: 'node cache "Cache" { cache { hit: 0.5 }; capacity: estimated(9, "ops/s"); over: "x" }' }),
    ).toHaveLength(1)
    // a box, its stage and its component are one thing; so are two parameters' labels
    expect(found({})).toEqual([])
    expect(found({ extra: 'node q "Q" { queue q "topic" }\nclient -> q' })).toEqual([])
    // a stage named after another box is two things
    expect(found({ extra: 'node other "Other" { pass client }' }).map((d) => d.message)).toEqual([
      '"client" is already a box (line 13)',
    ])
  })

  it('make a box like another: its lines and stages, but the ones written here', () => {
    const twin = (extra: string, version = '1.2') =>
      compile(def({ extra }).replace('loadmap 1.1', `loadmap ${version}`))
    const r = twin('node api2 "API 2" { like: api; over: "the second fails" }\nclient -> api2')
    // no flow goes there yet: a warning at the stage it took, in the box it is like
    expect(r.diagnostics.map((d) => d.message)).toEqual(['no flow passes the stage "api2"'])
    const ev = r.definition!.model.evaluate({})
    // the same capacity, by the same formula; its own over, and nothing reaches it yet
    expect(ev.components.api2!.capacity).toEqual(ev.components.api!.capacity)
    expect(ev.components.api2!.over).toBe('the second fails')
    expect(ev.components.api!.over).toBe('requests fail')
    expect(Object.keys(ev.stages)).toEqual(['api', 'api2'])
    // through another box that is like one
    const chain = twin('node b "B" { like: api }\nnode c "C" { like: b; demand: 1 }\nclient -> b\nclient -> c')
    expect(chain.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(chain.definition!.model.evaluate({}).components.c!.demand).toBe(1)
    // a stage written here replaces the stage there
    const sink = twin('node end "End" { like: api; sink }\nclient -> end')
    expect(sink.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(sink.definition!.model.evaluate({}).stages.end).toMatchObject({ kind: 'sink' })
    const messages = (extra: string, version?: string) =>
      twin(extra, version)
        .diagnostics.filter((d) => d.severity === 'error')
        .map((d) => d.message)
    expect(messages('node b "B" { like: apy }')).toEqual(['unknown box "apy"'])
    expect(messages('node b "B" { like: b }')).toEqual(['a box cannot be like itself: b → b'])
    expect(messages('node b "B" { like: c }\nnode c "C" { like: b }')[0]).toBe('a box cannot be like itself: b → c → b')
    expect(messages('pool b "B" { like: api }')).toContain('a pool is like another pool: "api" is a node')
    expect(
      messages('node q "Q" { pass inner; capacity: measured(1, "x/s"); over: "x" }\nnode b "B" { like: q }'),
    ).toEqual(['"q" names its pass "inner": a box like it would declare "inner" again'])
    expect(messages('node b "B" { like: api }\nclient -> b', '1.1')).toEqual([
      '"like:" is from loadmap 1.2; this definition says loadmap 1.1',
    ])
  })

  it('read what a fan-out sends as out.<stage>', () => {
    const src = (demand: string, version = '1.2') => `loadmap ${version}
load { max: 10; default: 2 }
param copies "Copies" { options: [1, 3]; default: 3 }
flow a "alerts" { rate: 10 * load; route: push; from: client }
flow b "positions" { rate: 100 * load; route: push; from: client }
node client "Client"
node push "Push" {
  fanout { a -> phones: 1; a -> desks: 0.5; b -> phones: copies }
  demand: ${demand}
  capacity: estimated(5_000, "packets/s", "a guess")
  over: "pushes queue"
}
node phones "Phones" { sink }
node desks "Desks" { sink }
client -> push
push -> phones
push -> desks
`
    const r = compile(src('out.push'))
    expect(r.diagnostics).toEqual([])
    // 20 alerts × 1.5 copies + 200 positions × 3
    expect(r.definition!.model.evaluate({}).components.push!.demand).toBe(630)
    expect(r.definition!.model.evaluate({ copies: 1 }).components.push!.demand).toBe(230)
    const messages = (s: string) => compile(s).diagnostics.map((d) => d.message)
    expect(messages(src('out.phones'))).toEqual(['"phones" is no fan-out: out. is what a fan-out sends'])
    expect(messages(src('out.pusher'))).toEqual(['unknown fan-out "pusher"'])
    expect(messages(src('out.push', '1.1'))).toContain(
      'out.<stage>, what a fan-out sends is from loadmap 1.2; this definition says loadmap 1.1',
    )
    // a file from before may have the name
    const old = compile(src('flows.a', '1.1').replace('param copies', 'let out = 2\nparam copies'))
    expect(old.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('read a line that starts with a text as the text above it, continued', () => {
    const story = (lines: string, version = '1.2') =>
      compile(def({ extra: lines }).replace('loadmap 1.1', `loadmap ${version}`))
    const r = story('step "At 2×, the API "\n     "is half full." { load: 2 }')
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.story[0]!.text).toBe('At 2×, the API is half full.')
    // three pieces, and a property's text
    const three = story('step "a "\n  "b "\n  "c" { load: 2 }\nnode n "N" {\n  sub: "the "\n    "box"\n}')
    expect(three.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(three.definition!.model.story[0]!.text).toBe('a b c')
    // a blank line between them ends the statement, as anywhere
    expect(
      errors(def({ extra: 'step "a "\n\n  "b" { load: 2 }' }).replace('loadmap 1.1', 'loadmap 1.2'))[0]?.message,
    ).toBe('expected a statement, found a text')
    expect(errors(def({ extra: 'step "a "\n  "b" { load: 2 }' }))).toMatchObject([
      { message: 'a text continued on the next line is from loadmap 1.2; this definition says loadmap 1.1' },
    ])
  })

  it('take "as" on a demand only, with the unit in quotes', () => {
    const messages = (src: string) => errors(src).map((e) => e.message)
    expect(messages(api('flows.req', 'measured(400, "req/s") as "req/s"'))).toContain(
      '"as" says the unit of a demand only',
    )
    expect(messages(api('flows.req as cores', 'measured(400, "req/s")'))).toContain('"as" takes the unit in quotes')
    expect(messages(api('flows.req as " "', 'measured(400, "req/s")'))).toContain('"as" takes the unit in quotes')
  })

  it('read only the rates written as one word, and a word with "es" as its own plural', () => {
    // "groups" and "apps" end like "rps" but count something
    const held = (unit: string) =>
      api('', `measured(200, "${unit}")`).replace('  capacity:', '  held: 20ms\n  capacity:')
    expect(warnings(held('groups'))).toEqual([])
    expect(warnings(api('', 'measured(4, "apps")'))).toHaveLength(1)
    const fit = 'fit cpu "CPU" { points rate processes {\n 1 3\n 2 5\n } }'
    expect(warnings(api('cpu(flows.req)', 'measured(4, "process")', { top: fit }))).toEqual([])
    expect(warnings(api('cpu(flows.req)', 'measured(4, "boxes")', { top: fit }))).toHaveLength(1)
  })

  it("compare a fit's y with a count only: its word does not say whether it is a rate", () => {
    const fit = 'fit traffic "Traffic" { points hour orders {\n 1 30\n 2 50\n } }'
    expect(warnings(def({ top: fit, flow: 'rate: traffic(load)' }).replace('  rate: 100 * load\n', ''))).toEqual([])
    expect(warnings(api('traffic(load)', 'measured(400, "req/s")', { top: fit }))).toEqual([])
    expect(warnings(api('traffic(load)', 'measured(4, "cores")', { top: fit }))).toEqual([
      { message: 'the demand is in "orders", the capacity in "cores"', text: 'traffic(load)' },
    ])
  })

  it('work out each let once: a chain that reads every let twice must not take 2^n steps', () => {
    const lets = ['let l0 = flows.req', ...Array.from({ length: 40 }, (_, i) => `let l${i + 1} = l${i} + l${i}`)]
    expect(warnings(api('l40', 'measured(4, "cores")', { top: lets.join('\n') }))).toEqual([
      { message: 'the demand is per second, the capacity in "cores"', text: 'l40' },
    ])
  })

  it('hint at a per-minute capacity by converting it, not by a CPU time', () => {
    const [w] = compile(api('flows.req', 'measured(6000, "req/min")')).diagnostics.filter(
      (d) => d.severity === 'warning',
    )
    expect(w?.hint).toContain('per second')
  })
})

describe('formulas', () => {
  it('follow the precedence and meaning of TypeScript', () => {
    expect(value('1 + 2 * 3 - 4 / 2')).toBe(5)
    expect(value('(1 + 2) * 3 % 4')).toBe(1)
    expect(value('-2 * -3')).toBe(6)
    expect(value('pods > 1 && !fast ? 10 : 20')).toBe(10)
    expect(value('pods > 1 && !fast ? 10 : 20', { fast: true })).toBe(20)
    expect(value('pods === 2 ? 1 : 0')).toBe(1)
    expect(value('Math.max(1, pods * 3, 4)')).toBe(6)
    expect(value('min(pods, 1) + round(2.6) + floor(2.6) + ceil(2.1) + abs(-1) + pow(2, 3)')).toBe(18)
    expect(value('flows.req / 100')).toBe(2)
    expect(value('util.api * 2')).toBeCloseTo(0.5)
    expect(value('y * 2', {}, 'let y = pods + 1')).toBe(6)
    expect(value('derived.y', {}, 'let y = 4')).toBe(4)
  })

  it('read a unit after a number: durations in seconds, "%" as a share, × as it is', () => {
    expect(value('20ms')).toBe(0.02)
    expect(value('flows.req * 1.5ms')).toBe(0.3)
    expect(value('2min + 1h')).toBe(3720)
    expect(value('80% * 10')).toBe(8)
    expect(value('1 - 80%')).toBeCloseTo(0.2)
    expect(value('7×')).toBe(7)
    // modulo, where a value follows the "%"
    expect(value('10%3 + 10 % 4')).toBe(3)
    // a ± written with a unit means what it did
    const within = (api: string) => compile(def({ api })).definition!.model.evaluate().verdict.text
    expect(within('estimated(400 ± 30%, "req/s")')).toEqual(within('estimated(400 ± 30 %, "req/s")'))
    expect(within('estimated(400 ± (30%), "req/s")')).toEqual(within('estimated(400 ± 30%, "req/s")'))
    expect(within('estimated(400 ± 30%, "req/s")')).not.toEqual(within('estimated(400, "req/s")'))
    // the review's c21 and fable 28: a share in a formula, a timeout in seconds
    expect(errors(def({ api: 'estimated(1000 * 30%, "req/s")' }))).toEqual([])
    const timed = def({ flow: 'timeout: 5s', api: 'measured(400, "req/s")\n  service: 10ms' })
    expect(errors(timed)).toEqual([])
  })

  it('fill templates', () => {
    expect(value('`${pods} pods × ${compact(flows.req * 100)} = ${pct(0.5)}`')).toBe('2 pods × 20k = 50 %')
    expect(value('"plain"')).toBe('plain')
  })

  it('call the fits and the host functions', () => {
    const fit = 'fit cost "Cost" { points x y {\n 1 3\n 2 5\n 3 7\n } }'
    expect(value('cost(10)', {}, fit)).toBeCloseTo(21)
    const src = def({ top: 'let x = boost(pods)' })
    expect(errors(src)).toEqual([
      {
        message: 'unknown function "boost"',
        hint: 'a host page can provide it in compile(…, { functions })',
        text: 'boost',
      },
    ])
    const r = compile(src, { functions: { boost: (n: number) => n * 10 } })
    expect(r.definition!.model.evaluate().ctx.derived.x).toBe(20)
  })

  it('name nothing outside the definition', () => {
    for (const [formula, message] of [
      ['globalThis', 'unknown name "globalThis"'],
      ['constructor', 'unknown name "constructor"'],
      ['constructor(1)', 'unknown function "constructor"'],
      ['toString()', 'unknown function "toString"'],
      ['flows.constructor', 'unknown flow "constructor"'],
      ['flows.__proto__', 'unknown flow "__proto__"'],
      ['Math.constructor(1)', 'unknown function "constructor"'],
      ['window.alert(1)', '"window.alert(…)" is not a function'],
      ['x.y', '"x" has no entries: only flows., at., out., demand., util. and derived. do'],
      ['at.constructor.req', 'unknown stage "constructor"'],
      ['at.api.__proto__', 'unknown flow "__proto__"'],
      ['flows.req.x', 'only one "." is allowed: flows.orders, util.db'],
      ['eval(1)', 'unknown function "eval"'],
    ] as const)
      expect(errors(def({ top: `let x = ${formula}` }))[0]?.message, formula).toBe(message)
    expect(errors(def({ top: 'let __proto__ = 1' }))[0]?.message).toBe('"__proto__" cannot be used as a name')
    expect(errors(def({ top: 'param constructor "C" { default: true }' }))[0]?.message).toBe(
      '"constructor" cannot be used as a name',
    )
  })

  it('are built without eval or new Function', () => {
    for (const f of readdirSync(new URL('../src/', import.meta.url))) {
      const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/\beval\s*\(|new\s+Function|\bFunction\s*\(/)
    }
  })

  it('check their types', () => {
    expect(errors(def({ flow: 'priority: pods' }))).toMatchObject([
      { message: 'this value must be a constant; it cannot read a parameter', text: 'pods' },
    ])
    expect(errors(def({ top: 'let x = "a" * 2' }))).toMatchObject([
      { message: 'expected a number, this is a text', text: '"a"' },
    ])
    expect(errors(def({ top: 'let x = min()' }))[0]?.message).toBe('min() takes 1 to Infinity values, not 0')
    expect(errors(def({ top: 'let x = flows' }))[0]?.message).toBe(
      '"flows" is a table: name one of its entries, like flows.req',
    )
  })
})

describe('scenarios and growth', () => {
  it('compile to the model as TypeScript would write them', () => {
    const r = compile(
      def({
        top: 'scenario "Today" {}\nscenario "Faster" { pods: 3; fast: true }\ngrowth { rate: 1; per: year; asOf: "2026-11-01" }',
      }),
    )
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.scenarios).toEqual([
      { label: 'Today', values: { pods: 2, fast: false } },
      { label: 'Faster', values: { pods: 3, fast: true } },
    ])
    expect(m.growth).toEqual({ rate: 1, per: 'year', asOf: '2026-11-01' })
    // 800 req/s against 100 per 1×: 50 % at 4×, two years after 2026-11-01
    expect(m.evaluate({ load: 1 }).verdict.text).toContain('holds up to 4× (around November 2028)')
  })

  it('refuse the load, unknown parameters, options that do not exist and a second label', () => {
    expect(errors(def({ top: 'scenario "High" { load: 3; pod: 2; pods: 9 }\nscenario "High" {}' }))).toEqual([
      { message: 'a scenario leaves the load to the slider', hint: 'use a preset for a load', text: 'load' },
      { message: 'unknown parameter "pod"', hint: 'did you mean "pods"?', text: 'pod' },
      { message: '9 is not an option of "pods"', hint: '1, 2, 3', text: '9' },
      { message: 'scenario "High" is declared twice', hint: undefined, text: '"High"' },
    ])
  })

  it('check the growth line', () => {
    expect(errors(def({ top: 'growth { rate: 0; per: year; asOf: "2026-02-30" }' }))).toEqual([
      { message: 'growth needs a rate above 0', hint: undefined, text: '0' },
      { message: '"2026-02-30" is not a date', hint: 'a day like "2026-11-01"', text: '"2026-02-30"' },
    ])
    expect(errors(def({ top: 'growth { rate: 1; per: years; asOf: "2026-11" }' }))[0]?.hint).toBe(
      'did you mean "year"?',
    )
    expect(errors(def({ top: 'growth { rate: 1 }' })).map((e) => e.message)).toEqual([
      '"growth" needs "per: …"',
      '"growth" needs "asOf: …"',
    ])
    const two = 'growth { rate: 1; per: year; asOf: "2026-11" }\ngrowth { rate: 1; per: year; asOf: "2026-11" }'
    expect(errors(def({ top: two })).map((e) => e.message)).toEqual(['only one growth line is allowed'])
  })
})

describe('story steps', () => {
  it('compile in order, with their scenario, focus, title, seconds and values', () => {
    const top = `scenario "Today" {}
scenario "More" { pods: 3 }
step "Start." {}
step "More pods at 8×." { scenario: More; load: 8; fast: true; focus: api; title: "Three pods"; seconds: 6 }`
    const m = compile(def({ top })).definition!.model
    expect(m.story).toEqual([
      { text: 'Start.', values: { load: 2, pods: 2, fast: false }, seconds: 4 },
      {
        text: 'More pods at 8×.',
        title: 'Three pods',
        values: { load: 8, pods: 3, fast: true },
        scenario: 'More',
        focus: 'api',
        seconds: 6,
      },
    ])
  })

  it('refuse a load out of range, and a parameter a step property would hide', () => {
    const top = `param seconds "Timeout" { options: [10, 30]; default: 10 }
step "x" { load: 50; seconds: 30 }`
    expect(errors(def({ top }))).toEqual([
      { message: 'the load goes from 1 to 10', hint: undefined, text: '50' },
      {
        message: '"seconds" in a step is the step\'s own seconds, not the parameter "seconds"',
        hint: 'rename the parameter to set it in a step',
        text: 'seconds',
      },
    ])
  })

  it('say what a function renamed before 0.1 is called now', () => {
    expect(errors(def({ top: 'let x = kfmt(2)' }))[0]?.hint).toBe('renamed to compact()')
  })

  it('point at the word that is wrong', () => {
    const top = `scenario "Today" {}
step "x" { scenario: Later; focus: db; title: " "; seconds: 0; pod: 2; pods: 9 }`
    expect(errors(def({ top }))).toEqual([
      { message: 'unknown scenario "Later"', hint: undefined, text: 'Later' },
      { message: 'unknown component "db"', hint: undefined, text: 'db' },
      { message: 'a title needs a few words', hint: undefined, text: '" "' },
      { message: 'seconds is a duration above 0', hint: undefined, text: '0' },
      { message: 'unknown parameter "pod"', hint: 'did you mean "pods"?', text: 'pod' },
      { message: '9 is not an option of "pods"', hint: '1, 2, 3', text: '9' },
    ])
  })
})

describe('run-time errors', () => {
  it('compile a constant flow rate, the same at any load', () => {
    const r = compile(`loadmap 1.1
load "Load" { max: 10 }
flow orders "orders" { unit: "order"; rate: 40 * load; route: api; from: users }
flow signups "signups" { unit: "signup"; rate: 20 / 86_400; route: api; from: users }
node api "API" "" {
  pass "the API"
  demand: (flows.orders + flows.signups) * 0.01
  capacity: measured(4, "cores", "load test")
  over: "requests time out"
}
node users "Users" ""
users -> api
`)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.evaluate({ load: 1 }).flows.signups).toBeCloseTo(20 / 86_400)
    expect(r.definition!.model.evaluate({ load: 9 }).flows.signups).toBeCloseTo(20 / 86_400)
  })

  it('land on the flow they come from, not on the formula that read it', () => {
    expect(errors(def({ flow: 'retry { times: pods / 4 }' }))).toEqual([
      { message: 'flow "req" retries a whole number of times, not 0.5', hint: undefined, text: 'req' },
    ])
    // fine at the defaults: the scenario is what breaks it
    expect(errors(def({ flow: 'retry { times: pods / 2 }', extra: 'scenario "Small" { pods: 1 }' }))).toEqual([
      {
        message: 'flow "req" retries a whole number of times, not 0.5',
        hint: undefined,
        text: 'scenario',
      },
    ])
    // a stage the flow goes through is not the flow's fault
    const cache = errors(
      def({ flow: 'retry { times: 2 }', extra: 'node c "C" { cache { hit: 1.5 } }' }).replace(
        'route: api',
        'route: c -> api',
      ),
    )
    expect(cache.map((e) => e.message)).toEqual(['cache "c" needs a hit share from 0 to 1, not 1.5'])
    expect(cache[0]!.text).not.toBe('req')
  })

  it("leave a host function's error to the page that wrote it", () => {
    const r = compile(def({ top: 'let x = lookup(2)' }), {
      functions: {
        lookup: () => {
          throw new TypeError('table[x] is undefined')
        },
      },
    })
    expect(r.diagnostics.map((d) => d.message)).toEqual(['lookup(…) failed: table[x] is undefined'])
  })

  it("call an error from loadmap's own code a bug, and keep its text for the report", () => {
    const run = placed({ from: 3, to: 9 }, () => {
      throw new TypeError('def.flows[f].rate is not a function')
    })
    expect(() => run({})).toThrow(
      expect.objectContaining({
        span: { from: 3, to: 9 },
        message: 'this formula could not be computed: a bug in loadmap',
        hint: 'Please report it at https://github.com/jaim3r0jas/loadmap/issues (TypeError: def.flows[f].rate is not a function)',
      }),
    )
    expect(failure(new TypeError('x is not a function'), 'the flow "signups"')).toEqual({
      message: 'the flow "signups" could not be computed: a bug in loadmap',
      hint: 'Please report it at https://github.com/jaim3r0jas/loadmap/issues (TypeError: x is not a function)',
    })
    expect(failure(new Error('loadmap: flow "req" has no route'))).toEqual({ message: 'flow "req" has no route' })
  })
})

describe('the checker', () => {
  it('wants a capacity to say where it came from', () => {
    expect(errors(def({ api: 'pods * 400' }))).toEqual([
      {
        message: 'a capacity says where it came from',
        hint: 'write measured(pods * 400, "unit", "source") or estimated(…)',
        text: 'pods * 400',
      },
    ])
  })

  it("names the one fix for a box with only a component's optional lines", () => {
    expect(errors(def({ extra: 'node users "Users" "" { describe: "people on the shop" }' }))).toEqual([
      {
        message: '"describe" belongs to a component, and this box has no capacity',
        hint: 'for a line under a plain box, put it on the first line: node users "Users" "people on the shop"',
        text: 'describe',
      },
    ])
    const hint = (box: string) => errors(def({ extra: box })).map((e) => `${e.message} | ${e.hint}`)
    // a sub already there, or a describe that is not plain text: the first-line form would not fit
    expect(hint('node users "Users" "web" { describe: "people" }')).toEqual([
      '"describe" belongs to a component, and this box has no capacity | give the box capacity and over lines, or drop it',
    ])
    expect(hint('node users "Users" { describe: fast ? "a" : "b" }')[0]).toContain('or drop it')
    expect(hint('node users { describe: "people" }')[0]).toContain('write sub: "people"')
    // with a stage, the same slip: one error
    expect(
      errors(
        def().replace('client -> api', 'client -> edge -> api').replace('route: api', 'route: edge -> api') +
          '\nnode edge "Edge" { pass; describe: "the front door" }',
      ).map((e) => e.message),
    ).toEqual(['"describe" belongs to a component, and this box has no capacity'])
    // its formulas are still checked
    expect(hint('node users "Users" { describe: "x"; when: fats }').map((h) => h.split(' | ')[0])).toContain(
      'unknown name "fats"',
    )
    // a nested component is a component: no plain-box hint there
    const nested = hint('node db "DB" {\n  name: "the db"\n  component c { capacity: estimated(1, "x"); over: "" }\n}')
    expect(nested.some((h) => h.includes('already has a component'))).toBe(true)
    expect(nested.some((h) => h.includes('belongs to a component'))).toBe(false)
    expect(errors(def({ extra: 'node users "Users" { short: "the users" }' }))).toEqual([
      {
        message: '"short" belongs to a component, and this box has no capacity',
        hint: 'give the box capacity and over lines, or drop it',
        text: 'short',
      },
    ])
  })

  it('says to drop the ":" before an edge\'s block', () => {
    expect(errors(def().replace('client -> api', 'client -> api: { label: "HTTPS"; when: load > 1 }'))).toEqual([
      {
        message: 'drop the ":" before a { … } block',
        hint: 'client -> api { label: …; when: … }',
        text: ':',
      },
    ])
    // the block's own lines are still checked
    expect(errors(def().replace('client -> api', 'client -> api: { lable: "HTTPS" }')).map((e) => e.message)).toEqual([
      'drop the ":" before a { … } block',
      'an edge holds only label and when',
    ])
    // a chain takes no label
    expect(
      errors(def().replace('client -> api', 'client -> mid -> api: { when: load > 1 }') + '\nnode mid "Mid"')[0]?.hint,
    ).toBe('client -> mid -> api { when: … }')
    // a fan-out branch takes its copies, not a block
    const fan = `node push "Push" { fanout { req -> phone: { when: load > 1 } } }\nnode phone "Phone" { sink }`
    expect(
      errors(def({ extra: fan }).replace('route: api', 'route: push')).map((e) => `${e.message} | ${e.hint}`),
    ).toEqual(['a branch takes its copies after ":", not a block | req -> phone: 1'])
  })

  it('suggests the name that was meant', () => {
    expect(errors(def({ top: 'let x = flows.reqs' }))).toMatchObject([
      { message: 'unknown flow "reqs"', hint: 'did you mean "req"?', text: 'reqs' },
    ])
    expect(errors(def({ top: 'let x = pod' }))).toMatchObject([{ hint: 'did you mean "pods"?' }])
    expect(errors(def({ flow: 'colour: accent' }))).toMatchObject([
      { message: 'unknown property "colour" in flow', hint: 'did you mean "color"?' },
    ])
    expect(errors(def({ flow: 'color: acent' }))).toMatchObject([{ hint: 'did you mean "accent"?' }])
    expect(errors(def({ extra: 'client -> apy' }))).toMatchObject([{ hint: 'did you mean "api"?', text: 'apy' }])
  })

  it('places core rules on the line that breaks them', () => {
    const fan = `node push "Push" { fanout { req -> phone: 1 } }\nnode phone "Phone" { sink }`
    expect(
      errors(def({ extra: fan }).replace('route: api', 'route: push -> api').replace('from: client', 'from: client')),
    ).toMatchObject([{ message: 'the fan-out "push" must be the last stage of the route', text: 'push' }])
    expect(errors(def().replace('route: api', 'route: api -> nowhere'))).toMatchObject([
      { message: 'unknown stage "nowhere"', text: 'nowhere' },
    ])
    expect(errors(def().replace('default: 2 }\nparam fast', 'default: 5 }\nparam fast'))).toMatchObject([
      { message: 'the default 5 is not one of the options', hint: '1, 2, 3', text: '5' },
    ])
    expect(errors(def({ top: 'param load "L" { default: true }' }))[0]?.message).toBe(
      '"load" is a reserved name; pick another',
    )
    expect(errors(def({ flow: 'constructor: 1' }))[0]?.message).toBe('unknown property "constructor" in flow')
    expect(errors(def({ flow: 'toString { }' }))[0]?.message).toBe('unknown statement "toString" in flow')
    expect(errors(def({ extra: 'node api "Again"' }))).toMatchObject([{ message: '"api" is declared twice' }])
  })

  it('needs the version line, and refuses a newer language', () => {
    expect(errors(def().replace('loadmap 1.1\n', ''))).toMatchObject([
      { message: 'a definition starts with "loadmap 1.2"', hint: 'add "loadmap 1.2" as the first line' },
    ])
    expect(errors(def().replace('loadmap 1.1', 'loadmap 2'))).toMatchObject([
      {
        message: 'this definition is written in language version 2; this loadmap reads version 1.2',
        hint: 'update @loadmap/dsl',
      },
    ])
  })

  it('puts statements where they belong', () => {
    expect(errors(def({ extra: 'queue q { partitions { req: 1 } }' }))).toMatchObject([
      { message: '"queue" cannot go at the top', hint: 'it goes in cluster' },
    ])
    expect(errors(def({ flow: 'rate: 2' }))).toMatchObject([{ message: '"rate" is set twice in flow' }])
    expect(errors(def({ flow: 'drop: 1' }))).toMatchObject([{ hint: 'write it as a block: drop { … }' }])
  })

  it('settles the types of lets written in any order', () => {
    expect(errors(def({ top: 'let c = b * 2\nlet b = a\nlet a = "x"' }))).toMatchObject([
      { message: 'expected a number, this is a text', text: 'b' },
    ])
  })

  it('warns about a stage no flow passes', () => {
    const r = compile(def({ extra: 'node idle "Idle" { sink }' }))
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toMatchObject([{ severity: 'warning', message: 'no flow passes the stage "idle"' }])
  })

  it('maps a loop between formulas to the formula', () => {
    const src = def({ top: 'let a = b + 1\nlet b = a * 2' })
    const r = compile(src)
    expect(r.ok).toBe(false)
    const d = r.diagnostics[0] as Diagnostic
    expect(d.message).toBe('derived a → derived b → derived a is a loop')
    expect(src.slice(d.from, d.to)).toBe('a * 2')
  })

  it('refuses a drawing too large to lay out', () => {
    const src = def({
      extra: 'cluster k "K" { members: pods * 100; queue q { partitions { req: 3 } } }\nclient -> k\nk -> api',
    }).replace('route: api', 'route: q -> api')
    expect(errors(src)).toMatchObject([{ message: 'members is 200; at most 64', text: 'pods * 100' }])
  })
})

describe('uncertainty and expectations', () => {
  const api = (src: string) => compile(def({ api: src })).definition!.model.evaluate().components.api!.capacity

  it('read a ± on a capacity as a share of its value', () => {
    expect(api('estimated(800 ± 30%, "req/s", "vendor")')).toEqual(
      estimated(800, 'req/s', { source: 'vendor', within: 0.3 }),
    )
    expect(api('measured(pods * 400 +/- 10%, "req/s")')).toMatchObject({ value: 800, within: 0.1 })
    // without a %: in the capacity's unit
    expect(api('measured(800 ± 200, "req/s")')).toMatchObject({ value: 800, within: 0.25 })
  })

  it('refuse a ± anywhere else, or one of 100 % or more', () => {
    expect(errors(def({ top: 'let x = 3 ± 1' }))).toEqual([
      { message: '"±" only goes in the first value of measured(…) or estimated(…)', hint: undefined, text: '3 ± 1' },
    ])
    expect(errors(def({ api: 'estimated(800, "req/s" ± 3)' }))).toEqual([
      {
        message: '"±" only goes in the first value of measured(…) or estimated(…)',
        hint: undefined,
        text: '"req/s" ± 3',
      },
    ])
    expect(errors(def({ api: 'estimated(800 ± 100%, "req/s")' }))).toEqual([
      {
        message: '± 100 % is not a share from 0 to below 100 %',
        hint: undefined,
        text: 'estimated(800 ± 100%, "req/s")',
      },
    ])
  })

  const scenarios = 'scenario "Today" {}\nscenario "Three pods" { pods: 3 }'

  it('compile expect lines to the model, and check them where they are written', () => {
    const src = def({
      top: `${scenarios}\nexpect "keeps 3×" { underTarget: 3 }\nexpect { scenario: "Three pods"; notFull: 12; component: api }`,
    })
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.expectations).toEqual([
      { label: 'keeps 3×', underTarget: 3 },
      { scenario: 'Three pods', component: 'api', notFull: 12 },
    ])
    expect(r.expectations.map((e) => [e.line, e.column, src.slice(e.at.from, e.at.to), e.result.ok])).toEqual([
      [4, 1, 'expect "keeps 3×"', true],
      [5, 1, 'expect', true],
    ])
    // 400 req/s a pod against 100 per 1×: 2 pods reach 50 % at 4×, 3 pods run out at 12×
    const failing = compile(def({ top: 'expect "keeps 5×" { underTarget: 5 }' }))
    expect(failing.ok).toBe(true)
    expect(failing.expectations.map((e) => [e.line, e.result.ok, e.result.message])).toEqual([
      [2, false, 'expected at least 5×, but the 50 % target holds up to 4×, limited by API'],
    ])
  })

  it('point at the word an expect line gets wrong', () => {
    expect(errors(def({ top: `${scenarios}\nexpect { scenario: Today2; underTarget: 1 }` }))).toEqual([
      { message: 'unknown scenario "Today2"', hint: 'did you mean "Today"?', text: 'Today2' },
    ])
    expect(errors(def({ top: 'expect { component: apu; underTarget: 1 }' }))).toEqual([
      { message: 'unknown component "apu"', hint: 'did you mean "api"?', text: 'apu' },
    ])
    expect(errors(def({ top: 'expect "nothing" {}' }))).toEqual([
      {
        message: 'an expect needs underTarget or notFull: a load multiple',
        hint: 'expect { underTarget: 8× }',
        text: 'expect',
      },
    ])
    expect(errors(def({ top: 'expect { underTarget: 0 }' }))).toEqual([
      { message: 'underTarget is a load multiple above 0', hint: undefined, text: '0' },
    ])
  })
})

/** The model a definition compiles to, which must not report anything. */
function model(src: string): Model {
  const r = compile(src)
  expect(r.diagnostics.map((d) => `${d.message} at "${src.slice(d.from, d.to)}"`)).toEqual([])
  return r.definition!.model
}

/** What the page and the sim read from an evaluation, the same for the definition and its TypeScript twin. */
function same(ts: Model, dsl: Model, values: readonly Record<string, unknown>[]) {
  expect([dsl.flowIds, dsl.componentIds, dsl.stageIds]).toEqual([ts.flowIds, ts.componentIds, ts.stageIds])
  for (const v of values) {
    const [a, b] = [ts.evaluate(v as any), dsl.evaluate(v as any)]
    const shown = (ev: typeof a) => ({
      flows: ev.flows,
      at: ev.at,
      retry: ev.retry,
      components: ev.components,
      stages: ev.stages,
      overload: ev.overload,
      verdict: ev.verdict,
    })
    expect(shown(b), JSON.stringify(v)).toEqual(shown(a))
  }
}

const loads = [0.5, 1, 2, 3, 6].map((load) => ({ load }))

describe('building blocks', () => {
  it('compile a cache, whose hits are gone from the stages after it', () => {
    const dsl = model(`loadmap 1.1
load "Load" { max: 10; default: 1 }
param hit "Hit ratio" { options: [0.5, 0.8]; default: 0.8 }
flow reads "reads" { rate: 1000 * load; route: hits -> db; from: client }
node client "Client"
node hits "Cache" {
  cache { hit: hit }
  capacity: measured(20_000, "ops/s")
  over: "lookups time out"
}
node db "DB" {
  store
  capacity: measured(500, "queries/s")
  over: "queries queue"
}
client -> hits
hits -> db: \`\${compact(at.db.reads)} misses/s\`
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      params: { hit: p.select({ label: 'Hit ratio', options: [0.5, 0.8], default: 0.8 }) },
      flows: { reads: { label: 'reads', rate: ({ load }) => 1000 * load } },
      components: {
        hits: { name: 'Cache', capacity: measured(20_000, 'ops/s'), over: 'lookups time out' },
        db: { name: 'DB', capacity: measured(500, 'queries/s'), over: 'queries queue' },
      },
      stages: { hits: cache({ hit: ({ hit }) => hit, component: 'hits' }), db: store('db') },
      routes: { reads: ['hits', 'db'] },
    })
    same(ts, dsl, [...loads, { hit: 0.5 }])
    expect(dsl.evaluate().at.db!.reads).toBeCloseTo(200)
  })

  it('compile an autoscaled pool', () => {
    const dsl = model(`loadmap 1.1
load "Load" { max: 10; default: 1 }
param most "Most pods" { options: [6, 10]; default: 10 }
flow req "requests" { rate: 300 * load; route: topic -> api; from: client }
node client "Client"
cluster broker "Broker" {
  members: 1
  queue topic { partitions { req: 4 } }
}
pool api "API" {
  workers {
    perPod: 4
    autoscale { min: 2; max: most; target: 0.7 }
  }
  demand: flows.req * 0.01
  capacity: measured(most * 1, "cores")
  over: "requests queue"
}
client -> broker
broker -> api
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      params: { most: p.select({ label: 'Most pods', options: [6, 10], default: 10 }) },
      flows: { req: { label: 'requests', rate: ({ load }) => 300 * load } },
      components: {
        api: {
          name: 'API',
          demand: ({ flows }) => flows.req * 0.01,
          capacity: ({ most }) => measured(most * 1, 'cores'),
          over: 'requests queue',
        },
      },
      stages: {
        topic: queue({ partitions: { req: 4 } }),
        api: workers('api', { perPod: 4, autoscale: { min: 2, max: ({ most }) => most, target: 0.7 } }),
      },
      routes: { req: ['topic', 'api'] },
    })
    same(ts, dsl, [...loads, { most: 6 }])
    expect(dsl.evaluate().stages.api).toMatchObject({ pods: 10, running: 5 })
  })

  it('compile a rate limiter with a configured limit', () => {
    const dsl = model(`loadmap 1.1
load "Load" { max: 10; default: 1 }
flow req "requests" { rate: 1000 * load; route: limiter -> db; from: client }
node client "Client"
node limiter "Limiter" {
  limit
  capacity: configured(1_000, "req/s", "gateway config")
  over: "clients get 429s"
}
node db "DB" {
  store
  capacity: measured(2_000, "queries/s")
  over: "queries queue"
}
node tooMany "Turned away" { lost }
client -> limiter -> db
limiter -> tooMany
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      flows: { req: { label: 'requests', rate: ({ load }) => 1000 * load } },
      components: {
        limiter: { name: 'Limiter', capacity: configured(1000, 'req/s', 'gateway config'), over: 'clients get 429s' },
        db: { name: 'DB', capacity: measured(2000, 'queries/s'), over: 'queries queue' },
      },
      stages: { limiter: limit('limiter'), db: store('db'), tooMany: lost({ label: 'tooMany', from: ['limiter'] }) },
      routes: { req: ['limiter', 'db'] },
    })
    same(ts, dsl, loads)
    expect(dsl.evaluate({ load: 1.5 }).at.db!.req).toBeCloseTo(1000)
  })

  it('compile retries with a budget, switched by a parameter', () => {
    const dsl = model(`loadmap 1.1
load "Load" { max: 10; default: 1 }
param tries "Retries" { options: [0, 3]; default: 3 }
param budgeted "Retry budget" { default: false }
flow req "requests" {
  rate: 1000 * load
  retry { times: tries }
  route: gateway -> service
  from: client
}
flow capped "capped requests" {
  rate: 100 * load
  retry { times: 3; budget: 0.1; when: budgeted }
  route: gateway -> service
  from: client
}
node client "Client"
node gateway "Gateway" {
  pass
  capacity: measured(5_000, "req/s")
  over: "everyone gets errors"
}
node service "Service" {
  pass
  capacity: measured(1_000, "req/s")
  over: "requests get 503s"
}
client -> gateway -> service
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      params: {
        tries: p.select({ label: 'Retries', options: [0, 3], default: 3 }),
        budgeted: p.switch({ label: 'Retry budget', default: false }),
      },
      flows: {
        req: {
          label: 'requests',
          rate: ({ load }) => 1000 * load,
          retry: ({ tries }) => ({ times: tries as number }),
        },
        capped: {
          label: 'capped requests',
          rate: ({ load }) => 100 * load,
          retry: ({ budgeted }) => (budgeted ? { times: 3, budget: 0.1 } : undefined),
        },
      },
      components: {
        gateway: { name: 'Gateway', capacity: measured(5000, 'req/s'), over: 'everyone gets errors' },
        service: { name: 'Service', capacity: measured(1000, 'req/s'), over: 'requests get 503s' },
      },
      stages: { gateway: pass('gateway'), service: pass('service') },
      routes: { req: ['gateway', 'service'], capped: ['gateway', 'service'] },
    })
    same(ts, dsl, [...loads, { tries: 0 }, { budgeted: true, load: 2 }])
    expect(dsl.evaluate({ load: 2 }).retry.req!.attempts).toBeGreaterThan(2000)
  })

  it('point at what a block is missing', () => {
    const at = (box: string) =>
      errors(`loadmap 1.1
load { max: 10 }
flow req "r" { rate: load; route: x; from: client }
node client "Client"
${box}
client -> x
`).map((e) => e.message)
    expect(at('pool x "X" {\n  workers { perPod: 4 }\n  capacity: measured(1, "cores")\n  over: ""\n}')).toContain(
      'a workers stage needs pods, or autoscale',
    )
    expect(
      at(
        'pool x "X" {\n  workers { pods: 2; perPod: 4; autoscale { min: 1; max: 2; target: 0.7 } }\n  capacity: measured(1, "cores")\n  over: ""\n}',
      ),
    ).toContain('an autoscaled pool has no fixed pods')
    expect(at('node x "X" {\n  pass\n  capacity: configured(1 ± 10%, "req/s")\n  over: ""\n}')).toContain(
      '"±" only goes in the first value of measured(…) or estimated(…)',
    )
    expect(errors(def({ flow: 'retry { times: 3; when: util.api > 0.8 }' })).map((e) => e.message)).toContain(
      'this formula reads only parameters; it cannot read util.api',
    )
    expect(
      errors(def({ extra: 'component spare "Spare" { capacity: measured(1, "x"); over: "" }' })).map((e) => e.message),
    ).toContain('the component "spare" needs "demand: …": no stage uses it')
  })
})

describe('hops', () => {
  const SRC = `loadmap 1.1
load { max: 10 }
param fast "Fast path" { default: false }
preset "Fast" { fast: true }
flow req "requests" { rate: 100 * load; route: gw -> api -> db; from: users }
node users "Users"
node gw "Gateway" { pass; capacity: measured(1_000, "req/s"); over: "clients wait" }
node api "API" { pass; capacity: measured(1_000, "req/s"); over: "clients wait" }
node db "Database" { store; capacity: measured(1_000, "req/s"); over: "writes queue" }
users -> gw -> api -> db
`
  const all = (src: string) =>
    compile(src).diagnostics.map((d) => ({ severity: d.severity, message: d.message, text: src.slice(d.from, d.to) }))

  it('refuse a route hop no edge draws, at the hop', () => {
    expect(errors(SRC.replace('users -> gw -> api -> db', 'users -> gw\napi -> db'))).toEqual([
      { message: '"req" goes from "gw" to "api", and no edge joins them', hint: 'draw gw -> api', text: 'gw -> api' },
    ])
  })

  it('refuse an edge that points against the flow', () => {
    expect(errors(SRC.replace('users -> gw -> api -> db', 'users -> gw\napi -> gw\napi -> db'))).toMatchObject([
      { message: '"req" goes from "gw" to "api", but their edge points the other way', text: 'gw -> api' },
    ])
  })

  it("refuse a start no edge joins to the first stage, at the flow's from", () => {
    expect(errors(SRC.replace('users -> gw -> api -> db', 'gw -> api -> db'))).toMatchObject([
      { message: '"req" goes from "users" to "gw", and no edge joins them', text: 'users' },
    ])
  })

  it('refuse a fan-out branch and a split way no edge draws, at their lines', () => {
    const fan = SRC.replace('route: gw -> api -> db', 'route: gw -> api -> push')
      .replace('users -> gw -> api -> db', 'users -> gw -> api -> push')
      .concat('node push "Push" { fanout { req -> phone: 2 } }\nnode phone "Phone" { sink }\n')
    expect(errors(fan)).toMatchObject([
      { message: '"req" goes from "push" to "phone", and no edge joins them', text: 'req -> phone: 2' },
    ])
    expect(errors(`${fan}push -> phone\n`)).toEqual([])

    const way = SRC.replace('route: gw -> api -> db', 'route: gw -> router -> api')
      .replace('users -> gw -> api -> db', 'users -> gw -> router -> db\nrouter -> api')
      .concat('node router "Router" { split { req -> db: 0.5; req -> side: 0.5 } }\n')
      .concat('node side "Cache" { pass; capacity: measured(1_000, "req/s"); over: "misses" }\nrouter -> side\n')
    // the side's way rejoins the route at api: that hop needs its edge too
    expect(errors(way)).toMatchObject([
      { message: '"req" goes from "side" to "api", and no edge joins them', text: 'req -> side: 0.5' },
    ])
    expect(errors(`${way}side -> api\n`)).toEqual([])
  })

  it('take two stages in one box as no hop', () => {
    // a cluster's two queues: a unit moves from one to the other inside the box
    const src = SRC.replace('route: gw -> api -> db', 'route: gw -> raw -> clean -> db')
      .replace('users -> gw -> api -> db', 'users -> gw -> api -> db\ngw -> k -> db')
      .concat(
        'cluster k "K" { members: 3; capacity: measured(1_000, "msg/s"); over: "lag"; queue raw { partitions { req: 3 } }; queue clean { partitions { req: 3 } } }\n',
      )
    expect(errors(src)).toEqual([])
  })

  it('warn where an edge a flow takes is hidden', () => {
    expect(all(SRC.replace('users -> gw -> api -> db', 'users -> gw -> api\napi -> db { when: fast }'))).toEqual([
      {
        severity: 'warning',
        message: 'api -> db is hidden at the defaults, but "req" still goes that way',
        text: 'when',
      },
    ])
    expect(all(SRC.replace('users -> gw -> api -> db', 'users -> gw -> api\napi -> db { when: !fast }'))).toEqual([
      {
        severity: 'warning',
        message: 'api -> db is hidden in the preset "Fast", but "req" still goes that way',
        text: 'when',
      },
    ])
  })

  it('warn only where nothing else carries the dots: a twin edge shown, or a way no unit takes', () => {
    const twin = SRC.replace(
      'users -> gw -> api -> db',
      'users -> gw -> api\napi -> db { label: "sync"; when: fast }\napi -> db { label: "async"; when: !fast }',
    )
    expect(all(twin)).toEqual([])
    const way = SRC.replace('route: gw -> api -> db', 'route: gw -> router -> db')
      .replace(
        'users -> gw -> api -> db',
        'users -> gw -> router -> api -> db\nrouter -> side { when: fast }\nside -> db',
      )
      .concat('node router "Router" { split { req -> side: fast ? 0.5 : 0; req -> api: fast ? 0.5 : 1 } }\n')
      .concat('node side "Cache" { pass; capacity: measured(1_000, "req/s"); over: "misses" }\n')
    // at the defaults no unit goes by the side, so its hidden edge carries nothing
    expect(all(way)).toEqual([])
  })

  it('still runs the presets with a hop unjoined, so their errors show at once', () => {
    const src = SRC.replace('users -> gw -> api -> db', 'users -> gw\napi -> db').replace(
      'preset "Fast" { fast: true }',
      'preset "Fast" { fast: true }\nlet slow = fast ? 1 / 0 : 1',
    )
    expect(errors(src).map((e) => e.message)).toContain('"req" goes from "gw" to "api", and no edge joins them')
  })

  it('check a TypeScript fan-out whose branches change with the values in each scenario', async () => {
    const { defineView } = await import('@loadmap/layout')
    const { fanout, sink } = await import('@loadmap/core')
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { email: p.switch({ label: 'Email', default: false }) },
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: { api: { name: 'API', capacity: measured(1_000, 'req/s'), over: 'clients wait' } },
      stages: {
        api: pass('api'),
        push: fanout({ to: ({ email }) => ({ req: [{ stage: email ? 'mail' : 'phone', share: 1 }] }) }),
        phone: sink(),
        mail: sink(),
      },
      routes: { req: ['api', 'push'] },
      scenarios: { Today: {}, Mail: { email: true } },
    })
    const node = <S extends string>(stage: S) => ({ kind: 'node' as const, label: stage, stage, shape: 'box' as const })
    expect(() =>
      defineView(m, {
        nodes: {
          users: { kind: 'node', label: 'Users', shape: 'box' },
          api: node('api'),
          push: node('push'),
          phone: node('phone'),
          mail: node('mail'),
        },
        edges: [
          { from: 'users', to: 'api' },
          { from: 'api', to: 'push' },
          { from: 'push', to: 'phone' },
        ],
        flows: { req: { from: 'users', color: 'accent' } },
      }),
    ).toThrow(`goes from node "push" to node "mail" with no edge between them`)
  })

  it('refuse a hop without an edge in TypeScript too', async () => {
    const { defineView } = await import('@loadmap/layout')
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: { api: { name: 'API', capacity: measured(1_000, 'req/s'), over: 'clients wait' } },
      stages: { api: pass('api'), db: store('api') },
      routes: { req: ['api', 'db'] },
    })
    const nodes = {
      users: { kind: 'node', label: 'Users', shape: 'box' },
      api: { kind: 'node', label: 'API', stage: 'api', shape: 'box' },
      db: { kind: 'node', label: 'DB', stage: 'db', shape: 'box' },
    } as const
    const flows = { req: { from: 'users', color: 'accent' } } as const
    expect(() => defineView(m, { nodes, edges: [{ from: 'users', to: 'api' }], flows })).toThrow(
      `loadmap: flow "req" goes from node "api" to node "db" with no edge between them: add edge('api', 'db')`,
    )
    expect(() =>
      defineView(m, {
        nodes,
        edges: [
          { from: 'users', to: 'api' },
          { from: 'api', to: 'db' },
        ],
        flows,
      }),
    ).not.toThrow()
  })
})

describe('lost boxes', () => {
  const SRC = `loadmap 1.1
load { max: 10 }
flow req "requests" { rate: 1_000 * load; retry { times: 3 }; route: limiter -> api -> db; from: users }
node users "Users"
node limiter "Limiter" { limit; capacity: configured(1_500, "req/s", "gateway config"); over: "429s" }
node api "API" { pass; capacity: measured(1_000, "req/s"); over: "503s" }
node db "Database" { store; capacity: measured(10_000, "req/s"); over: "writes queue" }
node tooMany "Turned away" { lost { takes: [rejected] } }
node failed "Failed" { lost }
users -> limiter -> api -> db
limiter -> tooMany
api -> failed
`

  it('take what the boxes with an edge into them lose, as the TypeScript lost box does', () => {
    const ts = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { label: 'requests', rate: ({ load }) => 1000 * load, retry: { times: 3 } } },
      components: {
        limiter: { name: 'Limiter', capacity: configured(1500, 'req/s', 'gateway config'), over: '429s' },
        api: { name: 'API', capacity: measured(1000, 'req/s'), over: '503s' },
        db: { name: 'Database', capacity: measured(10_000, 'req/s'), over: 'writes queue' },
      },
      stages: {
        limiter: limit('limiter'),
        api: pass('api'),
        db: store('db'),
        tooMany: lost({ label: 'tooMany', from: ['limiter'], takes: ['rejected'] }),
        failed: lost({ label: 'failed', from: ['api'] }),
      },
      routes: { req: ['limiter', 'api', 'db'] },
    })
    same(ts, model(SRC), loads)
    const r = compile(SRC).definition!
    expect(r.model.evaluate({ load: 2 }).ctx.at.tooMany.req).toBeGreaterThan(0)
    // its box says what reaches it, unless it has a line of its own
    const sub = r.view.def.nodes.tooMany!.sub as (ctx: unknown) => string
    expect(sub(r.model.evaluate({ load: 1 }).ctx)).toBe('0 rejected/s')
    expect((r.view.def.nodes.failed!.sub as (ctx: unknown) => string)(r.model.evaluate({ load: 1 }).ctx)).toBe(
      '0 lost/s',
    )
  })

  it('refuse a lost box nothing feeds, a box that loses nothing, a loss two lost boxes take and an edge out', () => {
    expect(errors(SRC.replace('api -> failed\n', ''))).toMatchObject([
      {
        message: 'nothing feeds the lost box "failed"',
        hint: 'draw an edge into failed from the box whose losses it takes',
        text: 'lost',
      },
    ])
    expect(errors(`${SRC}db -> failed\n`)).toMatchObject([
      { message: '"db" loses nothing the lost box "failed" takes', text: 'db' },
    ])
    expect(errors(`${SRC}limiter -> failed\n`)).toMatchObject([
      { message: 'what "limiter" loses as rejected already goes to the lost box "tooMany"', text: 'limiter' },
    ])
    expect(errors(`${SRC}failed -> db\n`)).toMatchObject([
      { message: 'nothing leaves the lost box "failed": what reaches it is lost', text: 'db' },
    ])
  })
})

describe('losses no lost box counts', () => {
  const SRC = `loadmap 1.1
load { max: 10 }
flow req "requests" { rate: 100 * load; route: limiter -> api; from: users }
flow ev "events" {
  rate: 50 * load
  drop { olderThan: 60 }
  timeout: 5
  route: topic -> crew
  from: users
}
node users "Users"
node limiter "Limiter" { limit; capacity: configured(1_500, "req/s", "gateway config"); over: "429s" }
node api "API" { pass; capacity: measured(1_000, "req/s"); over: "503s" }
cluster kafka "Kafka" { members: 3; queue topic { partitions { ev: 3 } } }
pool crew "Pool" {
  workers { pods: 2; perPod: 2 }
  capacity: measured(100, "ev/s")
  service: 0.01
  over: "lag"
}
users -> limiter -> api
users -> kafka -> crew
`
  const warnings = (src: string) =>
    compile(src)
      .diagnostics.filter((d) => d.severity === 'warning')
      .map((d) => ({ message: d.message, text: src.slice(d.from, d.to) }))

  it('warn at a limiter, a drop rule and a timeout whose losses vanish', () => {
    // in the order of the text
    expect(warnings(SRC)).toEqual([
      {
        message: 'units of "ev" dropped as too old at "topic" vanish: give them a lost box that counts them',
        text: 'drop',
      },
      {
        message: 'units of "ev" too slow for their client at "crew" vanish: give them a lost box that counts them',
        text: 'timeout',
      },
      { message: 'what "limiter" turns away vanishes: give it a lost box that counts it', text: 'limit' },
    ])
  })

  it('warn once for a stage, only for losses that happen, and where a way really ends', () => {
    const MINI = `loadmap 1.1
load { max: 10 }
node users "Users"
node api "API" { pass; capacity: measured(1_000, "req/s"); service: 0.01; over: "503s" }
`
    // a limiter no flow passes turns nothing away
    const idle = `${MINI}flow req "r" { rate: 1; route: api; from: users }
node limiter "Limiter" { limit; capacity: configured(1, "req/s", "x"); over: "429s" }
users -> api
`
    expect(warnings(idle).map((w) => w.message)).toEqual(['no flow passes the stage "limiter"'])
    // a split last on the route: its ways end the flow at a and at b, not at the split
    const split = `${MINI}flow req "r" { rate: 1; timeout: 5; route: api -> sp; from: users }
node sp "Split" { split { req -> a: 0.5; req -> b: 0.5 } }
node a "A" { pass; capacity: measured(1_000, "req/s"); over: "x" }
node b "B" { pass; capacity: measured(1_000, "req/s"); over: "x" }
node late "Late" { lost { takes: [timedOut] } }
users -> api -> sp -> a
sp -> b
`
    expect(warnings(split).map((w) => w.message)).toEqual([
      'units of "req" too slow for their client at "a" vanish: give them a lost box that counts them',
    ])
    expect(warnings(`${split}a -> late\nb -> late\n`)).toEqual([])
    // two flows dropping at one queue: one warning; a flow nothing reads after the queue drops nothing
    const shared = `${MINI}flow ev "e" { rate: 1; drop { olderThan: 9 }; route: topic -> api; from: users }
flow ev2 "e2" { rate: 1; drop { olderThan: 9 }; route: topic -> api; from: users }
flow raw "raw" { rate: 1; drop { olderThan: 9 }; route: topic; from: users }
cluster kafka "Kafka" { members: 1; queue topic { partitions { ev: 1; ev2: 1; raw: 1 } } }
users -> kafka -> api
`
    expect(warnings(shared).map((w) => w.message)).toEqual([
      'units of "ev" dropped as too old at "topic" vanish: give them a lost box that counts them',
    ])
  })

  it('say nothing once a lost box counts each, and nothing for a pass past capacity', () => {
    const counted = `${SRC}node gone "Lost" { lost }
node old "Too old" { lost }
limiter -> gone
kafka -> old
crew -> gone
`
    expect(compile(counted).diagnostics).toEqual([])
  })
})

describe('one mistake, one mark, where it is', () => {
  const BASE = `loadmap 1.1
load { max: 10 }
flow orders "orders" { unit: "order"; rate: 40 * load; route: api -> db; from: users }
node users "Users"
node api "API" { pass; demand: flows.orders; capacity: estimated(1000, "req/s"); over: "429s" }
node db "DB" { store; capacity: measured(500, "commits/s", "test"); over: "queues" }
users -> api
api -> db
`
  const marks = (src: string) =>
    compile(src).diagnostics.map((d) => ({ severity: d.severity, code: d.code, text: src.slice(d.from, d.to) }))
  const error = (code: string, text: string) => ({ severity: 'error', code, text })

  it('starts from a definition without a mark', () => {
    expect(marks(BASE)).toEqual([])
  })

  it('a property written with "=", not also the property as missing', () => {
    expect(marks(BASE.replace('rate: 40 * load', 'rate = 40 * load'))).toEqual([error('misplaced', 'rate')])
  })

  it('a "…" text carried onto the next line, not its second line as a statement', () => {
    const src = `${BASE}step "a long\n text" { load: 2 }\n`
    expect(marks(src)).toEqual([error('syntax', '"a long')])
    expect(compile(src).diagnostics[0]).toMatchObject({
      message: 'a "…" text ends on its line',
      hint: 'close it here; a text in backticks may run over lines',
    })
    // a quote that nothing closes is still said as that
    expect(compile(`${BASE}step "a long\n text { load: 2 }\n`).diagnostics[0]!.message).toBe(
      'this text has no closing quote',
    )
  })

  it('a formula wrapped without parentheses, once for all its lines', () => {
    const src = `${BASE}let w = load > 2\n  ? 1\n  : 2\n`
    expect(marks(src)).toEqual([error('syntax', '?')])
    expect(compile(src).diagnostics[0]).toMatchObject({
      message: 'a formula ends with its line: this "?" starts a new one',
      hint: 'put the formula in ( … ) to carry it over lines',
    })
    expect(marks(`${BASE}let w = (load > 2\n  ? 1\n  : 2)\n`)).toEqual([])
    // two wrapped formulas are two mistakes
    expect(marks(`${BASE}let w = load\n  + 1\nlet v = load\n  * 2\n`).map((m) => m.text)).toEqual(['+', '*'])
  })

  it('an expectation that rests on a demand that is no number: inconclusive, not a firm 0×', () => {
    const src = BASE.replace('load { max: 10 }', 'load { max: 10 }\nparam pods "Pods" { options: [2, 4]; default: 2 }')
      .replace('demand: flows.orders;', 'demand: flows.orders / (pods - 2);')
      .concat('expect "x" { underTarget: 2 }\n')
    const r = compile(src)
    expect(r.diagnostics.map((d) => d.code)).toEqual(['bad-demand'])
    expect(r.expectations[0]!.result).toMatchObject({
      outcome: 'inconclusive',
      reasons: ['the demand of API is Infinity, not a number to rank by'],
    })
  })

  it('an unknown function, not also its arguments', () => {
    expect(marks(BASE.replace('rate: 40 * load', 'rate: mx(load, 1)'))).toEqual([error('unknown-name', 'mx')])
  })

  it('a misspelt keyword, not every use of what it would have declared', () => {
    expect(marks(BASE.replace('node api "API"', 'nod api "API"'))).toEqual([error('unknown-statement', 'nod')])
  })

  it('a second stage in a node, not the names it would take twice', () => {
    expect(marks(BASE.replace('{ store; capacity', '{ store; pass; capacity'))).toEqual([error('bad-box', 'pass')])
  })

  it('a second stage with its own id once, and what names it still finds it', () => {
    const src = BASE.replace('{ store; capacity', '{ store; pass p2; capacity').replace(
      'route: api -> db',
      'route: api -> p2',
    )
    expect(marks(src).filter((m) => m.severity === 'error')).toEqual([error('bad-box', 'pass')])
  })

  it('a bare capacity once', () => {
    expect(marks(BASE.replace('capacity: estimated(1000, "req/s")', 'capacity: 1000'))).toEqual([
      error('bare-capacity', '1000'),
    ])
  })

  it('a value that does not parse, not also its property as missing', () => {
    expect(marks(BASE.replace('estimated(1000, "req/s")', 'estimated(1000 *, "req/s")'))).toEqual([
      error('syntax', ','),
    ])
  })

  it('a list with a wrong word, not what the rest of the list would leave out', () => {
    const src = `${BASE.replace('api -> db; from', 'lim -> db; from').replace('users -> api\napi -> db', 'users -> lim\nlim -> db')}node lim "Limiter" { limit; capacity: configured(1000, "req/s", "config"); over: "429s" }
node gone "Turned away" { lost { takes: [rejectd] } }
lim -> gone
`
    expect(marks(src).filter((m) => m.severity === 'error')).toEqual([error('bad-value', 'rejectd')])
    expect(marks(src).filter((m) => m.code === 'unseen-loss')).toEqual([])
  })

  it("a flow's timeout without latency at its timeout, and nothing more there", () => {
    const src = `loadmap 1.1
load { max: 10 }
flow o "o" { rate: 1; route: a; from: u
  timeout: 2 }
node u "U"
node a "A" { sink }
u -> a
`
    expect(marks(src)).toEqual([error('model', 'timeout: 2')])
  })

  it('a lost box on a route at its name there', () => {
    const src = `${BASE.replace('route: api -> db', 'route: api -> gone')}node gone "Turned away" { lost }
api -> gone
`
    expect(marks(src).filter((m) => m.severity === 'error')).toEqual([error('model', 'gone')])
    const d = compile(src).diagnostics.find((x) => x.code === 'model')!
    expect(d.line).toBe(3)
  })
})

describe('strict formulas', () => {
  /** Each diagnostic as [severity, code, message, hint, the text it marks]. */
  const marks = (src: string) =>
    compile(src).diagnostics.map((d) => [d.severity, d.code, d.message, d.hint, src.slice(d.from, d.to)])
  const v10 = (src: string) => src.replace(/^loadmap 1\.1/, 'loadmap 1')
  const later = ' (an error from loadmap 1.1)'

  it.each([
    // the review's cases: c01, c02, c03 and fable 08a-e, 31
    [
      'let x = 1 < load < 3',
      'chained-comparison',
      "comparisons don't chain",
      'write 1 < load && load < 3',
      '1 < load < 3',
    ],
    [
      'let x = pods ? 1 : 2',
      'wrong-type',
      'the test before "?" is true or false, this is a number',
      'write pods != 0',
      'pods',
    ],
    [
      'let x = fast ? 1 : "two"',
      'wrong-type',
      'the two answers of "? :" are a number and a text',
      'give both the same type',
      'fast ? 1 : "two"',
    ],
    [
      'let x = pods == "2"',
      'wrong-type',
      'this is always false: a number is never equal to a text',
      'write 2 to compare like with like',
      'pods == "2"',
    ],
    ['let x = !load', 'wrong-type', '"!" takes true or false, this is a number', 'write load == 0', '!load'],
    [
      'let x = pods || 20',
      'wrong-type',
      '"||" takes true or false on both sides, these are numbers',
      'for a fallback, write pods != 0 ? pods : 20',
      'pods || 20',
    ],
    ['let x = fast && pods', 'wrong-type', '"&&" takes true or false, this is a number', 'write pods != 0', 'pods'],
    ['let x = load < "a"', 'wrong-type', '"<" compares numbers, this is a text', undefined, '"a"'],
    ['let x = pods != 5', 'bad-value', '5 is not an option of "pods", so this is always true', '1, 2, 3', '5'],
  ])('%s: an error from loadmap 1.1, a warning before', (top, code, message, hint, text) => {
    expect(marks(def({ top }))).toEqual([['error', code, message, hint, text]])
    const old = compile(v10(def({ top })))
    expect(old.ok).toBe(true)
    expect(marks(v10(def({ top })))).toEqual([['warning', code, message + later, hint, text]])
  })

  it('wants true or false for a when and an enabled', () => {
    const src = def({
      api: 'measured(400, "req/s", "load test")\n  when: 1',
      extra: 'param slow "Slow" { default: false; enabled: pods }',
    })
    expect(marks(src)).toEqual([
      ['error', 'wrong-type', '"when" takes true or false, this is a number', 'write true or false', '1'],
      ['error', 'wrong-type', '"enabled" takes true or false, this is a number', 'write pods != 0', 'pods'],
    ])
    expect(compile(v10(src)).ok).toBe(true)
  })

  it('refuses a preset outside the load or a slider', () => {
    const src = def({
      extra: 'param size "Size" { min: 1; max: 5; default: 2 }\npreset "big" { load: 99; size: 9 }',
    })
    expect(marks(src)).toEqual([
      ['error', 'out-of-range', 'the load goes from 1 to 10', undefined, '99'],
      ['error', 'out-of-range', '"size" goes from 1 to 5', undefined, '9'],
    ])
    expect(compile(v10(src)).ok).toBe(true)
  })

  it('refuses a rate or a capacity below 0 where it is computed', () => {
    const capacity = def({ api: 'measured(pods * -400, "req/s", "load test")' })
    expect(marks(capacity)).toEqual([
      [
        'error',
        'out-of-range',
        'the capacity of "api" is -800 at the defaults',
        'a capacity is above 0',
        'measured(pods * -400, "req/s", "load test")',
      ],
    ])
    expect(compile(v10(capacity)).ok).toBe(true)
    // the rate is the mistake: the demand it feeds is not blamed again
    const rate = def().replace('rate: 100 * load', 'rate: -100 * load')
    expect(marks(rate)).toEqual([
      [
        'error',
        'bad-rate',
        'the rate of "req" is -200 at the defaults',
        'a rate is units per second, from 0 up',
        '-100 * load',
      ],
    ])
    expect(compile(v10(rate)).ok).toBe(true)
    // a capacity of 0, here only in a preset: the run is named
    const zero = def({ api: 'measured((pods - 1) * 400, "req/s", "load test")', extra: 'preset "one" { pods: 1 }' })
    expect(marks(zero)).toEqual([
      [
        'error',
        'out-of-range',
        'the capacity of "api" is 0 in the preset "one"',
        'a capacity is above 0',
        'measured((pods - 1) * 400, "req/s", "load test")',
      ],
    ])
  })

  it('writes a fix that means what it says', () => {
    const top = 'let x = fast ? 1 : 0'
    // a condition of lower precedence than != goes in parentheses
    expect(marks(def({ top, extra: 'param slow "Slow" { default: false; enabled: pods > 1 ? 1 : 0 }' }))).toEqual([
      [
        'error',
        'wrong-type',
        '"enabled" takes true or false, this is a number',
        'write (pods > 1 ? 1 : 0) != 0',
        'pods > 1 ? 1 : 0',
      ],
    ])
    // one mark for one mistake: the "!" around it is not blamed again
    expect(marks(def({ top: 'let x = !(pods || 2)' }))).toEqual([
      [
        'error',
        'wrong-type',
        '"||" takes true or false on both sides, these are numbers',
        'for a fallback, write pods != 0 ? pods : 2',
        '(pods || 2)',
      ],
    ])
    expect(marks(def({ top: 'let x = !(pods + 2)' }))).toEqual([
      ['error', 'wrong-type', '"!" takes true or false, this is a number', 'write (pods + 2) == 0', '!(pods + 2)'],
    ])
  })

  it('says when a demand is not a number, as a rate does: c19 held up to 0×', () => {
    const src = def().replace('demand: flows.req', 'demand: flows.req / (pods - 2)')
    expect(marks(src)).toEqual([
      ['warning', 'bad-demand', 'the demand of "api" is Infinity at the defaults', undefined, 'flows.req / (pods - 2)'],
    ])
  })

  it('leaves what is typed alone', () => {
    for (const top of [
      'let x = fast ? 1 : 2',
      'let x = 1 < load && load < 3',
      'let x = (load < 2) == fast',
      'let x = pods == 2 || !fast',
      // two answers compared on purpose: no chain
      'let x = (pods == 2) != (load == 1)',
      'let x = (pods == 2) == fast',
      'let x = `${pods}` == "2"',
    ])
      expect(marks(def({ top })), top).toEqual([])
    expect(marks(def({ extra: 'preset "big" { load: 10; pods: 3 }' }))).toEqual([])
  })
})
