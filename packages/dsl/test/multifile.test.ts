import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addImport,
  compile,
  decodeShare,
  definitionAcross,
  encodeShare,
  flatten,
  gather,
  hover,
  importersOf,
  imports,
  libraryOf,
  referencesAcross,
  renameAcross,
} from '../src'
import { completionsAcross } from '../src/completion'
import {
  boxPath,
  edit,
  fileText,
  type InspectField,
  inspect,
  inspectCopy,
  relativePath,
  resolvePath,
  takeLine,
  writeInput,
} from '../src/internal'

/** The multi-file example of the docs: a model, its part, the library it imports and a variant. */
const DIR = 'docs/multi-file'
const read = (f: string) => readFileSync(new URL(`../../../${DIR}/${f}`, import.meta.url), 'utf8')
const MODEL = `${DIR}/shop.loadmap`
const STORY = `${DIR}/shop.story.loadmap`
const LIB = `${DIR}/platform.loadmap`
const BIG = `${DIR}/shop.big.loadmap`
const base: Readonly<Record<string, string>> = {
  [MODEL]: read('shop.loadmap'),
  [STORY]: read('shop.story.loadmap'),
  [LIB]: read('platform.loadmap'),
  [BIG]: read('shop.big.loadmap'),
}

/** The example with some files changed (a text), added, or taken out (null). */
const set = (changes: Record<string, string | null> = {}) => {
  const out: Record<string, string> = { ...base }
  for (const [p, text] of Object.entries(changes)) {
    if (text == null) delete out[p]
    else out[p] = text
  }
  return out
}
const run = (path: string, files: Record<string, string> = set()) => compile(files[path]!, { path, files })
const swap = (path: string, from: string, to: string) => {
  expect(base[path]).toContain(from)
  return base[path]!.replace(from, to)
}
const errors = (r: ReturnType<typeof compile>) => r.diagnostics.filter((d) => d.severity === 'error')

