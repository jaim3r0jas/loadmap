import { readdirSync, readFileSync } from 'node:fs'
import {
  cache,
  configured,
  defineModel,
  estimated,
  limit,
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
import { pageOptions } from '../src/internal'

/** A small valid definition; `top` goes after the header, `flow` inside the flow, `extra` at the end. */
const def = (o: { top?: string; flow?: string; api?: string; extra?: string } = {}) => `loadmap 1
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
    const r = compile(def({ top: 'title: "T"\nlayout: down\nspeed: 4\nassume: "a"\nassume: "b"' }))
    expect(r.definition!.options).toEqual({ direction: 'DOWN', speed: 4, assumptions: ['a', 'b'] })
    expect(r.definition!.model.title).toBe('T')
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
      ['x.y', '"x" has no entries: only flows., at., demand., util. and derived. do'],
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
  it('compile in order, with their scenario, focus, seconds and values', () => {
    const top = `scenario "Today" {}
scenario "More" { pods: 3 }
step "Start." {}
step "More pods at 8×." { scenario: More; load: 8; fast: true; focus: api; seconds: 6 }`
    const m = compile(def({ top })).definition!.model
    expect(m.story).toEqual([
      { text: 'Start.', values: { load: 2, pods: 2, fast: false }, seconds: 4 },
      {
        text: 'More pods at 8×.',
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
step "x" { scenario: Later; focus: db; seconds: 0; pod: 2; pods: 9 }`
    expect(errors(def({ top }))).toEqual([
      { message: 'unknown scenario "Later"', hint: undefined, text: 'Later' },
      { message: 'unknown component "db"', hint: undefined, text: 'db' },
      { message: 'seconds is a duration above 0', hint: undefined, text: '0' },
      { message: 'unknown parameter "pod"', hint: 'did you mean "pods"?', text: 'pod' },
      { message: '9 is not an option of "pods"', hint: '1, 2, 3', text: '9' },
    ])
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
    expect(errors(def().replace('loadmap 1\n', ''))).toMatchObject([
      { message: 'a definition starts with "loadmap 1"', hint: 'add "loadmap 1" as the first line' },
    ])
    expect(errors(def().replace('loadmap 1', 'loadmap 2'))).toMatchObject([
      {
        message: 'this definition is written in language version 2; this loadmap reads version 1',
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
      extra: 'cluster k "K" { members: pods * 100; queue q { partitions { req: 3 } } }',
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
      top: `${scenarios}\nexpect "keeps 3×" { target: 3 }\nexpect { scenario: "Three pods"; full: 12; component: api }`,
    })
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.expectations).toEqual([
      { label: 'keeps 3×', target: 3 },
      { scenario: 'Three pods', component: 'api', full: 12 },
    ])
    expect(r.expectations.map((e) => [e.line, e.column, src.slice(e.at.from, e.at.to), e.result.ok])).toEqual([
      [4, 1, 'expect "keeps 3×"', true],
      [5, 1, 'expect', true],
    ])
    // 400 req/s a pod against 100 per 1×: 2 pods reach 50 % at 4×, 3 pods run out at 12×
    const failing = compile(def({ top: 'expect "keeps 5×" { target: 5 }' }))
    expect(failing.ok).toBe(true)
    expect(failing.expectations.map((e) => [e.line, e.result.ok, e.result.message])).toEqual([
      [2, false, 'expected at least 5×, but the 50 % target holds up to 4×, limited by API'],
    ])
  })

  it('point at the word an expect line gets wrong', () => {
    expect(errors(def({ top: `${scenarios}\nexpect { scenario: Today2; target: 1 }` }))).toEqual([
      { message: 'unknown scenario "Today2"', hint: 'did you mean "Today"?', text: 'Today2' },
    ])
    expect(errors(def({ top: 'expect { component: apu; target: 1 }' }))).toEqual([
      { message: 'unknown component "apu"', hint: 'did you mean "api"?', text: 'apu' },
    ])
    expect(errors(def({ top: 'expect "nothing" {}' }))).toEqual([
      { message: 'an expect needs a target or a full multiple', hint: 'expect { target: 8 }', text: 'expect' },
    ])
    expect(errors(def({ top: 'expect { target: 0 }' }))).toEqual([
      { message: 'target is a load multiple above 0', hint: undefined, text: '0' },
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
    const dsl = model(`loadmap 1
load "Load" { max: 10; default: 1 }
param hit "Hit ratio" { options: [0.5, 0.8]; default: 0.8 }
flow reads "reads" { rate: 1000 * load; route: cache -> db; from: client }
node client "Client"
node cache "Cache" {
  cache { hit: hit }
  capacity: measured(20_000, "ops/s")
  over: "lookups time out"
}
node db "DB" {
  store
  capacity: measured(500, "queries/s")
  over: "queries queue"
}
client -> cache
cache -> db: \`\${compact(at.db.reads)} misses/s\`
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      params: { hit: p.select({ label: 'Hit ratio', options: [0.5, 0.8], default: 0.8 }) },
      flows: { reads: { label: 'reads', rate: ({ load }) => 1000 * load } },
      components: {
        cache: { name: 'Cache', capacity: measured(20_000, 'ops/s'), over: 'lookups time out' },
        db: { name: 'DB', capacity: measured(500, 'queries/s'), over: 'queries queue' },
      },
      stages: { cache: cache({ hit: ({ hit }) => hit, component: 'cache' }), db: store('db') },
      routes: { reads: ['cache', 'db'] },
    })
    same(ts, dsl, [...loads, { hit: 0.5 }])
    expect(dsl.evaluate().at.db!.reads).toBeCloseTo(200)
  })

  it('compile an autoscaled pool', () => {
    const dsl = model(`loadmap 1
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
    const dsl = model(`loadmap 1
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
client -> limiter -> db
`)
    const ts = defineModel({
      load: p.load({ label: 'Load', max: 10, default: 1 }),
      flows: { req: { label: 'requests', rate: ({ load }) => 1000 * load } },
      components: {
        limiter: { name: 'Limiter', capacity: configured(1000, 'req/s', 'gateway config'), over: 'clients get 429s' },
        db: { name: 'DB', capacity: measured(2000, 'queries/s'), over: 'queries queue' },
      },
      stages: { limiter: limit('limiter'), db: store('db') },
      routes: { req: ['limiter', 'db'] },
    })
    same(ts, dsl, loads)
    expect(dsl.evaluate({ load: 1.5 }).at.db!.req).toBeCloseTo(1000)
  })

  it('compile retries with a budget, switched by a parameter', () => {
    const dsl = model(`loadmap 1
load "Load" { max: 10; default: 1 }
param tries "Retries" { options: [0, 3]; default: 3 }
param capped "Retry budget" { default: false }
flow req "requests" {
  rate: 1000 * load
  retry { times: tries }
  route: gateway -> service
  from: client
}
flow capped "capped requests" {
  rate: 100 * load
  retry { times: 3; budget: 0.1; when: capped }
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
        capped: p.switch({ label: 'Retry budget', default: false }),
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
          retry: ({ capped }) => (capped ? { times: 3, budget: 0.1 } : undefined),
        },
      },
      components: {
        gateway: { name: 'Gateway', capacity: measured(5000, 'req/s'), over: 'everyone gets errors' },
        service: { name: 'Service', capacity: measured(1000, 'req/s'), over: 'requests get 503s' },
      },
      stages: { gateway: pass('gateway'), service: pass('service') },
      routes: { req: ['gateway', 'service'], capped: ['gateway', 'service'] },
    })
    same(ts, dsl, [...loads, { tries: 0 }, { capped: true, load: 2 }])
    expect(dsl.evaluate({ load: 2 }).retry.req!.attempts).toBeGreaterThan(2000)
  })

  it('point at what a block is missing', () => {
    const at = (box: string) =>
      errors(`loadmap 1
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
