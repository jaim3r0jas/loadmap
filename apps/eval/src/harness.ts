import { readdirSync, readFileSync } from 'node:fs'
import { compile, gather, imports } from '@loadmap/dsl'
import {
  type AssistEvent,
  type ChatMessage,
  createAssistant,
  type ExploreCall,
  explored,
  type ModelProvider,
  type Proposal,
} from '@loadmap/dsl/assist'
import { LOOKS } from '@loadmap/dsl/internal'
import type { Project } from '@loadmap/dsl/ops'
import { prometheusExplorer, runExplore } from '@loadmap/providers'

/**
 * The eval: requests a reader makes, each against one of the examples, with what a good answer must do. Run against a
 * model, it says which cases pass, how many repairs they took, and what they cost: the table that picks the default
 * model, the reference and the form of the answer. It runs by hand (a workflow with keys in the repository's secrets),
 * never in `check`: a model's answer is not the same twice.
 */

export type Assert =
  /** The answer is a change that compiles (the gate passed it). */
  | { kind: 'change' }
  /** No change: a question back, or an explanation. */
  | { kind: 'question' }
  | { kind: 'explanation'; mentions?: string[] }
  /** The text of a file, after the change, holds or lacks these words. */
  | { kind: 'contains'; text: string; file?: string }
  | { kind: 'lacks'; text: string; file?: string }
  /** A box, a flow, a scenario or another statement by its id is there, or gone. */
  | { kind: 'declares'; keyword?: string; id: string; file?: string }
  | { kind: 'removes'; id: string }
  /** Every new capacity the reader did not give is an estimate the change says is a guess. */
  | { kind: 'honest' }
  /** The files are the ones named, changed or added. */
  | { kind: 'files'; changed: string[] }
  /** The first limit, after the change. */
  | { kind: 'firstLimit'; id: string }
  /** The model looked in the store before it answered. */
  | { kind: 'explored' }
  /** Every metric a query the change writes names is one the store has. */
  | { kind: 'storeMetrics' }

export interface Case {
  id: string
  /** The model's files: an example's folder and the file the diagram is drawn from. */
  example: string
  request: string
  box?: string
  /**
   * A recorded Prometheus the model may look in: each metric it has. The model's looks run against it, read only, as
   * the editor's would against the reader's.
   */
  store?: Recorded
  asserts: Assert[]
}

export interface CaseResult {
  id: string
  pass: boolean
  /** The asserts that failed, in words. */
  failed: string[]
  repairs: number
  input: number
  output: number
  cached: number
  ms: number
  error?: string
}

const ROOT = new URL('../../../', import.meta.url)

/** An example's model and every file it reaches, as the editor would have them. */
export function exampleProject(example: string): Project {
  const [dir, file] = [example.slice(0, example.lastIndexOf('/')), example.slice(example.lastIndexOf('/') + 1)]
  const at = (p: string) => {
    try {
      return readFileSync(new URL(`${dir}/${p}`, ROOT), 'utf8')
    } catch {
      return undefined
    }
  }
  const source = at(file)
  if (source == null) throw new Error(`no ${example}`)
  const g = gather(source, { path: file, files: at })
  // a variant names its model, the model never names it: the folder's variants of this model come too
  const files: Record<string, string> = { ...g.files }
  for (const f of readdirSync(new URL(`${dir}/`, ROOT))) {
    const text = f.endsWith('.loadmap') && !Object.hasOwn(files, f) ? at(f) : undefined
    if (text && imports(text, f).files.some((x) => x.kind === 'extends' && x.path === g.path)) files[f] = text
  }
  return { entry: g.path, files }
}

/** "8_000" and "8000" are one number: the separators a model may or may not write are not what a case checks. */
const plain = (t: string) => t.replace(/(\d)_(?=\d)/g, '$1')
const count = (t: string, part: string) => plain(t).split(plain(part)).length - 1

