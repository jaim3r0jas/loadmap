import type { Capacity, ConditionValue, Published, PublishedConfig } from '@loadmap/core'
import type { CompileOptions } from '@loadmap/dsl'
import {
  type AddResult,
  addPublished,
  type CatalogFlow,
  type CatalogPick,
  type CatalogStage,
  type CatalogUse,
  catalogBox,
  catalogDemand,
  catalogFlows,
  catalogStage,
} from '@loadmap/dsl/add'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

/** The picker's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-catalog { width: min(860px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 32px)); padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / .25); }
.lme-catalog::backdrop { background: rgb(0 0 0 / .35); }
.lme-catalog-body { display: grid; grid-template-columns: 220px 1fr; min-height: 0; height: min(680px, calc(100dvh - 72px)); }
.lme-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--lm-line); }
.lme-catalog-head h2 { margin: 0; font-size: 1rem; }
.lme-catalog-list { overflow: auto; padding: 8px; border-right: 1px solid var(--lm-line); }
.lme-catalog-list input { width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 6px 8px; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 6px; }
.lme-catalog-list button { display: block; width: 100%; padding: 6px 8px; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-radius: 6px; cursor: pointer; }
.lme-catalog-list button[aria-pressed="true"] { background: var(--lm-accent-soft); }
.lme-catalog-list small { display: block; color: var(--lm-muted); font-size: .75rem; }
.lme-catalog-form { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 10px; min-width: 0; overflow: auto; padding: 12px 14px; font-size: .9rem; }
.lme-catalog-form label { display: grid; grid-template-columns: 140px minmax(0, 1fr); align-items: center; gap: 8px; }
.lme-catalog-form select, .lme-catalog-form input:not([type="checkbox"]):not([type="radio"]) { min-width: 0; font: inherit; padding: 4px 6px; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; }
.lme-catalog-form input[type="number"] { width: 9ch; justify-self: start; }
.lme-figure { min-width: 0; overflow-wrap: anywhere; padding: 10px 12px; border: 1px solid var(--lm-alt); border-radius: 8px; }
.lme-figure[data-none] { border-style: dashed; border-color: var(--lm-line); }
.lme-figure b { font-size: 1.05rem; }
.lme-figure ul { margin: 6px 0 0; padding-left: 18px; color: var(--lm-muted); font-size: .82rem; }
.lme-catalog-use { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; padding-top: 10px; border-top: 1px solid var(--lm-line); }
.lme-catalog-use h3 { margin: 0; font: 600 .95rem var(--lm-font); text-transform: none; letter-spacing: 0; color: var(--lm-fg); }
.lme-catalog-use h3 small { margin-left: 6px; font-weight: 400; color: var(--lm-muted); }
.lme-catalog-use fieldset { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.lme-catalog-use legend { padding: 0; margin-bottom: 4px; font-weight: 500; }
.lme-catalog-seg { display: inline-flex; justify-self: start; border: 1px solid var(--lm-line); border-radius: 6px; overflow: hidden; }
.lme-catalog-seg label { display: block; padding: 4px 10px; cursor: pointer; }
.lme-catalog-seg label + label { border-left: 1px solid var(--lm-line); }
.lme-catalog-seg input { position: absolute; opacity: 0; pointer-events: none; }
.lme-catalog-seg label:has(input:checked) { color: var(--lm-fg); background: var(--lm-accent-soft); }
.lme-catalog-seg label:has(input:focus-visible) { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-catalog-flow { display: grid; grid-template-columns: minmax(0, 180px) minmax(0, 1fr); align-items: center; gap: 8px; }
.lme-catalog-form .lme-catalog-flow > label { display: flex; grid-template-columns: none; gap: 6px; min-width: 0; }
.lme-catalog-flow > label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lme-catalog-flow select:disabled { opacity: .5; }
.lme-catalog-unit { display: flex; align-items: center; gap: 6px; }
.lme-catalog-demand { margin: 0; padding: 8px 10px; border-left: 3px solid var(--lm-accent); background: color-mix(in srgb, var(--lm-accent) 6%, transparent); border-radius: 0 6px 6px 0; }
.lme-catalog-demand code, .lme-catalog-text pre { font-family: var(--lm-mono); }
.lme-catalog-names { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.lme-catalog-form .lme-catalog-names label { grid-template-columns: auto 1fr; }
.lme-catalog-text summary { cursor: pointer; color: var(--lm-muted); }
.lme-catalog-text pre { margin: 6px 0 0; max-height: 200px; overflow: auto; padding: 8px 10px; font-size: .78rem; line-height: 1.45; background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 6px; }
.lme-catalog-text ins { display: block; text-decoration: none; color: var(--lm-fg); }
.lme-catalog-text ins::before { content: "+ "; color: var(--lm-ok); }
.lme-catalog-text del { display: block; text-decoration: line-through; color: var(--lm-muted); }
.lme-catalog-text del::before { content: "− "; color: var(--lm-drop); }
.lme-catalog-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.lme-catalog-acts [aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
@media (max-width: 600px) { .lme-catalog-body { grid-template-columns: 1fr; grid-template-rows: 180px 1fr; } .lme-catalog-list { border-right: 0; border-bottom: 1px solid var(--lm-line); } .lme-catalog-form label, .lme-catalog-flow, .lme-catalog-names { grid-template-columns: 1fr; } }
`

export interface CatalogPickerProps {
  /** The box selected on the board, with its label: "Use for" sets its capacity. */
  box?: { id: string; label: string }
  /**
   * The catalog and what the picker does with it, from the editor: imported here, they would split the chunks every
   * page shares.
   */
  api: CatalogApi
  /** A pick written into the text: the changes, the box it selects and a line for the reader. */
  onPick: (r: Extract<AddResult, { box: string }>, note: string) => void
  onClose: () => void
}