describe('a model in several files', () => {
  it('reads a part as its own statements, and says a mistake in the part, in the part', () => {
    const files = set({ [STORY]: swap(STORY, 'focus: orderLine.consumers }', 'focus: nowhere }') })
    const fromModel = errors(run(MODEL, files))
    expect(fromModel).toHaveLength(1)
    expect(fromModel[0]).toMatchObject({ code: 'unknown-name', file: STORY, line: 6 })
    // the same mistake from the part itself: it is this text's, so it names no file, at the same place
    const fromPart = errors(run(STORY, files))
    expect(fromPart).toHaveLength(1)
    expect(fromPart[0]!.file).toBeUndefined()
    expect(fromPart[0]).toMatchObject({ code: 'unknown-name', line: 6, column: fromModel[0]!.column })
    expect(files[STORY]!.slice(fromPart[0]!.from, fromPart[0]!.to)).toBe('nowhere')
  })

  it('wants a part to say its model, the model to include it, and both the same version', () => {
    // included, but no part
    const notPart = run(MODEL, set({ [STORY]: swap(STORY, 'part of "./shop.loadmap"\n', '') }))
    expect(errors(notPart)[0]).toMatchObject({ code: 'bad-file', data: { line: 'part of "./shop.loadmap"' } })
    // a part of another model
    const other = run(MODEL, set({ [STORY]: swap(STORY, './shop.loadmap', './other.loadmap') }))
    expect(errors(other)[0]).toMatchObject({ code: 'bad-file' })
    // a part its model does not include
    const left = run(STORY, set({ [MODEL]: swap(MODEL, 'include "./shop.story.loadmap"\n', '') }))
    expect(errors(left)[0]).toMatchObject({
      code: 'bad-file',
      data: { file: MODEL, line: 'include "./shop.story.loadmap"' },
    })
    // a part alone: its model is not among the files
    expect(errors(compile(base[STORY]!, { path: STORY }))[0]).toMatchObject({ code: 'missing-file' })
    // one namespace, one version
    const older = run(MODEL, set({ [STORY]: swap(STORY, 'loadmap 1.8', 'loadmap 1.1') }))
    expect(errors(older).map((d) => d.message)).toContain(
      `a part says its model's version: "${MODEL}" says loadmap 1.8`,
    )
    // what there is one of stays in the model's own file
    const twice = run(MODEL, set({ [STORY]: `${base[STORY]}title: "Mine"\nload "L" { max: 2 }\n` }))
    expect(errors(twice).map((d) => d.code)).toEqual(['misplaced', 'misplaced'])
  })

  it('reads a path as a path, from the file or the root, and nothing else', () => {
    expect(resolvePath('a/b/m.loadmap', './x.loadmap')).toEqual({ path: 'a/b/x.loadmap' })
    expect(resolvePath('a/b/m.loadmap', '../lib/x.loadmap')).toEqual({ path: 'a/lib/x.loadmap' })
    expect(resolvePath('a/b/m.loadmap', '/lib/x.loadmap')).toEqual({ path: 'lib/x.loadmap' })
    for (const bad of [
      'https://example.com/x.loadmap',
      '//example.com/x.loadmap',
      'file:///etc/x.loadmap',
      'x.loadmap',
      './x.txt',
      './x',
      '.\\x.loadmap',
      '../../../x.loadmap',
    ])
      expect(resolvePath('a/b/m.loadmap', bad), bad).toHaveProperty('error')
    expect(relativePath('a/b/m.loadmap', 'a/lib/x.loadmap')).toBe('../lib/x.loadmap')
    expect(relativePath('m.loadmap', 'x.loadmap')).toBe('./x.loadmap')
    // a file is found by its own name only: nothing an object inherits is a file
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty'])
      expect(fileText({}, name)).toBeUndefined()
    // in a definition: an error where the path is written, and the model does not compile
    const url = run(
      MODEL,
      set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"https://example.com/platform.loadmap"') }),
    )
    expect(errors(url)[0]).toMatchObject({ code: 'missing-file', line: 3 })
    expect(errors(url)[0]!.message).toContain('never by a URL')
    const out = run(MODEL, set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"../../../etc/platform.loadmap"') }))
    expect(errors(out)[0]!.message).toContain('leaves the project')
  })

  it('says which file is missing, where it is named', () => {
    const r = run(MODEL, set({ [LIB]: null }))
    expect(errors(r)[0]).toMatchObject({ code: 'missing-file', line: 3 })
    expect(errors(r)[0]!.message).toContain(`there is no "${LIB}"`)
    // without any files: the same, said for a definition that came as one file
    expect(errors(compile(base[MODEL]!))[0]).toMatchObject({ code: 'missing-file' })
  })

  it('takes from a library what it declares by name, and nothing private', () => {
    const none = run(MODEL, set({ [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; nope }') }))
    expect(errors(none)[0]).toMatchObject({ code: 'unknown-name', message: `"${LIB}" has no "nope"` })
    const lib = swap(LIB, 'let messageCost = 2ms', 'let _hidden = 1\nlet messageCost = 2ms')
    const secret = run(
      MODEL,
      set({ [LIB]: lib, [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; _hidden }') }),
    )
    expect(errors(secret)[0]!.message).toContain('is private')
    // a value under another name: the library's let, as a let of the model
    const renamed = run(
      MODEL,
      set({ [MODEL]: swap(MODEL, '{ postgres; pipeline }', '{ postgres; pipeline; cost: messageCost }') }),
    )
    expect(errors(renamed)).toEqual([])
    expect(renamed.symbols.find((s) => s.id === 'cost')).toMatchObject({ kind: 'let' })
    // only a library is imported
    const model = run(MODEL, set({ [MODEL]: swap(MODEL, '"./platform.loadmap"', '"./shop.big.loadmap"') }))
    expect(errors(model)[0]).toMatchObject({ code: 'bad-file' })
  })

  it('refuses libraries that import each other', () => {
    const a = 'loadmap 1.5\nlibrary "A"\nimport "./b.loadmap" { y }\nlet x = y\n'
    const b = 'loadmap 1.5\nlibrary "B"\nimport "./a.loadmap" { x }\nlet y = x\n'
    const r = compile(a, { path: 'a.loadmap', files: { 'a.loadmap': a, 'b.loadmap': b } })
    const loop = errors(r).find((d) => d.code === 'import-loop')
    expect(loop?.message).toBe('libraries import each other in a loop: a.loadmap → b.loadmap → a.loadmap')
  })

  it('keeps a library to its inputs and its own names, and a model out of the library', () => {
    // a library's line reads a name of the model: an error in the library, whoever imports it
    const leak = set({
      [LIB]: swap(LIB, 'demand: flows.main * messageCost', 'demand: flows.main * messageCost * pods2'),
    })
    for (const from of [MODEL, LIB]) {
      const found = errors(run(from, leak)).find((d) => d.message.includes('"pods2"'))
      expect(found, from).toMatchObject({ code: 'unknown-name' })
      expect(found!.file, from).toBe(from === LIB ? undefined : LIB)
    }
    // a flow is the model's: a library takes its name as an input
    const flow = errors(run(MODEL, set({ [LIB]: swap(LIB, 'demand: writes', 'demand: flows.orders') })))
    expect(flow[0]).toMatchObject({ code: 'wrong-scope', file: LIB })
    // the model does not see what it did not import
    const inside = errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'rate: 40 * load', 'rate: 40 * load * messageCost') })))
    expect(inside[0]).toMatchObject({ code: 'unknown-name', message: 'unknown name "messageCost"' })
    expect(inside[0]!.file).toBeUndefined()
  })

  it('checks the inputs where they are set', () => {
    const withs = (to: string) =>
      errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'with { main: orders; pods: pods }', to) })))
    expect(withs('with { pods: pods }')[0]).toMatchObject({ code: 'bad-input', data: { input: 'main' } })
    expect(withs('with { main: orders; pods: pods; threads: 4 }')[0]).toMatchObject({
      code: 'bad-input',
      message: '"pipeline" has no input "threads"',
    })
    expect(withs('with { main: 3; pods: pods }')[0]).toMatchObject({ code: 'bad-input' })
    // a default is left as it is: the library's 3 pods
    expect(withs('with { main: orders }')).toEqual([])
    const db = (to: string) => errors(run(MODEL, set({ [MODEL]: swap(MODEL, 'with { writes: flows.orders }', to) })))
    expect(db('with { writes: flows.orders; limit: "a lot" }')[0]).toMatchObject({ code: 'wrong-type' })
    expect(db('with { limit: 9_000 }')[0]).toMatchObject({ code: 'bad-input', data: { input: 'writes' } })
    // a formula against the default: one type, and one unit where both say theirs
    // said once, by the line that reads the input where it refuses the type itself
    expect(db('with { writes: flows.orders; limit: pods > 3 }').filter((d) => d.code === 'wrong-type')).toHaveLength(1)
    // a default that reads the library's own name is typed by it, whatever the model calls its own
    const named = set({
      [LIB]: swap(LIB, 'input limit = 4_000', 'input limit = 4_000\n  input note = messageCost'),
      [MODEL]: swap(MODEL, 'with { writes: flows.orders }', 'with { writes: flows.orders; note: pods > 3 }'),
    })
    expect(errors(run(MODEL, named)).map((d) => d.message)).toEqual([
      '"note" takes a number, as its default is; this is true or false',
    ])
    const held = set({
      [LIB]: swap(LIB, 'input limit = 4_000', 'input limit = 4_000\n  input wait = 20ms').replace(
        'over: "commits queue on the primary"',
        'over: "commits queue on the primary"\n  service: wait',
      ),
    })
    const unit = (value: string) =>
      run(MODEL, {
        ...held,
        [MODEL]: swap(MODEL, 'with { writes: flows.orders }', `with { writes: flows.orders; wait: ${value} }`),
      }).diagnostics.filter((d) => d.code === 'unit-mismatch')
    expect(unit('pods * 5ms')).toEqual([])
    // a day is a time, as 20ms is: never "a size"
    expect(unit('1d').map((d) => d.message)).not.toContainEqual(expect.stringContaining('its default is'))
    // a bare number is any unit: only what says its own is compared
    expect(unit('flows.orders * 2')).toEqual([])
    // said at the input, beside what the line that reads it says of its own
    expect(unit('flows.orders').map((d) => d.message)).toContain(
      '"wait" is in seconds, as its default 20ms is; this is per second',
    )
    // a box of the model has no inputs
    const local = errors(
      run(
        MODEL,
        set({ [MODEL]: `${base[MODEL]}node db2 "Second" { like: db; with { writes: 1 } }\ngateway -> db2\n` }),
      ),
    )
    expect(local.map((d) => d.code)).toContain('bad-input')
  })

  it('gives the view each subsystem that holds a box, for the frame around its boxes', () => {
    const view = run(MODEL).definition!.view.def
    expect(view.subsystems).toEqual({ orderLine: { label: 'Orders' } })
    // one without a name of its own takes that of the one it is like; one in another is named after it; an empty one
    // is none
    const nested = run(
      MODEL,
      set({
        [MODEL]: swap(MODEL, 'subsystem orderLine "Orders" {', 'subsystem orderLine {').concat(
          'subsystem outer "Outer" {\n  subsystem inner { like: pipeline; with { main: orders } }\n  subsystem empty "Empty" {}\n}\n',
        ),
      }),
    )
    expect(errors(nested)).toEqual([])
    expect(nested.definition!.view.def.subsystems).toEqual({
      orderLine: { label: 'Queue and workers' },
      outer: { label: 'Outer' },
      'outer.inner': { label: 'Queue and workers' },
    })
    expect(Object.keys(nested.definition!.view.def.nodes)).toContain('outer.inner.kafka')
    // a model without subsystems says nothing of them
    const plain = compile(
      'loadmap 1.5\nload "x" { max: 10 }\nflow f "f" { rate: load; route: a; from: s }\nnode s "S"\nnode a "A" { pass; capacity: estimated(10, "req/s"); over: "x" }\ns -> a\n',
    )
    expect(errors(plain)).toEqual([])
    expect(plain.definition!.view.def).not.toHaveProperty('subsystems')
  })

  it('reads the subsystems drawn closed, in view and in a step, from loadmap 1.5', () => {
    const src = (extra = '', version = '1.5') =>
      [
        `loadmap ${version}`,
        'view { closed: [eu, eu.line] }',
        'load "x" { max: 10; default: 1 }',
        'flow f "f" { rate: load; route: eu.gw -> eu.line.a; from: s }',
        'node s "S"',
        'subsystem eu "EU" {',
        '  node gw "G" { pass; capacity: estimated(10, "req/s"); over: "x" }',
        '  subsystem line "Line" { node a "A" { pass; capacity: estimated(10, "req/s"); over: "x" } }',
        '  gw -> line.a',
        '}',
        's -> eu.gw',
        'step "one" { load: 2; closed: [eu.line] }',
        'step "two" { load: 3; closed: [] }',
        'step "three" { load: 3 }',
        extra,
        '',
      ].join('\n')
    const r = compile(src())
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.options.closed).toEqual(['eu', 'eu.line'])
    // a step says its own, an empty list for every one open; without the line it has none of its own
    expect(r.definition!.model.story.map((st) => st.closed)).toEqual([['eu.line'], [], undefined])
    const said = (extra: string, version?: string) => compile(src(extra, version)).diagnostics.map((d) => d.message)
    expect(said('step "bad" { closed: [nope, eu, eu] }')).toEqual(['unknown subsystem "nope"', '"eu" is listed twice'])
    expect(said('step "bad" { closed: eu }')).toEqual(['a list of subsystems: [eu, us]'])
    // a file stamped before 1.5 has to say 1.5 to use it
    expect(said('', '1.4').every((m) => m.includes('"closed:" is from loadmap 1.5'))).toBe(true)
    expect(said('', '1.4')).toHaveLength(2)
  })

  it('names copies of one subsystem apart, by the subsystems around them that differ', () => {
    const lib = [
      'loadmap 1.5',
      'library "Regions"',
      'subsystem line "Orders" {',
      '  input flow main',
      '  node workers "Workers" { pass; demand: flows.main; capacity: estimated(10, "req/s"); over: "x"; short: "the workers" }',
      '}',
      'subsystem region "Region" {',
      '  input flow main',
      '  node api "API" { pass; demand: flows.main; capacity: estimated(100, "req/s"); over: "x" }',
      '  subsystem orders { like: line; with { main: main } }',
      '  api -> orders.workers',
      '}',
      '',
    ].join('\n')
    const model = [
      'loadmap 1.5',
      'import "./regions.loadmap" { region }',
      'load "x" { max: 10; default: 1 }',
      'flow eu "eu" { rate: load; route: eu.api -> eu.orders.workers; from: s }',
      'flow us "us" { rate: 2 * load; route: us.api -> us.orders.workers; from: s }',
      'node s "S"',
      'node api "API" { pass; demand: flows.eu; capacity: estimated(100, "req/s"); over: "x" }',
      'subsystem eu "EU region" { like: region; with { main: eu } }',
      'subsystem us "US region" { like: region; with { main: us } }',
      's -> eu.api',
      's -> us.api',
      's -> api',
      '',
    ].join('\n')
    const r = compile(model, { path: 'm.loadmap', files: { 'm.loadmap': model, 'regions.loadmap': lib } })
    expect(errors(r)).toEqual([])
    const named = Object.fromEntries(
      Object.entries(r.definition!.model.def.components as Record<string, { name: string; short?: string }>).map(
        ([id, c]) => [id, [c.name, c.short]],
      ),
    )
    expect(named).toEqual({
      // "Orders" is the same in both regions: it tells nothing apart, so it is left out
      'eu.orders.workers': ['EU region › Workers', 'the workers in EU region'],
      'us.orders.workers': ['US region › Workers', 'the workers in US region'],
      'eu.api': ['EU region › API', 'API in EU region'],
      'us.api': ['US region › API', 'API in US region'],
      // one outside every subsystem keeps its name
      api: ['API', undefined],
    })
    // the box keeps its label: its frame says where it stands
    expect(r.definition!.view.def.nodes['eu.orders.workers']!.label).toBe('Workers')
    // the verdict says which copy runs out
    const ev = r.definition!.model.evaluate({ load: 8 })
    expect(ev.verdict.text).toContain('the workers in US region')
    // copies without names of their own both read "Region": their ids tell them apart
    const plain = model.replace(' "EU region"', '').replace(' "US region"', '')
    const p = compile(plain, { path: 'm.loadmap', files: { 'm.loadmap': plain, 'regions.loadmap': lib } })
    const c = p.definition!.model.def.components as Record<string, { name: string }>
    expect([c['eu.orders.workers']!.name, c['us.orders.workers']!.name]).toEqual(['eu › Workers', 'us › Workers'])
  })

  it('writes a subsystem out under its id, and bounds how far that goes', () => {
    const r = run(MODEL)
    expect(r.definition!.model.stageIds).toEqual(['gateway', 'orderLine.topic', 'orderLine.consumers', 'db'])
    // its boxes are found in the library, where they are written
    expect(r.symbols.find((s) => s.kind === 'node' && s.id === 'orderLine.consumers')).toMatchObject({ file: LIB })
    // subsystems inside subsystems, at most four deep
    const deep = ['loadmap 1.5', 'library "Deep"', 'subsystem s0 "S" { node n "N" }']
    for (let i = 1; i <= 5; i++) deep.push(`subsystem s${i} "S" { subsystem inner "I" { like: s${i - 1} } }`)
    const files = set({
      [`${DIR}/deep.loadmap`]: `${deep.join('\n')}\n`,
      [MODEL]: swap(
        MODEL,
        'import "./platform.loadmap" { postgres; pipeline }',
        'import "./platform.loadmap" { postgres; pipeline }\nimport "./deep.loadmap" { s5 }',
      ).concat('subsystem tower "T" { like: s5 }\n'),
    })
    expect(errors(run(MODEL, files)).map((d) => d.code)).toContain('too-large')
    // and no more boxes than a definition may have
    const many = Array.from({ length: 260 }, (_, i) => `node extra${i} "X"`).join('\n')
    const crowd = errors(run(MODEL, set({ [MODEL]: `${base[MODEL]}${many}\n` })))
    expect(crowd.find((d) => d.code === 'too-large')?.message).toContain('at most 256 boxes')
    // and past that nothing more is written out: a few lines cannot make millions of boxes
    const wide3 = ['loadmap 1.5', 'library "Wide"', 'subsystem w0 "W" { node n "N" }']
    for (let i = 1; i <= 3; i++)
      wide3.push(
        `subsystem w${i} "W" {\n${Array.from({ length: 150 }, (_, k) => `  subsystem x${k} "X" { like: w${i - 1} }`).join('\n')}\n}`,
      )
    const flood = run(
      MODEL,
      set({
        [`${DIR}/wide.loadmap`]: `${wide3.join('\n')}\n`,
        [MODEL]: swap(
          MODEL,
          'import "./platform.loadmap" { postgres; pipeline }',
          'import "./platform.loadmap" { postgres; pipeline }\nimport "./wide.loadmap" { w3 }',
        ).concat('subsystem flood "F" { like: w3 }\n'),
      }),
    )
    expect(errors(flood).filter((d) => d.code === 'too-large')).toHaveLength(1)
    // a route that names what the subsystem does not hold says the name
    const typo = errors(run(MODEL, set({ [LIB]: swap(LIB, 'route: topic -> consumers', 'route: topik -> consumers') })))
    expect(typo.map((d) => d.message)).toContain('"topik" is no stage of this subsystem')
    // nor more files
    const parts: Record<string, string> = {}
    let head = ''
    for (let i = 0; i < 70; i++) {
      parts[`${DIR}/p${i}.loadmap`] = 'loadmap 1.5\npart of "./shop.loadmap"\n'
      head += `include "./p${i}.loadmap"\n`
    }
    const wide = run(
      MODEL,
      set({
        ...parts,
        [MODEL]: swap(MODEL, 'include "./shop.story.loadmap"\n', `include "./shop.story.loadmap"\n${head}`),
      }),
    )
    expect(errors(wide).find((d) => d.code === 'too-large')?.message).toContain('at most 64 files')
  })

  it('lays a variant over its model: what it writes, and nothing of the system', () => {
    const r = run(BIG)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.defaults().pods).toBe(6)
    // the rest of the parameter is its model's
    expect(r.definition!.model.params.find((p) => p.id === 'pods')!.def.label).toBe('Worker pods')
    const unknown = errors(
      run(BIG, set({ [BIG]: swap(BIG, 'param pods { default: 6 }', 'param cores { default: 6 }') })),
    )
    expect(unknown[0]).toMatchObject({ code: 'unknown-name', message: `"${MODEL}" has no param "cores"` })
    const box = errors(run(BIG, set({ [BIG]: `${base[BIG]}node extra "X"\n` })))
    expect(box[0]).toMatchObject({ code: 'misplaced' })
  })

  it('knows a file by its head, and gathers every file a definition reaches', () => {
    expect(imports(base[MODEL]!, MODEL)).toEqual({
      role: 'model',
      files: [
        { kind: 'include', written: './shop.story.loadmap', path: STORY, names: [] },
        { kind: 'import', written: './platform.loadmap', path: LIB, names: ['postgres', 'pipeline'] },
      ],
    })
    expect(imports(base[STORY]!, STORY).role).toBe('part')
    expect(imports(base[LIB]!, LIB).role).toBe('library')
    expect(imports(base[BIG]!, BIG).role).toBe('variant')
    const files = set()
    // from the part: the file to open is its model
    const fromPart = gather(base[STORY]!, { path: STORY, files })
    expect(fromPart.path).toBe(MODEL)
    expect(Object.keys(fromPart.files).sort()).toEqual([LIB, MODEL, STORY])
    expect(fromPart.missing).toEqual([])
    // a variant is opened as itself, with its model's files
    const fromVariant = gather(base[BIG]!, { path: BIG, files })
    expect(fromVariant.path).toBe(BIG)
    expect(Object.keys(fromVariant.files).sort()).toEqual([LIB, BIG, MODEL, STORY].sort())
    expect(gather(base[MODEL]!, { path: MODEL }).missing.sort()).toEqual([LIB, STORY])
  })

  it('carries every file in a link, and one file in the link it always made', async () => {
    const files = { [MODEL]: base[MODEL]!, [STORY]: base[STORY]!, [LIB]: base[LIB]! }
    const hash = await encodeShare(base[MODEL]!, { load: 30 }, { path: MODEL, files })
    expect(hash).toMatch(/^v2\./)
    expect(await decodeShare(`#${hash}`)).toEqual({ source: base[MODEL], values: { load: '30' }, path: MODEL, files })
    // one file: the link every page out there reads
    const one = await encodeShare(base[MODEL]!, {}, { path: MODEL, files: { [MODEL]: base[MODEL]! } })
    expect(one).toMatch(/^v1\./)
    expect(await decodeShare(one)).toEqual({ source: base[MODEL], values: {} })
    // a link is untrusted: a path that is none, a file that is no text, an entry that is not there
    const pack = async (data: unknown) => {
      const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      return `v2.${btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')}`
    }
    for (const bad of [
      { entry: 'a.loadmap', files: { '../a.loadmap': 'x' } },
      { entry: 'a.loadmap', files: { 'a.loadmap': 1 } },
      { entry: 'b.loadmap', files: { 'a.loadmap': 'x' } },
      { entry: 'a.loadmap', files: { 'a.loadmap': 'x', 'b.txt': 'y' } },
      [],
    ])
      expect(await decodeShare(await pack(bad)), JSON.stringify(bad)).toHaveProperty('error')
  })

  it('flattens to one file that computes the same', () => {
    const flat = flatten(base[MODEL]!, { path: MODEL, files: set() })
    if ('error' in flat) throw new Error(`${flat.error}: ${flat.diagnostics.map((d) => d.message).join('; ')}`)
    expect(flat.text).not.toMatch(/^(include|import)\b/m)
    expect(flat.text).toContain('pool orderLine.consumers')
    // what stays of the subsystem is its first line, for the frame around its boxes
    expect(flat.text).toMatch(/^subsystem orderLine "Orders"$/m)
    expect(flat.text).not.toMatch(/^subsystem .*\{/m)
    const one = compile(flat.text)
    expect(one.diagnostics).toEqual([])
    const several = run(MODEL)
    expect(one.definition!.view.def.subsystems).toEqual(several.definition!.view.def.subsystems)
    const [a, b] = [one.definition!.model, several.definition!.model]
    expect([a.flowIds, a.componentIds, a.stageIds]).toEqual([b.flowIds, b.componentIds, b.stageIds])
    expect([a.scenarios, a.expectations, a.story]).toEqual([b.scenarios, b.expectations, b.story])
    for (const load of [1, 30, 90]) {
      const [x, y] = [a.evaluate({ load }), b.evaluate({ load })]
      expect(x.components).toEqual(y.components)
      expect(x.verdict).toEqual(y.verdict)
      expect(x.ranked.map((c) => c.id)).toEqual(y.ranked.map((c) => c.id))
    }
    // a library has no model to write out
    expect(flatten(base[LIB]!, { path: LIB, files: set() })).toMatchObject({
      error: expect.stringContaining('library'),
    })
    // a definition that does not compile has no flat copy
    expect(flatten(base[MODEL]!)).toHaveProperty('error')
  })

  it('changes a box of the model from the file it is written in', () => {
    const files = set()
    const r = edit(base[MODEL]!, 'node:gateway/short', 'the front door', { path: MODEL, files })
    if ('error' in r) throw new Error(r.error)
    expect(r.source).toContain('short: "the front door"')
    expect(compile(r.source, { path: MODEL, files }).ok).toBe(true)
  })
})