/** Whether a line of the text declares `id`: a keyword (this one, or any), then the id, bare or in quotes. */
const declares = (text: string, id: string, keyword?: string) =>
  text.split('\n').some((line) => {
    const words = line.trim().split(' ').filter(Boolean)
    const name = words[1]?.replace(/[{:].*$/, '')
    return (!keyword || words[0] === keyword) && (name === id || name === `"${id}"`)
  })

/** Each assert that the outcome fails, said in a few words. */
export function judge(
  c: Case,
  outcome: {
    proposal?: Proposal
    questions: boolean
    text: string
    refused?: string
    invented?: number
    looks?: number
    /** It still asked to look when the rounds ran out. */
    stalled?: boolean
  },
): string[] {
  const failed: string[] = []
  const p = outcome.proposal
  const after = (file?: string) => (p ? (p.project.files[file ?? p.project.entry] ?? '') : '')
  for (const a of c.asserts) {
    switch (a.kind) {
      case 'change':
        if (!p)
          failed.push(
            outcome.stalled
              ? `kept looking: no answer after ${LOOKS} rounds of looks`
              : outcome.refused
                ? `no change: ${outcome.refused}`
                : 'no change',
          )
        break
      case 'question':
        if (!outcome.questions) failed.push('no question back')
        if (p) failed.push('changed the files instead of asking')
        break
      case 'explanation':
        if (p) failed.push('changed the files instead of explaining')
        for (const m of a.mentions ?? [])
          if (!outcome.text.toLowerCase().includes(m.toLowerCase())) failed.push(`does not mention ${m}`)
        break
      case 'contains': {
        // written by the change: there after it, more often than before it
        const was = p ? (p.before.files[a.file ?? p.before.entry] ?? '') : ''
        if (count(after(a.file), a.text) <= count(was, a.text)) failed.push(`lacks ${a.text}`)
        break
      }
      case 'lacks':
        if (p && count(after(a.file), a.text) > 0) failed.push(`still has ${a.text}`)
        break
      case 'declares':
        if (
          !p ||
          !Object.entries(p.project.files).some(([f, t]) => (!a.file || f === a.file) && declares(t, a.id, a.keyword))
        )
          failed.push(`declares no ${a.keyword ?? ''} ${a.id}`.replace('  ', ' '))
        break
      case 'removes':
        if (!p || Object.values(p.project.files).some((t) => declares(t, a.id)))
          failed.push(`${a.id} is still declared`)
        break
      case 'honest':
        // the gate refuses a figure nobody gave before a proposal exists: the refusals are what this counts
        if (outcome.invented)
          failed.push(`wrote a figure nobody gave ${outcome.invented} time${outcome.invented > 1 ? 's' : ''}`)
        break
      case 'files': {
        const got = p ? [...p.changed, ...p.added].sort() : []
        if (JSON.stringify(got) !== JSON.stringify([...a.changed].sort()))
          failed.push(`changed ${got.join(', ') || 'nothing'}`)
        break
      }
      case 'explored':
        if (!outcome.looks) failed.push('did not look in the store')
        break
      case 'storeMetrics': {
        // every metric a query the change writes names is one the store has: never a guess at a name
        const store = c.store ?? {}
        // the names the files' queries wrote before: those were there already, the change did not guess them
        const before = new Set(p ? Object.values(p.before.files).flatMap(queriesIn).flatMap(metricsIn) : [])
        const after = new Set(p ? Object.values(p.project.files).flatMap(queriesIn).flatMap(metricsIn) : [])
        for (const name of after)
          if (!Object.hasOwn(store, name) && !before.has(name)) failed.push(`names ${name}, which the store lacks`)
        break
      }
      case 'firstLimit': {
        const m =
          p &&
          compile(p.project.files[p.project.entry]!, { path: p.project.entry, files: p.project.files }).definition
            ?.model
        const id = m?.evaluate().firstLimit?.id
        if (id !== a.id) failed.push(`first limit ${id ?? 'none'}`)
        break
      }
    }
  }
  return failed
}

/** The instant a recorded store's windows end at: every run reads the same. */
const NOW = new Date('2026-11-21T12:00:00Z')

/** A metrics store, recorded: each metric it has, with its type, its help, its series' labels and a typical value. */
export type Recorded = Record<string, { type?: string; help?: string; series: Record<string, string>[]; value: number }>

/** PromQL's own words: a name a query writes that is none of these, and holds a "_", is a metric's name. */
const PROMQL = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'offset', 'bool'])

