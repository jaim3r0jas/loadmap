import type { Capacity, ConditionValue, Published, PublishedConfig } from '@loadmap/core'
import type { AddResult, CatalogPick } from '@loadmap/dsl/internal'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

/** The picker's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-catalog { width: min(760px, calc(100vw - 32px)); max-height: min(640px, calc(100dvh - 32px)); padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / .25); }
.lme-catalog::backdrop { background: rgb(0 0 0 / .35); }
.lme-catalog-body { display: grid; grid-template-columns: 220px 1fr; min-height: 0; height: min(600px, calc(100dvh - 72px)); }
.lme-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--lm-line); }
.lme-catalog-head h2 { margin: 0; font-size: 1rem; }
.lme-catalog-list { overflow: auto; padding: 8px; border-right: 1px solid var(--lm-line); }
.lme-catalog-list input { width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 6px 8px; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 6px; }
.lme-catalog-list button { display: block; width: 100%; padding: 6px 8px; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-radius: 6px; cursor: pointer; }
.lme-catalog-list button[aria-pressed="true"] { background: var(--lm-accent-soft); }
.lme-catalog-list small { display: block; color: var(--lm-muted); font-size: .75rem; }
.lme-catalog-form { display: grid; align-content: start; gap: 10px; overflow: auto; padding: 12px 14px; font-size: .9rem; }
.lme-catalog-form label { display: grid; grid-template-columns: 140px 1fr; align-items: center; gap: 8px; }
.lme-catalog-form select { font: inherit; padding: 4px 6px; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; }
.lme-figure { padding: 10px 12px; border: 1px solid var(--lm-alt); border-radius: 8px; }
.lme-figure[data-none] { border-style: dashed; border-color: var(--lm-line); }
.lme-figure b { font-size: 1.05rem; }
.lme-figure ul { margin: 6px 0 0; padding-left: 18px; color: var(--lm-muted); font-size: .82rem; }
.lme-catalog-acts { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 600px) { .lme-catalog-body { grid-template-columns: 1fr; grid-template-rows: 180px 1fr; } .lme-catalog-list { border-right: 0; border-bottom: 1px solid var(--lm-line); } }
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
 * its source. It writes text only (a `published` statement, and a new box or a box's capacity), through the dsl.
 * Loaded the first time it opens, with the catalog.
 */
export interface CatalogApi {
  components: () => Promise<readonly Published[]>
  figure: (c: Published, config: PublishedConfig) => Capacity
  condition: (c: Published, key: string, v: ConditionValue) => string
  number: (n: number) => string
  add: (pick: CatalogPick) => AddResult
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
  useEffect(() => dialog.current?.showModal(), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    void api.components().then(setComponents, () => setError('The catalog did not load: try again.'))
  }, [])
  // a component starts from its first published run
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
  const pick = (into: CatalogPick['into']) => {
    if (!chosen) return
    // worked out from the text as it is now, refused when the definition would gain an error
    const r = api.add({ component: chosen, conditions, ...(version ? { version } : {}), into })
    if ('error' in r) return setError(r.error)
    onPick(r, into === 'new' ? `Added ${chosen.name}` : `${chosen.name}'s published figure is in use`)
    dialog.current?.close()
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
            {!chosen ? (
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
                <div className="lme-catalog-acts">
                  {box && (
                    <button type="button" className="lm-btn" onClick={() => pick({ box: box.id })}>
                      Use for {box.label}
                    </button>
                  )}
                  <button type="button" className="lm-btn" onClick={() => pick('new')}>
                    Add as a new box
                  </button>
                </div>
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