describe('a box like another', () => {
  it('lets a pool of 1.5 like a pool of a 1.4 library write its own workers, and flattens it to 1.5', () => {
    const lib = [
      'loadmap 1.4',
      'library "L"',
      'pool workersT "W" {',
      '  workers "the work" { pods: 3; perPod: 8; placement: in-order }',
      '  demand: 1',
      '  capacity: measured(2, "cores")',
      '  over: "lag"',
      '}',
      '',
    ].join('\n')
    const model = (pool: string) =>
      `loadmap 1.5\nimport "./lib.loadmap" { workersT }\nload { max: 2 }\nflow f { rate: load; route: w; from: a }\nnode a "A"\n${pool}\na -> w\n`
    const o = { path: 'm.loadmap', files: { 'lib.loadmap': lib } }
    const stage = (pool: string) => {
      const r = compile(model(pool), o)
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      return r.definition!.model.evaluate().stages.w
    }
    // the block's lines are pool lines here: one written here replaces the same one there
    expect(stage('pool w { like: workersT; pods: 6 }')).toMatchObject({ label: 'the work', perPod: 8, pods: 6 })
    expect(stage('pool w { like: workersT; autoscale { min: 1; max: 4; target: 0.7 } }')).toMatchObject({
      autoscale: { min: 1, max: 4, target: 0.7 },
    })
    expect(stage('pool w { like: workersT }')).toMatchObject({ pods: 3, placement: 'in-order' })
    // its flat copy is written in 1.5: the workers on the pool
    const flat = flatten(model('pool w { like: workersT }'), o)
    if ('error' in flat) throw new Error(flat.error)
    expect(flat.text).toContain('  stageLabel: "the work"\n  pods: 3\n  perPod: 8\n')
    expect(compile(flat.text).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  const twins = [
    'loadmap 1.5',
    'load "L" { max: 2 }',
    'flow f "f" { rate: load; route: a; from: start }',
    'node start "Start"',
    'node a "A" { store; capacity: estimated(1_000, "req/s", "a test"); over: "requests queue" }',
    'node b "B" { like: a; short: "the second" }',
    'start -> a',
    '',
  ].join('\n')

  it('says in a hover and in the inspector what it takes from the other', () => {
    const h = hover(twins, twins.indexOf('node b') + 5)
    expect(h?.body[0]).toBe('Like `a`: from it `store`, `capacity`, `over`.')
    const box = inspect(twins, { node: 'b' })!.sections[0]!
    expect(box.like).toMatchObject({ from: 'a', taken: ['store', 'capacity', 'over'] })
    // the lines among them, as the other writes them; one written here is this box's own from then on
    expect(box.like!.lines).toEqual([
      { name: 'capacity', text: 'estimated(1_000, "req/s", "a test")' },
      { name: 'over', text: '"requests queue"' },
    ])
    const taken = takeLine(twins, 'b', 'capacity')
    if ('error' in taken) throw new Error(taken.error)
    expect(taken.source).toContain(
      'node b "B" { like: a; short: "the second"; capacity: estimated(1_000, "req/s", "a test") }',
    )
    expect(inspect(taken.source, { node: 'b' })!.sections[0]!.like!.taken).toEqual(['store', 'over'])
    expect(takeLine(twins, 'b', 'short')).toHaveProperty('error')
    // a line that reads the other box by its name reads this one here, as the compiler takes it
    const self = twins.replace('over: "requests queue"', 'over: "requests queue"; demand: at.a.f * 2')
    const mine = takeLine(self, 'b', 'demand')
    if ('error' in mine) throw new Error(mine.error)
    expect(mine.source).toContain('short: "the second"; demand: at.b.f * 2 }')
    // in a block of lines: under the last one, a comment at its end left where it is
    const tall = twins.replace('{ like: a; short: "the second" }', '{\n  like: a\n  short: "the second" # why\n}')
    const under = takeLine(tall, 'b', 'over')
    if ('error' in under) throw new Error(under.error)
    expect(under.source).toContain('  short: "the second" # why\n  over: "requests queue"\n}')
    // a stage written here replaces the other's stages, and what the other takes from a third comes along
    const chain = `${twins}node c "C" { like: b; pass; short: "the third" }\nstart -> c\n`
    expect(inspect(chain, { node: 'c' })!.sections[0]!.like).toMatchObject({ from: 'b', taken: ['capacity', 'over'] })
    // with what it sets of the other's inputs
    const db = hover(base[MODEL]!, base[MODEL]!.indexOf('node db') + 5)
    expect(db?.body.slice(0, 2)).toEqual([
      'Like `postgres`: what it does not write itself comes from there.',
      'Sets `writes`: `flows.orders`.',
    ])
    // a prototype of a library: the other box is not in this text
    expect(inspect(base[MODEL]!, { node: 'db' })!.sections[0]!.like).toMatchObject({ from: 'postgres', taken: [] })
  })
})

describe('a box inside a subsystem, in the inspector', () => {
  const lib = [
    'loadmap 1.5',
    'library "Regions"',
    'subsystem line "Orders" {',
    '  input flow main',
    '  node workers "Workers" { pass; demand: flows.main; capacity: estimated(10, "req/s"); over: "x" }',
    '}',
    'subsystem region "Region" {',
    '  input flow main',
    '  node api "API" { pass; demand: flows.main; capacity: estimated(100, "req/s"); over: "x" }',
    '  subsystem orders { like: line; with { main: main } }',
    '  api -> orders.workers',
    '}',
    '',
  ].join('\n')
  const model = [
    'loadmap 1.5',
    'import "./regions.loadmap" { region }',
    'load "x" { max: 10; default: 1 }',
    'flow eu "eu" { rate: load; route: eu.api -> eu.orders.workers; from: s }',
    'flow us "us" { rate: 2 * load; route: us.api -> us.orders.workers; from: s }',
    'node s "S"',
    'subsystem eu "EU region" { like: region; with { main: eu } }',
    'subsystem us "US region" { like: region; with { main: us } }',
    's -> eu.api',
    's -> us.api',
    '',
  ].join('\n')
  const files = { 'm.loadmap': model, 'regions.loadmap': lib }

  it('is found by its place in the file that writes it, one statement for a box in each subsystem like it', () => {
    const r = compile(model, { path: 'm.loadmap', files })
    expect(errors(r)).toEqual([])
    // the diagram's ids are of the model; the statement that writes each is in the library, under another name
    const boxes = r.symbols.filter((s) => s.kind === 'node' && s.file === 'regions.loadmap')
    expect(Object.fromEntries(boxes.map((s) => [s.id, boxPath(lib, s.decl.from)]))).toEqual({
      'eu.api': 'subsystem:region/node:api',
      'eu.orders.workers': 'subsystem:line/node:workers',
      'us.api': 'subsystem:region/node:api',
      'us.orders.workers': 'subsystem:line/node:workers',
    })
    // no statement at the top says "eu.api": its place finds it
    expect(inspect(lib, { node: 'eu.api' })).toBeNull()
    const box = inspect(lib, { node: 'eu.api', path: 'subsystem:region/node:api' })!
    expect(box.title).toBe('API')
    expect(box.sections.map((s) => [s.path, s.fields.map((f) => f.key)])).toEqual([
      [
        'subsystem:region/node:api',
        [
          'subsystem:region/node:api/@label',
          'subsystem:region/node:api/demand',
          'subsystem:region/node:api/capacity',
          'subsystem:region/node:api/over',
        ],
      ],
    ])
    // a change is one edit of the library, and of the box in every region
    const e = edit(lib, 'subsystem:region/node:api/@label', 'Front', { path: 'regions.loadmap', files })
    if ('error' in e) throw new Error(e.error)
    expect(e.source).toContain('  node api "Front" { pass;')
    const nodes = compile(model, { path: 'm.loadmap', files: { ...files, 'regions.loadmap': e.source } }).definition!
      .view.def.nodes
    expect([nodes['eu.api']!.label, nodes['us.api']!.label]).toEqual(['Front', 'Front'])
    // anywhere in its lines; no box outside them, none in a text with a syntax error
    expect(boxPath(lib, lib.indexOf('estimated(100'))).toBe('subsystem:region/node:api')
    expect(boxPath(lib, lib.indexOf('input flow main'))).toBeUndefined()
    expect(boxPath('node a {', 2)).toBeUndefined()
  })

  it('reads what is around it, and is like a box of the top', () => {
    const one = [
      'loadmap 1.5',
      'load "L" { max: 2 }',
      'param cost "Cost" { default: 2; min: 1; max: 4 }',
      'flow f "f" { rate: load; route: a -> eu.b; from: start }',
      'node start "Start"',
      'node a "A" { store; demand: flows.f * cost; capacity: estimated(1_000, "req/s", "a test"); over: "requests queue" }',
      'subsystem eu "EU" {',
      '  let twice = cost * 2',
      '  node a "Inner A" { pass; demand: flows.f * twice; capacity: estimated(5, "req/s"); over: "y" }',
      '  node b "B" { like: a; short: "the second" }',
      '}',
      'start -> a',
      'a -> eu.b',
      '',
    ].join('\n')
    const r = compile(one)
    expect(errors(r)).toEqual([])
    expect(r.symbols.filter((s) => s.kind === 'node').map((s) => [s.id, boxPath(one, s.decl.from)])).toEqual([
      ['start', 'node:start'],
      ['a', 'node:a'],
      ['eu.a', 'subsystem:eu/node:a'],
      ['eu.b', 'subsystem:eu/node:b'],
    ])
    // the parameter it reads through a let of its subsystem comes along, as for a box of the top
    const paths = (id: string, path: string) => inspect(one, { node: id, path })!.sections.map((s) => s.path)
    expect(paths('eu.a', 'subsystem:eu/node:a')).toEqual(['subsystem:eu/node:a', 'param:cost'])
    expect(paths('a', 'node:a')).toEqual(['node:a', 'param:cost'])
    // a name its subsystem declares hides the same name of the top: the box does not read that parameter
    const hidden = one.replace('let twice = cost * 2', 'let cost = 3').replace('flows.f * twice', 'flows.f * cost')
    expect(errors(compile(hidden))).toEqual([])
    expect(inspect(hidden, { node: 'eu.a', path: 'subsystem:eu/node:a' })!.sections.map((s) => s.path)).toEqual([
      'subsystem:eu/node:a',
    ])
    // "a" is the box of the top, as the compiler takes it, not the one beside it
    const b = inspect(one, { node: 'eu.b', path: 'subsystem:eu/node:b' })!.sections[0]!
    expect(b.like).toEqual({
      from: 'a',
      taken: ['store', 'demand', 'capacity', 'over'],
      lines: [
        { name: 'demand', text: 'flows.f * cost' },
        { name: 'capacity', text: 'estimated(1_000, "req/s", "a test")' },
        { name: 'over', text: '"requests queue"' },
      ],
    })
    const taken = takeLine(one, 'b', 'capacity', {}, 'subsystem:eu/node:b')
    if ('error' in taken) throw new Error(taken.error)
    expect(taken.source).toContain(
      '  node b "B" { like: a; short: "the second"; capacity: estimated(1_000, "req/s", "a test") }',
    )
    // without its place there is no "b" at the top
    expect(takeLine(one, 'b', 'capacity')).toHaveProperty('error')
    expect(takeLine(one, 'b', 'short', {}, 'subsystem:eu/node:b')).toHaveProperty('error')
  })
})

describe('a box of one copy of a subsystem, in the inspector', () => {
  const dir = new URL('../../../examples/regions/', import.meta.url)
  const files: Record<string, string> = Object.fromEntries(
    ['regions.loadmap', 'regions.story.loadmap', 'region.loadmap', 'platform.loadmap', 'regions.even.loadmap'].map(
      (f) => [f, readFileSync(new URL(f, dir), 'utf8')],
    ),
  )
  const MAIN = 'regions.loadmap'
  const value = (f: InspectField) =>
    f.kind === 'number' || f.kind === 'boolean' || f.kind === 'text'
      ? String(f.value)
      : f.kind === 'formula'
        ? f.parts.map((p) => (typeof p === 'string' ? p : `[${p.value}]`)).join('')
        : f.kind
  const copyOf = (box: string, now: Record<string, string> = files) => {
    const r = compile(now[MAIN]!, { path: MAIN, files: now })
    const c = inspectCopy(r, box, { path: MAIN, read: now, now })
    return (
      c && {
        copy: c.copy,
        title: c.title,
        file: c.file,
        fields: c.sections[0]!.fields.map((f) => `${f.label}: ${value(f)}${f.from ? ` (${f.from})` : ''}`),
        more: c.sections.slice(1).map((s) => s.path),
      }
    )
  }

  it("shows what each copy's with sets of the inputs that reach the box, through every file between", () => {
    // its own line of the with of "eu", in the model: the box is written in the library
    expect(copyOf('eu.api')).toEqual({
      copy: 'eu',
      title: 'EU region',
      file: MAIN,
      fields: ['apiPods: 10'],
      more: [],
    })
    // a default where the copy sets none
    expect(copyOf('us.db')?.fields).toEqual(['dbLimit: 4000 (region)'])
    // through a prototype's with in the library (db is like postgres, its limit is dbLimit) and a subsystem in a
    // subsystem (the workers' pods are the region's); a value that reads a parameter brings it along
    expect(copyOf('eu.db')?.fields).toEqual(['dbLimit: 6000'])
    expect(copyOf('eu.orders.workers')?.fields).toEqual(['pods: 4'])
    expect(copyOf('us.orders.workers')).toMatchObject({ fields: ['pods: usPods'], more: ['param:usPods'] })
    // nothing of the load balancer is set per copy; a box written for itself alone has no copy
    expect(copyOf('us.lb')?.fields).toEqual([])
    expect(copyOf('router')).toBeNull()
    // a with in the library that every copy shares sets it for all of them: the copy has nothing of it
    const fixed = {
      ...files,
      'region.loadmap': files['region.loadmap']!.replace('pods: pods }', 'pods: 3 }'),
    }
    expect(copyOf('us.orders.workers', fixed)?.fields).toEqual([])
    // a default that reads another input of the subsystem brings that one along, where the copy does not set it
    const reads = {
      ...files,
      'region.loadmap': files['region.loadmap']!.replace('input dbLimit = 4_000', 'input dbLimit = pods * 1_000'),
    }
    expect(copyOf('us.db', reads)?.fields).toEqual(['pods: usPods', 'dbLimit: pods * 1_000 (region)'])
    expect(copyOf('eu.db', reads)?.fields).toEqual(['dbLimit: 6000'])
  })

  it('offers to write a default in the copy only when it reads no name of the subsystem', () => {
    const write = (from: string) => {
      const now: Record<string, string> = {
        ...files,
        'region.loadmap': files['region.loadmap']!.replace('input dbLimit = 4_000', from),
      }
      const r = compile(now[MAIN]!, { path: MAIN, files: now })
      return inspectCopy(r, 'us.db', { path: MAIN, read: now, now })!.sections[0]!.fields.map((f) => f.write)
    }
    expect(write('input dbLimit = 4_000 * 1')).toEqual(['4_000 * 1'])
    // in the model, "pods" would be another name, or none
    expect(write('input dbLimit = pods * 1_000')).toEqual([undefined, undefined])
  })

  it("writes a change in the copy's with: the line, a new line, a new block; refused for an input it lacks", () => {
    const o = { path: MAIN, files }
    const line = (src: string) => src.split('\n').find((l) => l.startsWith('subsystem us'))
    const changed = (r: ReturnType<typeof edit>) => {
      if ('error' in r) throw new Error(r.error)
      return line(r.source)
    }
    const us = 'subsystem us "US region" { like: region; in: us; with { main: us; spill: eu; pods: usPods; apiPods:'
    expect(changed(edit(files[MAIN]!, 'subsystem:us/with/apiPods', 9, o))).toBe(`${us} 9 } }`)
    expect(changed(edit(files[MAIN]!, 'subsystem:us/with/dbLimit', 4500, o))).toBe(`${us} 8; dbLimit: 4500 } }`)
    // a default that is a formula is written as it is, to be changed there
    expect(changed(writeInput(files[MAIN]!, 'subsystem:us/with/dbLimit', '4_000', o))).toBe(
      `${us} 8; dbLimit: 4_000 } }`,
    )
    expect(edit(files[MAIN]!, 'subsystem:us/with/nope', 3, o)).toEqual({ error: '"region" has no input "nope"' })
    // a copy without a with gets one
    const bare = files[MAIN]!.replace(
      'subsystem us "US region" { like: region; in: us; with { main: us; spill: eu; pods: usPods; apiPods: 8 } }',
      'subsystem us "US region" {\n  like: region\n  in: us\n  with { main: us; spill: eu; pods: usPods }\n}',
    )
    const added = edit(bare, 'subsystem:us/with/apiPods', 5, { path: MAIN, files: { ...files, [MAIN]: bare } })
    if ('error' in added) throw new Error(added.error)
    expect(added.source).toContain('  with { main: us; spill: eu; pods: usPods; apiPods: 5 }\n}')
    const none = bare.replace('  with { main: us; spill: eu; pods: usPods }\n', '')
    expect(edit(none, 'subsystem:us/with/apiPods', 5)).toMatchObject({
      changes: [{ insert: '\n  with { apiPods: 5 }' }],
    })
    // an empty block over several lines keeps them
    const open = none.replace('  in: us\n}', '  in: us\n  with {\n  }\n}')
    expect(edit(open, 'subsystem:us/with/apiPods', 5)).toMatchObject({ changes: [{ insert: '\n    apiPods: 5' }] })
  })
})

describe('the help across the files of a model', () => {
  const files = set()
  const at = (path: string, text: string, nth = 0) => {
    let i = -1
    for (let k = 0; k <= nth; k++) i = files[path]!.indexOf(text, i + 1)
    expect(i, text).toBeGreaterThanOrEqual(0)
    return i + 1
  }

  it('finds where a name is declared, in whichever file', () => {
    // a path in the head is its file
    expect(definitionAcross(files[MODEL]!, at(MODEL, './platform.loadmap'), { path: MODEL, files })).toMatchObject({
      file: LIB,
    })
    // a name in an import: the library's own declaration
    const inLib = definitionAcross(files[MODEL]!, at(MODEL, 'pipeline }'), { path: MODEL, files })
    expect(inLib).toMatchObject({ file: LIB })
    expect(files[LIB]!.slice(inLib!.from, inLib!.to)).toBe('pipeline')
    // where the model uses it: the import that brings it
    const used = definitionAcross(files[MODEL]!, at(MODEL, 'like: pipeline') + 6, { path: MODEL, files })
    expect(used?.file).toBeUndefined()
    expect(files[MODEL]!.slice(used!.from, used!.to)).toBe('pipeline')
    expect(used!.from).toBeLessThan(files[MODEL]!.indexOf('title:'))
    // from the part: a box of the model, and a box of a subsystem in the library that declares it
    const sub = definitionAcross(files[STORY]!, at(STORY, 'orderLine.consumers') + 12, { path: STORY, files })
    expect(sub).toMatchObject({ file: LIB })
    expect(files[LIB]!.slice(sub!.from, sub!.to)).toBe('consumers')
  })

  it('finds and renames a name over the model and its parts', () => {
    const story = swap(STORY, '{ load: 1 }', '{ load: 1; focus: gateway }')
    const all = set({ [STORY]: story })
    const offset = all[MODEL]!.indexOf('node gateway') + 6
    const refs = referencesAcross(all[MODEL]!, offset, { path: MODEL, files: all })!
    expect(refs.filter((r) => r.file === STORY)).toHaveLength(1)
    expect(refs.filter((r) => r.file == null).length).toBeGreaterThanOrEqual(3)
    const renamed = renameAcross(all[MODEL]!, offset, 'frontDoor', { path: MODEL, files: all })
    if ('error' in renamed) throw new Error(renamed.error)
    const inStory = renamed.changes.filter((c) => c.file === STORY)
    expect(inStory).toHaveLength(1)
    expect(story.slice(inStory[0]!.from, inStory[0]!.to)).toBe('gateway')
    // a flow handed to a subsystem is renamed where it is handed over
    const flow = renameAcross(all[MODEL]!, all[MODEL]!.indexOf('flow orders') + 6, 'purchases', {
      path: MODEL,
      files: all,
    })
    if ('error' in flow) throw new Error(flow.error)
    expect(flow.changes.map((c) => all[MODEL]!.slice(c.from, c.to))).toEqual(['orders', 'orders', 'orders'])
    // an imported name keeps the library's own
    const imported = renameAcross(all[MODEL]!, all[MODEL]!.indexOf('like: postgres') + 7, 'pg', {
      path: MODEL,
      files: all,
    })
    if ('error' in imported) throw new Error(imported.error)
    expect(imported.changes.map((c) => c.insert)).toEqual(['pg: postgres', 'pg'])
  })

  it('offers paths, the names of a library and the inputs of what a box is like', () => {
    const o = { path: MODEL, files, paths: Object.keys(files) }
    const paths = completionsAcross(files[MODEL]!, at(MODEL, './platform.loadmap') + 2, o)
    expect(paths.options.map((x) => x.label).sort()).toEqual([
      './platform.loadmap',
      './shop.big.loadmap',
      './shop.story.loadmap',
    ])
    const names = completionsAcross(files[MODEL]!, at(MODEL, '{ postgres; pipeline }') + 1, o)
    expect(names.options.map((x) => x.label)).toEqual(['messageCost'])
    const less = swap(MODEL, 'with { main: orders; pods: pods }', 'with { main: orders;  }')
    const inputs = completionsAcross(less, less.indexOf('with { main: orders; ') + 'with { main: orders; '.length, {
      ...o,
      files: set({ [MODEL]: less }),
    })
    expect(inputs.options.map((x) => x.label)).toEqual(['pods'])
    // everywhere else: what one file offers, with the names its other files declare
    const story = `${files[STORY]}step "More" { focus:  }\n`
    const focus = completionsAcross(story, story.lastIndexOf('focus: ') + 7, {
      ...o,
      path: STORY,
      files: set({ [STORY]: story }),
    })
    expect(focus.options.map((x) => x.label)).toContain('gateway')
  })

  it('offers what a like or a subsystem brings from a library, by the names it has here', () => {
    /** Completions in `path` with `from` written as `to`, the cursor where "|" is in it. */
    const across = (path: string, from: string, to: string) => {
      const text = swap(path, from, to.replaceAll('|', ''))
      const offset = base[path]!.indexOf(from) + to.indexOf('|')
      const c = completionsAcross(text, offset, { path, files: set({ [path]: text }), paths: Object.keys(base) })
      return c.options
    }
    const labels = (o: { label: string }[]) => o.map((x) => x.label)
    // the subsystem itself, its boxes, and a box like the library's postgres, which runs its store
    const route = labels(across(MODEL, 'route: gateway -> orderLine -> db', 'route: gateway -> |'))
    expect(route).toEqual(expect.arrayContaining(['orderLine', 'orderLine.consumers', 'db']))
    expect(labels(across(MODEL, 'route: gateway -> orderLine -> db', 'route: gateway -> orderLine.|')).sort()).toEqual([
      'consumers',
      'kafka',
      'topic',
    ])
    expect(labels(across(MODEL, '\norderLine -> db\n', '\norderLine -> db\norderLine.|\n')).sort()).toEqual([
      'consumers',
      'kafka',
    ])
    // like: what the file imports of the same kind
    expect(across(MODEL, 'like: pipeline', 'like: |')).toMatchObject([
      { label: 'pipeline', detail: 'subsystem of ./platform.loadmap' },
    ])
    // a node may be like any node of this file too; the imported prototype, with inputs, first
    const like = across(MODEL, 'like: postgres', 'like: |').sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0))
    expect(like[0]).toMatchObject({ label: 'postgres', detail: 'node of ./platform.loadmap' })
    // a flow input takes a flow
    expect(labels(across(MODEL, 'with { main: orders; pods: pods }', 'with { main: |; pods: pods }'))).toEqual([
      'orders',
    ])
    // in the library: a prototype's formulas read its inputs, a subsystem's edges its own boxes
    const demand = across(LIB, 'demand: writes', 'demand: |')
    const first = [...demand].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).slice(0, 2)
    expect(labels(first)).toEqual(['writes', 'limit'])
    const edges = labels(across(LIB, '  kafka -> consumers\n', '  kafka -> consumers\n  |\n'))
    expect(edges).toEqual(expect.arrayContaining(['kafka', 'consumers']))
    expect(edges).not.toContain('pipeline.kafka')
    // a part holds statements: not the model's title, load or view
    const part = labels(across(STORY, 'part of "./shop.loadmap"\n', 'part of "./shop.loadmap"\n|\n'))
    expect(part).toEqual(expect.arrayContaining(['step', 'expect']))
    for (const k of ['title', 'load', 'view', 'include', 'import']) expect(part).not.toContain(k)
  })

  it('imports a name a library declares, and tells who imports a library', () => {
    const o = { path: MODEL, files, paths: Object.keys(files) }
    expect(libraryOf('messageCost', o)).toEqual({ path: LIB, keyword: 'let' })
    expect(libraryOf('nothing', o)).toBeUndefined()
    const change = addImport(files[MODEL]!, 'messageCost', LIB, o)!
    const after = files[MODEL]!.slice(0, change.from) + change.insert + files[MODEL]!.slice(change.to)
    expect(after).toContain('{ postgres; pipeline; messageCost }')
    expect(compile(after, { path: MODEL, files }).diagnostics).toEqual([])
    // a library that is not imported yet: a line of its own in the head
    const fresh = addImport('loadmap 1.5\nload "L" { max: 2 }\n', 'messageCost', LIB, { path: `${DIR}/new.loadmap` })!
    expect(fresh.insert).toBe('\nimport "./platform.loadmap" { messageCost }')
    // a rename in the library: every importer keeps its own name for it
    expect(importersOf(LIB, 'postgres', 'pg', o)).toEqual([
      expect.objectContaining({ file: MODEL, insert: 'postgres: pg' }),
    ])
  })
})