/** The PromQL queries a definition's metrics hold, quoted either way (format() picks the quote). */
export function queriesIn(text: string): string[] {
  return [...text.matchAll(/query:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) => m[1] ?? m[2] ?? '')
}

/** The metric names a PromQL query writes: names with a "_" that are not a function called or a word of PromQL. */
export function metricsIn(query: string): string[] {
  // what is quoted is a label's value, never a name
  const bare = query.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
  const out = new Set<string>()
  for (const m of bare.matchAll(/[A-Za-z_:][\w:]*/g)) {
    const name = m[0]
    const after = bare.slice((m.index ?? 0) + name.length).trimStart()
    if (
      !name.includes('_') ||
      PROMQL.has(name) ||
      after.startsWith('(') ||
      after.startsWith('=') ||
      after.startsWith('!')
    )
      continue
    out.add(name)
  }
  return [...out]
}

/**
 * A Prometheus answering from a recording, read only, as a real one would: the names it has, a metric's series by the
 * name a look gives, and a range only for a query that names a metric it has (inside the window asked for). A name it
 * lacks finds nothing, as on a real store.
 */
export function recordedStore(store: Recorded) {
  const json = (data: unknown) => new Response(JSON.stringify({ status: 'success', data }), { status: 200 })
  return prometheusExplorer({
    url: 'http://recorded.invalid',
    fetch: async (input) => {
      const url = new URL(String(input))
      const q = url.searchParams
      switch (url.pathname) {
        case '/api/v1/label/__name__/values':
          return json(Object.keys(store))
        case '/api/v1/metadata':
          return json(
            Object.fromEntries(
              Object.entries(store).map(([n, m]) => [n, [{ type: m.type ?? '', help: m.help ?? '' }]]),
            ),
          )
        case '/api/v1/series': {
          const name = q.get('match[]') ?? ''
          return json(Object.hasOwn(store, name) ? store[name]!.series.map((l) => ({ __name__: name, ...l })) : [])
        }
        case '/api/v1/query_range': {
          const known = metricsIn(q.get('query') ?? '').filter((n) => Object.hasOwn(store, n))
          if (!known.length) return json({ resultType: 'matrix', result: [] })
          const from = Date.parse(q.get('start') ?? '') / 1000
          const to = Date.parse(q.get('end') ?? '') / 1000
          const step = Number(q.get('step')) || 60
          const v = store[known[0]!]!.value
          const values: [number, string][] = []
          for (let t = from; t <= to && values.length < 500; t += step) values.push([t, String(v)])
          return json({ resultType: 'matrix', result: [{ values }] })
        }
      }
      return new Response(JSON.stringify({ status: 'error', error: 'not recorded' }), { status: 400 })
    },
  })
}