/**
 * Add → From the catalog: a component, the conditions of one of its published runs, and the figure they give, with
 * its source; then how flows use it (its kind's stage, where it goes on their routes) and the text it adds. It writes
 * text only (a `published` statement, and a new box or a box's capacity), through the dsl. Loaded the first time it
 * opens, with the catalog and the dsl's `add` entry.
 */
export interface CatalogApi {
  components: () => Promise<readonly Published[]>
  figure: (c: Published, config: PublishedConfig) => Capacity
  condition: (c: Published, key: string, v: ConditionValue) => string
  number: (n: number) => string
  /** The text as it is now, and how the editor compiles it: what a pick is added to and checked against. */
  source: () => string
  options: () => CompileOptions
}

const STAGE_WORDS: Record<CatalogStage, string> = {
  queue: 'a queue (a topic): units wait in it, and the stage after it on a route drains it',
  cache: 'a cache: it answers its hit ratio, and the rest carry on',
  store: 'a store: flows end here, written to it',
  pass: 'a pass: flows go on to the next stage',
}

/** Where on a route: before its first stage, between two, after its last. */
function placeText(f: CatalogFlow, at: number): string {
  const r = f.route
  if (!r.length) return 'on its route'
  if (at === 0) return `before ${r[0]!.label}`
  if (at === r.length) return `after ${r[at - 1]!.label}`
  return `between ${r[at - 1]!.label} and ${r[at]!.label}`
}

/**
 * The lines a pick changes, from its changes: each run of touched lines as it was (−) and as it becomes (+), in the
 * order of the text, without the lines a run leaves as they were.
 */
function changedLines(source: string, changes: Extract<AddResult, { box: string }>['changes']) {
  const sorted = [...changes].sort((a, b) => a.from - b.from)
  const lineEnd = (at: number) => {
    const i = source.indexOf('\n', at)
    return i < 0 ? source.length : i
  }
  const out: { line: string; added: boolean }[] = []
  for (let i = 0; i < sorted.length; ) {
    const start = source.lastIndexOf('\n', sorted[i]!.from - 1) + 1
    let end = lineEnd(sorted[i]!.to)
    let j = i + 1
    // changes on the same lines read as one
    for (; j < sorted.length && sorted[j]!.from <= end; j++) end = Math.max(end, lineEnd(sorted[j]!.to))
    let text = source.slice(start, end)
    for (const ch of sorted.slice(i, j).reverse())
      text = text.slice(0, ch.from - start) + ch.insert + text.slice(ch.to - start)
    const was = source.slice(start, end).split('\n')
    const now = text.split('\n')
    while (was.length && now.length && was[0] === now[0]) {
      was.shift()
      now.shift()
    }
    while (was.length && now.length && was.at(-1) === now.at(-1)) {
      was.pop()
      now.pop()
    }
    for (const l of was) if (l.trim()) out.push({ line: l, added: false })
    for (const l of now) if (l.trim()) out.push({ line: l, added: true })
    i = j
  }
  return out
}

