import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, type Diagnostic } from '../src'

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

  it('compiles every example and the starter without a warning', () => {
    const dir = new URL('../../../examples/', import.meta.url)
    for (const ex of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()))
      for (const f of readdirSync(new URL(`${ex.name}/`, dir)).filter((f) => f.endsWith('.loadmap')))
        expect(compile(readFileSync(new URL(`${ex.name}/${f}`, dir), 'utf8')).diagnostics, f).toEqual([])
    const starter = new URL('../../../apps/playground/src/uploads.loadmap', import.meta.url)
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
    expect(value('`${pods} pods × ${kfmt(flows.req * 100)} = ${pct(0.5)}`')).toBe('2 pods × 20k = 50 %')
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
      ['x.y', '"x" has no entries: only flows., demand., util. and derived. do'],
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