/** One case against a model. */
export async function runCase(
  c: Case,
  o: { model: ModelProvider; reference: string; form?: 'operations' | 'files'; clock?: () => number },
): Promise<CaseResult> {
  const clock = o.clock ?? (() => performance.now())
  const start = clock()
  // every request's tokens, counted as they come: a case that fails after two paid rounds still says what it cost
  const usage = { input: 0, output: 0, cached: 0 }
  const counted: ModelProvider = {
    kind: o.model.kind,
    model: o.model.model,
    async *chat(r) {
      for await (const e of o.model.chat(r)) {
        if (e.type === 'usage') {
          usage.input += e.usage.input
          usage.output += e.usage.output
          usage.cached += e.usage.cached ?? 0
        }
        yield e
      }
    },
  }
  const assistant = createAssistant({ model: counted, reference: o.reference })
  const project = exampleProject(c.example)
  let proposal: Proposal | undefined
  let questions = false
  let text = ''
  let refused: string | undefined
  let repairs = 0
  let invented = 0
  const invents = (error: string) => error.includes('uses a number the reader did not give')
  const store = c.store && recordedStore(c.store)
  let looks = 0
  let stalled = false
  try {
    let thread: ChatMessage[] = []
    let request = c.request
    // the looks it asks for run against the recorded store, as many rounds as the editor allows
    for (let round = 0; ; round++) {
      let calls: ExploreCall[] = []
      // what counts is the last answer: words that only said "I will look" are not the explanation
      text = ''
      questions = false
      for await (const e of assistant.ask({
        request,
        project,
        thread,
        ...(c.box && { selection: { box: c.box } }),
        ...(o.form && { form: o.form }),
        ...(store && { explore: [store.id] }),
      }) as AsyncGenerator<AssistEvent>) {
        if (e.type === 'proposal') proposal = e.proposal
        else if (e.type === 'questions') questions = true
        else if (e.type === 'answer') text += e.text
        else if (e.type === 'explore') calls = e.calls
        else if (e.type === 'done') thread = e.thread
        else if (e.type === 'repair') {
          repairs++
          if (invents(e.error)) invented++
        } else if (e.type === 'refused') {
          refused = e.error
          if (invents(e.error)) invented++
        }
      }
      if (!calls.length || !store) break
      if (round === LOOKS) {
        stalled = true
        break
      }
      looks++
      request = explored(await runExplore(store, calls, { now: NOW }))
    }
  } catch (err) {
    return {
      id: c.id,
      pass: false,
      failed: ['the model failed'],
      repairs,
      ...usage,
      ms: clock() - start,
      error: (err as Error).message,
    }
  }
  const failed = judge(c, {
    ...(proposal && { proposal }),
    questions,
    text,
    ...(refused && { refused }),
    invented,
    looks,
    stalled,
  })
  return { id: c.id, pass: !failed.length, failed, repairs, ...usage, ms: clock() - start }
}

/** The results as a Markdown table, a model per run: the passes first, then each case. */
export function table(runs: { model: string; form: string; results: CaseResult[] }[]): string {
  const lines = [
    '| Model | Form | Passed | Repairs | Tokens in | Cached | Tokens out | Seconds |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const r of runs) {
    const sum = (k: 'repairs' | 'input' | 'output' | 'cached' | 'ms') => r.results.reduce((n, x) => n + x[k], 0)
    const passed = r.results.filter((x) => x.pass).length
    lines.push(
      `| ${r.model} | ${r.form} | ${passed} of ${r.results.length} | ${sum('repairs')} | ${sum('input')} | ${sum('cached')} | ${sum('output')} | ${(sum('ms') / 1000).toFixed(0)} |`,
    )
  }
  lines.push(
    '',
    '| Case | ' + runs.map((r) => `${r.model} (${r.form})`).join(' | ') + ' |',
    `| --- |${runs.map(() => ' --- |').join('')}`,
  )
  const ids = runs[0]?.results.map((x) => x.id) ?? []
  for (const id of ids)
    lines.push(
      `| ${id} | ${runs
        .map((r) => {
          const x = r.results.find((y) => y.id === id)
          return !x
            ? ''
            : x.pass
              ? `pass${x.repairs ? ` (${x.repairs} repair${x.repairs > 1 ? 's' : ''})` : ''}`
              : `fail: ${(x.error ?? x.failed.join('; ')).replaceAll('|', '/').slice(0, 80)}`
        })
        .join(' | ')} |`,
    )
  return lines.join('\n')
}