export default function CatalogPicker({ box, api, onPick, onClose }: CatalogPickerProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [components, setComponents] = useState<readonly Published[] | null>(null)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Published | null>(null)
  const [conditions, setConditions] = useState<Record<string, ConditionValue>>({})
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  // how flows use a new box: undefined is the dsl's choice (a store where every route ends at it)
  const [stage, setStage] = useState<CatalogStage | undefined>()
  // number fields keep what is typed (an empty field while a new number goes in); the pick reads them parsed
  const [hit, setHit] = useState('80')
  const [partitions, setPartitions] = useState('1')
  const [placed, setPlaced] = useState<Readonly<Record<string, number>>>({})
  const [rule, setRule] = useState('')
  const [worth, setWorth] = useState('1')
  const [boxId, setBoxId] = useState('')
  const [label, setLabel] = useState('')
  useEffect(() => dialog.current?.showModal(), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    void api.components().then(setComponents, () => setError('The catalog did not load: try again.'))
  }, [])
  // the text as the dialog opens: what the preview reads (adding reads it again)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  const source = useMemo(() => api.source(), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  const options = useMemo(() => api.options(), [])
  const flows = useMemo(() => catalogFlows(source), [source])
  // a component starts from its first published run, on no route
  const choose = (c: Published) => {
    setChosen(c)
    setError(null)
    const first = c.figures.find((f) => f.measure === 'capacity' || f.measure === 'limit')
    // every condition set: the first run's, else the first value any run used
    const start: Record<string, ConditionValue> = {}
    for (const k of Object.keys(c.conditions)) {
      const v = first?.when[k] ?? c.figures.find((f) => f.when[k] != null)?.when[k]
      if (v != null) start[k] = v
    }
    setConditions(start)
    setVersion(c.versionMatters ? (first?.versions[0] ?? '') : '')
    setStage(undefined)
    setPlaced({})
    setRule('')
    setHit('80')
    setPartitions('1')
    setWorth('1')
    setBoxId('')
    setLabel('')
  }
  const shown = (components ?? []).filter((c) =>
    `${c.name} ${c.id} ${c.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const values = (key: string) => [
    ...new Set(chosen?.figures.flatMap((f) => (f.when[key] == null ? [] : [f.when[key]!])) ?? []),
  ]
  // the editor makes a new api each render; the figure depends on the pick only
  // biome-ignore lint/correctness/useExhaustiveDependencies: api.figure is the same function every time
  const figure = useMemo(
    () => chosen && api.figure(chosen, { ...conditions, ...(version ? { version } : {}) }),
    [chosen, conditions, version],
  )

  const kind = chosen ? catalogBox(chosen) : undefined
  const routes = Object.entries(placed).map(([flow, at]) => ({ flow, at }))
  const route = (f: string) => flows.find((x) => x.id === f)
  // the stage the box will run: the one picked, else the dsl's
  const effective: CatalogStage | undefined =
    stage ??
    (chosen
      ? catalogStage(
          chosen,
          routes.map((r) => r.at === route(r.flow)?.route.length),
        )
      : undefined)
  // where a flow goes on: in front of the pool that drains a queue, last for a store, in front of the last stage else
  const defaultAt = (f: CatalogFlow) => {
    const n = f.route.length
    if (effective === 'store') return n
    if (effective === 'queue') {
      const pool = f.route.findIndex((r) => r.pool)
      return pool >= 0 ? pool : n
    }
    if (chosen?.kind === 'proxy' || chosen?.kind === 'dns') return 0
    return Math.max(0, n - 1)
  }
  // a consumer's rule (each part to one member, or shared), not how producers write
  const rules = (chosen?.connections ?? []).filter((r) => r.assign === 'exclusive' || r.assign === 'shared')
  const drained = routes.some((r) => route(r.flow)?.route[r.at]?.pool)
  const demand = chosen && catalogDemand(effective, figure?.unit ?? '', conditions)
  const partitionsN = Math.max(1, Math.round(Number(partitions)) || 1)
  const hitN = Math.min(100, Math.max(0, Math.round(Number(hit)) || 0))
  const worthN = Math.max(0, Number(worth) || 0)
  const use: CatalogUse = {
    ...(boxId.trim() && { id: boxId.trim() }),
    ...(label.trim() && { label: label.trim() }),
    ...(stage && { stage }),
    ...(effective === 'cache' && { hit: hitN / 100 }),
    ...(effective === 'queue' && { partitions: partitionsN }),
    ...(routes.length && { routes }),
    // a rule chosen while a pool drained it, kept only while one does
    ...(effective === 'queue' && drained && rule && { rule }),
    ...(demand?.how === 'worth' && { worth: worthN }),
  }
  const pickOf = (into: CatalogPick['into']): CatalogPick | undefined =>
    chosen
      ? {
          component: chosen,
          conditions,
          ...(version ? { version } : {}),
          into,
          ...(into === 'new' && { use }),
        }
      : undefined
  // worked out from the text as it is now, refused when the definition would gain an error: shown before it is added
  const key = JSON.stringify([chosen?.id, conditions, version, use])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pick, keyed by its JSON
  const preview = useMemo(() => {
    const p = pickOf('new')
    return p && addPublished(source, p, options)
  }, [key])
  const lines = useMemo(
    () => (preview && !('error' in preview) ? changedLines(source, preview.changes) : []),
    [preview, source],
  )

  const pick = (into: CatalogPick['into']) => {
    const p = pickOf(into)
    if (!p) return
    // the changes land on the text as it is now: worked out again if it changed since the dialog opened
    const now = api.source()
    const r = into === 'new' && preview && now === source ? preview : addPublished(now, p, api.options())
    if ('error' in r) return setError(r.error)
    onPick(r, into === 'new' ? `Added ${chosen!.name}` : `${chosen!.name}'s published figure is in use`)
    dialog.current?.close()
  }
  const demandText = () => {
    if (!demand) return null
    const unit = demand.unit || 'its capacity’s unit'
    switch (demand.how) {
      case 'size':
        return demand.size ? (
          <>
            what reaches it × <code>{demand.size}</code>, the message size of the published run, in {unit}
          </>
        ) : (
          <>none yet: no condition says the size of a unit; write one in {unit}</>
        )
      case 'rate':
        return <>what reaches it, in {unit}</>
      case 'worth':
        return (
          <>
            what reaches it × {worthN}, in {unit}
          </>
        )
      default:
        return <>none: no flow passes it, so write what it handles, in {unit}</>
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <dialog ref={dialog} className="lme-catalog" aria-labelledby={`${id}h`} onClose={onClose}>
        <div className="lme-catalog-head">
          <h2 id={`${id}h`}>Add from the catalog</h2>
          <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <div className="lme-catalog-body">
          <div className="lme-catalog-list">
            <input
              type="search"
              placeholder="Search components"
              aria-label="Search components"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!components && !error && <p className="lme-hint">Loading…</p>}
            {shown.map((c) => (
              <button key={c.id} type="button" aria-pressed={chosen?.id === c.id} onClick={() => choose(c)}>
                {c.name}
                <small>{c.figures.length ? c.about : 'Nothing published with its conditions'}</small>
              </button>
            ))}
          </div>
          <div className="lme-catalog-form">
            {!chosen || !kind ? (
              <p className="lme-hint">
                Each component carries the figures published for it, under the conditions they were run with. Pick one.
              </p>
            ) : (
              <>
                {Object.entries(chosen.conditions).map(([k, c]) => (
                  <label key={k}>
                    {c.label.charAt(0).toUpperCase() + c.label.slice(1)}
                    <select
                      value={String(conditions[k] ?? '')}
                      onChange={(e) => {
                        const v = values(k).find((x) => String(x) === e.target.value)
                        setConditions((s) => ({ ...s, [k]: v! }))
                      }}
                    >
                      {values(k).map((v) => (
                        <option key={String(v)} value={String(v)}>
                          {api.condition(chosen, k, v)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {chosen.versionMatters && (
                  <label>
                    Version
                    <select value={version} onChange={(e) => setVersion(e.target.value)}>
                      {[...new Set(chosen.figures.flatMap((f) => f.versions))].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                )}
                {figure?.ref ? (
                  <div className="lme-figure">
                    <b>
                      {api.number(figure.value)} {figure.unit}
                    </b>{' '}
                    {figure.ref.measure === 'limit' ? 'published limit' : 'published, a best case'}: {figure.ref.what},{' '}
                    {figure.ref.scope}.
                    <ul>
                      {figure.ref.conditions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                      <li>
                        {chosen.name} {figure.ref.versions.join(', ')}, run by {figure.ref.source.by}
                        {figure.ref.source.date ? `, ${figure.ref.source.date}` : ''}:{' '}
                        <a href={figure.ref.source.url} target="_blank" rel="noopener noreferrer">
                          {figure.ref.source.title}
                        </a>
                        . Catalog {chosen.edition}.
                      </li>
                    </ul>
                  </div>
                ) : (
                  <div className="lme-figure" data-none>
                    No published benchmark {figure?.missing}. The box will say so, and give no number.
                  </div>
                )}

                <section className="lme-catalog-use" aria-labelledby={`${id}u`}>
                  <h3 id={`${id}u`}>
                    How flows use it<small>as a new box</small>
                  </h3>
                  <p className="lme-hint">
                    {effective
                      ? `A ${kind.box} that runs ${STAGE_WORDS[effective]}.`
                      : `A ${kind.box} that runs no stage: ${chosen.name} is a limit on its own, no flow passes it.`}
                  </p>
                  {kind.stages.length > 1 && (
                    <div className="lme-catalog-seg" role="radiogroup" aria-label="Stage">
                      {kind.stages.map((s) => (
                        <label key={s}>
                          <input
                            type="radio"
                            name={`${id}stage`}
                            checked={effective === s}
                            onChange={() => setStage(s)}
                          />
                          {s === 'store' ? 'Flows end here' : 'Flows go on'}
                        </label>
                      ))}
                    </div>
                  )}
                  {effective === 'queue' && (
                    <label>
                      Partitions per flow
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={partitions}
                        onChange={(e) => setPartitions(e.target.value)}
                      />
                    </label>
                  )}
                  {effective === 'cache' && (
                    <label>
                      Hit ratio, %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={hit}
                        onChange={(e) => setHit(e.target.value)}
                      />
                    </label>
                  )}
                  {effective && flows.length > 0 && (
                    <fieldset>
                      <legend>Flows through it</legend>
                      {flows.map((f) => {
                        const on = placed[f.id] != null
                        return (
                          <div key={f.id} className="lme-catalog-flow">
                            <label>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  setPlaced((s) => {
                                    const { [f.id]: _, ...rest } = s
                                    return on ? rest : { ...rest, [f.id]: defaultAt(f) }
                                  })
                                }
                              />
                              <span title={f.label}>{f.label}</span>
                            </label>
                            <select
                              aria-label={`Where on the route of ${f.label}`}
                              disabled={!on}
                              value={placed[f.id] ?? defaultAt(f)}
                              onChange={(e) => setPlaced((s) => ({ ...s, [f.id]: Number(e.target.value) }))}
                            >
                              {Array.from({ length: f.route.length + 1 }, (_, i) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: a place on the route is its index
                                <option key={i} value={i}>
                                  {placeText(f, i)}
                                </option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </fieldset>
                  )}
                  {effective === 'queue' && rules.length > 0 && (
                    <>
                      <label>
                        Read by the next pool
                        <select value={drained ? rule : ''} onChange={(e) => setRule(e.target.value)}>
                          <option value="">{drained ? 'as it is (no rule)' : 'needs a pool right after it'}</option>
                          {drained &&
                            rules.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.id}
                              </option>
                            ))}
                        </select>
                      </label>
                      {drained && rule && <p className="lme-hint">{rules.find((r) => r.id === rule)?.what}</p>}
                    </>
                  )}
                  {demand?.how === 'worth' && (
                    <label>
                      Each unit a second is
                      <span className="lme-catalog-unit">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={worth}
                          aria-label={`What one unit a second is, in ${demand.unit}`}
                          onChange={(e) => setWorth(e.target.value)}
                        />{' '}
                        {demand.unit}
                      </span>
                    </label>
                  )}
                  <p className="lme-catalog-demand">
                    <b>Demand:</b> {demandText()}.
                  </p>
                  <div className="lme-catalog-names">
                    <label>
                      Id
                      <input
                        value={boxId}
                        placeholder={preview && !('error' in preview) && !boxId ? preview.box : chosen.id}
                        spellCheck={false}
                        onChange={(e) => setBoxId(e.target.value)}
                      />
                    </label>
                    <label>
                      Label
                      <input value={label} placeholder={chosen.name} onChange={(e) => setLabel(e.target.value)} />
                    </label>
                  </div>
                  {lines.length > 0 && (
                    <details className="lme-catalog-text" open aria-label="The text it writes">
                      <summary>The text it writes</summary>
                      <pre>
                        {lines.map((l, i) =>
                          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one text, in order
                          l.added ? <ins key={i}>{l.line}</ins> : <del key={i}>{l.line}</del>,
                        )}
                      </pre>
                    </details>
                  )}
                </section>
                <div className="lme-catalog-acts">
                  {box && (
                    <button type="button" className="lm-btn" onClick={() => pick({ box: box.id })}>
                      Use for {box.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="lm-btn"
                    aria-disabled={!!preview && 'error' in preview}
                    onClick={() => (preview && 'error' in preview ? undefined : pick('new'))}
                  >
                    Add as a new box
                  </button>
                </div>
                {preview && 'error' in preview && (
                  <p className="lme-error" role="alert">
                    Not added: {preview.error}.
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="lme-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
