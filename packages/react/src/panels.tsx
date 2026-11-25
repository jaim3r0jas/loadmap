import { type Assumption, type Capacity, type QuotaWindow, type Stock, sourceText } from '@loadmap/core'
import { backlog } from '@loadmap/core/backlog'
import { compact, duration, fmt, multiple, multiples, pct, period, secs } from '@loadmap/core/format'
import { type NMinusOne, outages } from '@loadmap/core/outages'
import { curveText } from '@loadmap/core/scaling'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { isOn, LoadRange, plusMinus } from './bar'
import type { LoadmapController } from './useLoadmap'

export { hasDesign, LoadBar, LoadRange, plusMinus } from './bar'

const n1 = new WeakMap<object, Map<string, readonly NMinusOne[]>>()
/**
 * N−1 for what the page shows, once for the verdict and the limits: each is a whole evaluation, and its crossings do
 * not move with the load, so a drag of the slider reuses them.
 */
function nMinusOne(lm: LoadmapController): readonly NMinusOne[] {
  const { load: _, ...rest } = lm.ev.values as Record<string, unknown>
  const key = JSON.stringify(rest)
  let byValues = n1.get(lm.model)
  if (!byValues) {
    byValues = new Map()
    n1.set(lm.model, byValues)
  }
  const known = byValues.get(key)
  if (known) return known
  const o = outages(lm.model, lm.ev.values)
  if (byValues.size > 16) byValues.delete(byValues.keys().next().value!)
  byValues.set(key, o)
  return o
}

/** The model's one-sentence answer for the current values, and which capacity to measure when it is unsure. */
export function Verdict({ lm }: { lm: LoadmapController }) {
  const { measure } = lm.ev
  const peak = usePeak(lm)
  const way = useMoment(lm)
  return (
    <>
      <p className="lm-verdict" data-tier={lm.ev.verdict.tier} aria-live="polite">
        {lm.ev.verdict.text}
      </p>
      {way && <p className="lm-moment">{way}</p>}
      {peak && <p className="lm-peak">{peak}</p>}
      {nMinusOne(lm).map((o) => (
        <p className="lm-outage" key={o.part ?? o.domain} data-domain={o.domain} data-part={o.part}>
          {o.text}
        </p>
      ))}
      {measure && (
        <p className="lm-measure" data-component={measure.component}>
          {measure.text}
        </p>
      )}
    </>
  )
}

/** The tag beside a component's name when its capacity is not plainly measured: estimated, published, a range, none. */
export function CapTag({ c, short }: { c: Capacity | null | undefined; short?: boolean }) {
  const pm = plusMinus(c ?? null)
  const kind =
    c?.missing != null ? 'none' : c?.ref ? 'published' : c?.provenance === 'estimated' ? 'estimated' : 'range'
  const word = {
    none: short ? 'none' : 'no published benchmark',
    published: short ? 'pub' : 'published',
    estimated: short ? 'est' : 'estimate',
    range: '',
  }[kind]
  if (kind === 'range' && !pm) return null
  return (
    <span className="lm-tag" data-kind={kind}>
      {short && kind === 'range' ? '±' : [word, short ? '' : pm].filter(Boolean).join(' ')}
    </span>
  )
}

/**
 * While the values are a preset's with a way up (a ramp, cold caches, or a pool whose pods take time to be ready): what
 * is lost on it. "8× in 30 s: up to 75 % of requests is lost for 100 s, until the eighth pod of the API is ready." The walk is a
 * module of its own, loaded only then: no page loads it first.
 */
function useMoment(lm: LoadmapController): string | null {
  const { ev, model } = lm
  const preset = useMemo(() => {
    const p = shownMoment(ev)
    if (!p) return undefined
    // a way up worth walking: a ramp, cold caches or pods that take time to start. A bucket and a queue with a size
    // are spent and filled on it, but alone they are no way up: the backlog's line says what a queue holds
    const named = (o: Readonly<Record<string, unknown>> | undefined) => o != null && Object.hasOwn(o, p.label)
    const late = Object.values(ev.stages).some((s) => s.kind === 'workers' && s.autoscale?.ready)
    return named(model.def.ramps) || named(model.def.colds) || late ? p.label : undefined
  }, [ev, model])
  const [said, setSaid] = useState<{ ev: unknown; text: string | null } | null>(null)
  useEffect(() => {
    if (preset == null) return
    // the walk is a whole evaluation a step: once for these values, whatever renders them again
    const key = `${preset}|${JSON.stringify(ev.values)}`
    const known = moments.get(model)?.get(key)
    if (known !== undefined) {
      setSaid({ ev, text: known })
      return
    }
    let live = true
    import('@loadmap/core/moments')
      .then(({ moment }) => moment(model, ev.values, preset).text)
      // a model that throws on the way up (a formula at a load between two) has no line, as it has no error here
      .catch(() => null)
      .then((text) => {
        const byKey = moments.get(model) ?? new Map<string, string | null>()
        if (byKey.size > 16) byKey.delete(byKey.keys().next().value!)
        byKey.set(key, text)
        moments.set(model, byKey)
        if (live) setSaid({ ev, text })
      })
    return () => {
      live = false
    }
  }, [ev, model, preset])
  return preset != null && said?.ev === ev ? said.text : null
}

/** What each model's moments said, by preset and values. */
const moments = new WeakMap<object, Map<string, string | null>>()

/** The preset that lasts whose values are the ones shown, if one is. */
function shownMoment(ev: LoadmapController['ev']) {
  const p = ev.presets.find(
    (x) =>
      x.lasts != null && Object.entries(x.values).every(([k, v]) => (ev.values as Record<string, unknown>)[k] === v),
  )
  return p?.lasts ? (p as typeof p & { lasts: number }) : undefined
}

/**
 * While the values are a preset's that says how long it lasts: what it leaves in the queues. "After 2 h of Black
 * Friday, 1.4M events wait in the events topic, which at 1× clears in 5 h." Worked out once per evaluation.
 */
function usePeak(lm: LoadmapController): string | null {
  const { ev, model } = lm
  return useMemo(() => {
    const p = shownMoment(ev)
    if (!p) return null
    const left = backlog(model, ev.values, p.lasts)
    const head = `After ${period(p.lasts)} of ${p.label}`
    if (!left.length) return `${head}, no queue falls behind.`
    const rest = multiple(model.defaults().load as number, model.searchMax)
    const parts = left.map((b) => {
      // what waits, named by its flow when one flow holds it all
      const flows = Object.entries(b.flows).filter(([, n]) => n > 0)
      const one = flows.length === 1 ? flows[0]![0] : undefined
      const what = one == null ? 'units' : (model.def.flows[one]?.label ?? one)
      const clears = Number.isFinite(b.empties) ? `clears in ${period(b.empties)}` : 'never clears'
      const name = ev.stages[b.stage]?.label ?? b.stage
      // a queue with a size: when the peak fills it, and what it then holds
      if (b.full)
        return `${name} is full after ${period(b.full.after)} with ${compact(b.units)} ${what}, and at ${rest} ${clears}`
      return `${compact(b.units)} ${what} wait in ${name}, which at ${rest} ${clears}`
    })
    return `${head}, ${parts.join('; ')}.`
  }, [ev, model])
}

/**
 * "A burst of 500 passes: at 3× all gets through for 2.5 s, then it is cut to 100 req/s." Below the limit the bucket is
 * only said: nothing spends it.
 */
function burstText(b: { size: number; passes: number; lasts?: number }, load: number, unit: string): string {
  const head = `A burst of ${compact(b.size)} passes`
  if (b.lasts == null) return `${head} over the limit.`
  // what the limit lets through, in the units a second of what reaches it
  const rate = unit.includes('/') ? unit : `${unit}/s`
  return `${head}: at ${fmt(load)}× all gets through for ${duration(b.lasts)}, then it is cut to ${fmt(b.passes)} ${rate}.`
}

/** "A daily quota: gone after 15.2 h, the rest refused." In the window's own steps, so a day just over says 23.5 h. */
function quotaText(q: { per: QuotaWindow; goneAfter?: number }): string {
  const name = { minute: 'A per-minute', hour: 'An hourly', day: 'A daily', month: 'A monthly' }[q.per]
  if (q.goneAfter == null) return `${name} quota.`
  const [step, word] = { minute: [1, 's'], hour: [60, 'min'], day: [3_600, 'h'], month: [86_400, 'days'] }[q.per] as [
    number,
    string,
  ]
  return `${name} quota: gone after ${fmt(q.goneAfter / step)} ${word}, the rest refused.`
}

/** "Runs every day: a run takes 1.9 h of its 4 h." Past its window: "a run needs 5 h of its 4 h: it misses it." */
function runsText(r: { every: number; within: number; takes: number }): string {
  const every = { 3600: 'hour', 86400: 'day', 604800: 'week' }[r.every] ?? period(r.every)
  if (!Number.isFinite(r.takes)) return `Runs every ${every}: a run never ends.`
  if (r.takes > r.within)
    return `Runs every ${every}: a run needs ${period(r.takes)} of its ${period(r.within)}, so it misses it.`
  return `Runs every ${every}: a run takes ${period(r.takes)} of its ${period(r.within)}.`
}

/** "Gains 3.1 GB a day · full in 41 days at this rate"; "Keeps 7 days of 9.3 GB a day". */
function stockText(s: Stock, unit: string): string {
  const day = `${fmt(s.gains * 86_400)} ${unit} a day`
  if (s.keeps != null) return `Keeps ${period(s.keeps)} of ${day}.`
  return s.room === 0 ? `Full: it gains ${day}.` : `Gains ${day} · full in ${period(s.room ?? Infinity)} at this rate.`
}

/** Each component's utilization in the order they reach the target, with where they cross it and 100 %. */
export function Limits({ lm, title = 'Where it runs out, in order' }: { lm: LoadmapController; title?: ReactNode }) {
  const { ev, model } = lm
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const at = (u: number) => `${(u / top) * 100}%`
  const span = (r: { low: number; high: number } | null, x: number | null) =>
    r ? multiples(r, model.searchMax, true) : multiple(x, model.searchMax)
  // N−1: where it reaches the target with one part of a domain out, when that is sooner
  const outageSuffix = (c: (typeof ev.ranked)[number]) =>
    nMinusOne(lm).flatMap((o) => {
      const r = o.components[c.id]
      return r && r.low < (c.targetRange?.low ?? Number.POSITIVE_INFINITY)
        ? [` · ${o.with}: ${pct(model.thresholds.target)} at ${span(r, null)}`]
        : []
    })
  return (
    <>
      <h3>{title}</h3>
      <div className="lm-scale" aria-hidden="true">
        <span />
        <div>
          <span style={{ left: 0, transform: 'none' }}>0</span>
          <span style={{ left: at(model.thresholds.target) }}>{pct(model.thresholds.target)} target</span>
          <span style={{ left: at(model.thresholds.full) }}>{pct(model.thresholds.full)}</span>
          <span style={{ left: '100%', transform: 'translateX(-100%)' }}>{pct(top)}</span>
        </div>
        <span />
      </div>
      <div className="lm-limits">
        {ev.ranked.map((c) => (
          <div className="lm-lim" key={c.id} data-component={c.id}>
            <div>
              <b>
                {c.name}
                {c === ev.firstLimit && (
                  <span className="lm-tag" data-kind="first">
                    limit
                  </span>
                )}
                <CapTag c={c.capacity} />
              </b>
              <span className="lm-sub">
                {c.missing != null
                  ? `No published benchmark ${c.missing}.`
                  : (c.describe ?? (c.capacity ? `${fmt(c.capacity.value)} ${c.capacity.unit}` : 'switched off'))}
              </span>
              {c.spread && c.util != null && <span className="lm-sub lm-spread">{c.spread.text}</span>}
              {c.stock && <span className="lm-sub lm-stock">{stockText(c.stock, c.capacity?.unit ?? '')}</span>}
              {c.quota && <span className="lm-sub lm-quota">{quotaText(c.quota)}</span>}
              {c.keys && (
                <span className="lm-sub lm-keys">
                  {`${fmt(c.keys.count)} keys, each its own limit: the hottest carries ${pct(c.keys.hottest, true)} of what arrives.`}
                </span>
              )}
              {c.burst && (
                <span className="lm-sub lm-burst">
                  {burstText(c.burst, lm.ev.values.load, c.capacity?.unit ?? 'units')}
                </span>
              )}
              {c.runs && <span className="lm-sub lm-runs">{runsText(c.runs)}</span>}
            </div>
            <div
              className="lm-track"
              role="img"
              aria-label={`${c.name} at ${c.missing != null ? 'no published benchmark' : c.util == null ? 'off' : pct(c.util)}`}
            >
              <div
                className="lm-fill"
                data-state={c.state}
                style={{ width: `${Math.min(100, ((c.util ?? 0) / top) * 100)}%` }}
              />
              <div className="lm-tick" style={{ left: at(model.thresholds.target) }} />
              <div className="lm-tick" style={{ left: at(model.thresholds.full) }} />
            </div>
            <div className="lm-val">
              {c.util == null ? '—' : `${pct(c.util)} · ${num(c.demand ?? 0)} ${c.capacity?.unit ?? ''}`}
              <small>
                {c.util == null
                  ? c.stock?.undated
                    ? 'not ranked: no growth dates it'
                    : 'switched off'
                  : `${pct(model.thresholds.target)} at ${span(c.targetRange, c.target)} · full at ${span(c.fullRange, c.full)}${outageSuffix(c).join('')}`}
              </small>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Live numbers: from the sim, lag and drops per queue, busy workers, rejected requests; from the model, pods running,
 * cache answers and retries.
 */
export function Meters({ lm }: { lm: LoadmapController }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250)
    return () => clearInterval(t)
  }, [])
  const { ev, engine, model } = lm
  const sim = engine.sim
  const flowLabel = (f: string) => model.def.flows[f]?.label ?? f
  const items: { key: string; value: string; label: string; state: 'ok' | 'warn' | 'over' }[] = []
  for (const s of Object.values(ev.stages)) {
    if (s.kind === 'queue')
      for (const f of model.flowIds.filter((x) => ev.paths[x]?.some((p) => p.stages.includes(s.id)))) {
        const q = sim.queue(s.id, f)
        const rules = ev.overload[f] ?? {}
        items.push({
          key: `${s.id}/${f}/lag`,
          value: secs(q.lag),
          label: `${flowLabel(f)} lag in ${s.label}`,
          state: q.lag > 60 ? 'over' : q.lag > 5 ? 'warn' : 'ok',
        })
        if (rules.merge)
          items.push({
            key: `${s.id}/${f}/merge`,
            value: compact(q.merged),
            label: `${flowLabel(f)} superseded /s (${rules.merge.reason ?? 'newest kept'})`,
            state: q.merged > 0.5 ? 'warn' : 'ok',
          })
        if (s.holds != null)
          items.push({
            key: `${s.id}/${f}/full`,
            value: compact(q.refused),
            label: `${flowLabel(f)} turned away /s (${s.label} holds ${compact(s.holds)})`,
            state: q.refused > 0.5 ? 'over' : 'ok',
          })
        if (rules.drop)
          items.push({
            key: `${s.id}/${f}/drop`,
            value: compact(q.dropped),
            label: `${flowLabel(f)} dropped /s (${rules.drop.reason ?? 'too old'})`,
            state: q.dropped > 0.5 ? 'over' : 'ok',
          })
      }
    if (s.kind === 'workers') {
      const b = sim.busy(s.id)
      items.push({
        key: `${s.id}/busy`,
        value: pct(b),
        label: `${s.label} busy`,
        state: b > 0.95 ? 'over' : b > 0.5 ? 'warn' : 'ok',
      })
      if (s.autoscale)
        items.push({
          key: `${s.id}/pods`,
          value: `${s.running} of ${s.pods}`,
          label: `${s.label} pods running`,
          state:
            s.running < s.pods
              ? 'ok'
              : (ev.components[s.component]?.util ?? 0) > model.thresholds.full
                ? 'over'
                : 'warn',
        })
    }
    if (s.kind === 'cache') {
      items.push({
        key: `${s.id}/hits`,
        value: compact(sim.arriving(s.id) * (1 - sim.shed(s.id)) * s.hit),
        label: `answered at ${s.label} /s (${pct(s.hit)} hits)`,
        state: 'ok',
      })
    }
    if ((s.kind === 'pass' || s.kind === 'limit' || s.kind === 'cache' || s.kind === 'split') && sim.shed(s.id) > 0)
      items.push({ key: `${s.id}/shed`, value: pct(sim.shed(s.id)), label: `rejected at ${s.label}`, state: 'over' })
  }
  for (const f of model.flowIds) {
    const r = ev.retry[f]
    if (!r || !(r.rate > 0)) continue
    // a retry at a hop: the attempts each unit that reaches the stage gets there
    for (const [s, h] of Object.entries(r.hops ?? {}))
      items.push({
        key: `${f}/attempts/${s}`,
        value: `${fmt(h.attempts)}×`,
        label: `${flowLabel(f)} attempts at ${ev.stages[s]?.label ?? s}`,
        state: h.attempts > 1.05 ? 'warn' : 'ok',
      })
    // its client retries nothing: what the hops' retries still leave failing
    if (!r.times) {
      items.push({
        key: `${f}/failed`,
        value: pct(r.failed),
        label: `${flowLabel(f)} failing after the retries at its hops`,
        state: r.failed > 0.005 ? 'over' : 'ok',
      })
      continue
    }
    const per = r.attempts / r.rate
    items.push({
      key: `${f}/attempts`,
      value: `${fmt(per)}×`,
      label: `${flowLabel(f)} attempts per ${model.def.flows[f]?.unit ?? 'unit'}`,
      state: per > 1.05 ? 'warn' : 'ok',
    })
    items.push({
      key: `${f}/failed`,
      value: pct(r.failed),
      label: `${flowLabel(f)} failing after ${r.times} ${r.times === 1 ? 'retry' : 'retries'}`,
      state: r.failed > 0.005 ? 'over' : 'ok',
    })
  }
  // what is promised for these values: the scenario shown, up to its underTarget (or at the values without one)
  const scenario = model.scenarioOf(lm.values)?.label
  const down = (lm.values as { down?: unknown }).down ?? 'none'
  const partOf = (domain: string, part: unknown) =>
    typeof part === 'string' &&
    Object.hasOwn((model.def.domains as Record<string, { parts?: object }> | undefined)?.[domain]?.parts ?? {}, part)
  const promised = (e: (typeof model.expectations)[number]) =>
    (e.scenario == null || e.scenario === scenario) &&
    // a scenario may set the outage itself: only an expectation's own `down` asks for it
    // one that names a domain with its parts by name holds whichever part is out
    (e.down == null || e.down === down || partOf(e.down, down)) &&
    (e.underTarget == null || lm.values.load <= e.underTarget)
  // what a flow loses for good, where an expectation holds it at any values: against the strictest promised here
  for (const f of model.flowIds) {
    // a branch's expectation (to) holds the branch, not the flow
    const held = model.expectations.filter((e) => e.lost != null && e.to == null && (e.flow ?? f) === f)
    if (!held.length) continue
    const goals = held.filter(promised).map((e) => e.lost!)
    const lost = ev.lost[f]?.share ?? 0
    items.push({
      key: `${f}/lost`,
      value: pct(lost, true),
      label: `${flowLabel(f)} lost`,
      state: goals.length ? (lost > Math.min(...goals) + 1e-8 ? 'over' : 'ok') : lost > 1e-8 ? 'warn' : 'ok',
    })
  }
  // from the service times: a flow whose way has one
  for (const f of model.flowIds) {
    const l = ev.latency[f]
    if (!l) continue
    const goal = model.expectations.find((e) => e.flow === f && e.to == null && e.p99 != null && promised(e))?.p99
    items.push({
      key: `${f}/p99`,
      value: duration(l.p99),
      label: `${flowLabel(f)} p99`,
      state: !Number.isFinite(l.p99) || (goal != null && l.p99 > goal) ? 'over' : 'ok',
    })
    if (l.timedOut != null)
      items.push({
        key: `${f}/late`,
        value: pct(l.timedOut),
        label: `${flowLabel(f)} timed out`,
        state: l.timedOut > 0.005 ? 'over' : l.timedOut > 0 ? 'warn' : 'ok',
      })
  }
  return (
    <>
      <h3>Live</h3>
      <div className="lm-meters">
        {items.map((m) => (
          <div className="lm-meter" data-state={m.state} key={m.key}>
            <b>{m.value}</b>
            <span title={m.label}>{m.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * The load slider (unless `load` is false: the page shows a `LoadBar`), the presets that set no load, and every
 * parameter, greyed out where it does not apply.
 */
export function Controls({ lm, load = true }: { lm: LoadmapController; load?: boolean }) {
  const { model, values, setValues, ev } = lm
  const v = values as Record<string, any>
  // a preset that sets the load is a mark on the slider
  const presets = ev.presets.filter((p) => !('load' in p.values))
  return (
    <div className="lm-card lm-controls">
      {load && <h3>Load</h3>}
      {load && <LoadRange lm={lm} />}
      {presets.length > 0 && (
        <div className="lm-presets">
          {presets.map((p) => (
            <button type="button" key={p.label} aria-pressed={isOn(lm, p)} onClick={() => setValues(p.values)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {model.params.length > 1 && <h3>Design</h3>}
      {model.params.map(({ id, def }) => {
        if (def.kind === 'load') return null
        const enabled = model.isEnabled(id, v)
        const tag = def.tag && (
          <span className="lm-tag" data-kind="estimated">
            {def.tag}
          </span>
        )
        if (def.kind === 'switch')
          return (
            <label className={`lm-switch${enabled ? '' : ' lm-off'}`} key={id}>
              <input
                type="checkbox"
                checked={Boolean(v[id])}
                disabled={!enabled}
                onChange={(e) => setValues({ [id]: e.target.checked } as any)}
              />
              <span>
                {def.label}
                {tag}
              </span>
              {def.hint && <small>{def.hint}</small>}
            </label>
          )
        if (def.kind === 'select')
          return (
            <label className={`lm-select${enabled ? '' : ' lm-off'}`} key={id}>
              <span>
                {def.label}
                {tag}
              </span>
              <select
                value={String(v[id])}
                disabled={!enabled}
                onChange={(e) => {
                  const opt = def.options.find((o: number | string) => String(o) === e.target.value)
                  setValues({ [id]: opt } as any)
                }}
              >
                {def.options.map((o: number | string) => (
                  <option key={String(o)} value={String(o)}>
                    {def.format ? def.format(o) : String(o)}
                  </option>
                ))}
              </select>
              {def.hint && <small>{def.hint}</small>}
            </label>
          )
        return (
          <label className={`lm-range${enabled ? '' : ' lm-off'}`} key={id}>
            <span>
              {def.label}
              {tag} <output>{def.format ? def.format(v[id]) : fmt(v[id])}</output>
            </span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={v[id]}
              disabled={!enabled}
              onChange={(e) => setValues({ [id]: Number(e.target.value) } as any)}
            />
            {def.hint && <small>{def.hint}</small>}
          </label>
        )
      })}
    </div>
  )
}

/** What the model assumes: every capacity with its provenance, every fit, and anything the page adds. */
export function Assumptions({ lm, extra = [] }: { lm: LoadmapController; extra?: readonly ReactNode[] }) {
  return (
    <div className="lm-card">
      <h3>What this assumes</h3>
      <ul className="lm-facts">
        {extra.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the page's own list, in its order
          <li key={i}>{x}</li>
        ))}
        {lm.ev.assumptions.map((a) => (
          <li key={a.kind === 'capacity' ? `c:${a.component}` : `${a.kind}:${a.name}`}>{describe(a)}</li>
        ))}
      </ul>
    </div>
  )
}

function describe(a: Assumption): ReactNode {
  if (a.kind === 'capacity') {
    const c = a.capacity
    if (c.missing != null)
      return (
        <>
          <b>{a.name}:</b> no capacity:{' '}
          <span className="lm-prov" data-kind="published">
            no published benchmark
          </span>{' '}
          {c.missing}.{unread(c.unread)}
        </>
      )
    if (c.ref)
      return (
        <>
          <Published name={a.name} c={c} />
          {unread(c.unread)}
        </>
      )
    return (
      <>
        <b>{a.name}:</b> {c.unit === 'share' ? pct(c.value) : `${fmt(c.value)} ${c.unit}`}
        {c.within ? ` ${plusMinus(c)}` : ''},{' '}
        <span className="lm-prov" data-kind={c.provenance}>
          {c.provenance}
        </span>
        {c.source ? ` (${c.source})` : ''}.{unread(c.unread)}
      </>
    )
  }
  if (a.kind === 'connection')
    return (
      <>
        <b>{a.name}:</b> {a.text}
      </>
    )
  if (a.kind === 'measurement') {
    // a reading is drawn as a measured capacity would be
    const { label, unit, value, missing, source } = a.measurement
    const name = label ?? a.name
    if (missing != null)
      return (
        <>
          <b>{name}:</b>
          {unread(missing)}
        </>
      )
    return describe({
      kind: 'capacity',
      component: '',
      name,
      capacity: { value, unit, provenance: 'measured', source },
    })
  }
  const f = a.fit
  const shape = 'curve' in f ? curveText(f) : `${f.y} = ${sig(f.a)} + ${sig(f.b)} × ${f.x}`
  return (
    <>
      <b>{a.name}:</b> {shape}, r² {f.r2.toFixed(3)} over {f.n} points,{' '}
      <span className="lm-prov" data-kind="measured">
        measured
      </span>
      {f.source ? ` (${f.source})` : ''}.{unread(f.unread)}
    </>
  )
}

/** A snapshot that gave no value: the line says the written one stands in. */
const unread = (why: string | undefined) => (why == null ? '' : ` No data from the snapshot (${why}).`)

/** A published figure with what it is, its conditions and where it comes from: a vendor's run, not this system. */
function Published({ name, c }: { name: string; c: Capacity }) {
  const r = c.ref!
  const runs = r.versions.join(', ')
  return (
    <>
      <b>{name}:</b> {fmt(c.value)} {c.unit}
      {c.within ? ` ${plusMinus(c)}` : ''},{' '}
      <span className="lm-prov" data-kind="published">
        {r.measure === 'limit' ? 'published limit' : 'published'}
      </span>
      : {r.name}, {r.what}, {r.scope} ({r.conditions.join('; ')}); {r.name} {runs}
      {r.version && r.version !== runs ? `, you run ${r.version}` : ''}; {sourceText(r)} (
      {/^https:\/\//.test(r.source.url) ? (
        <a href={r.source.url} target="_blank" rel="noopener noreferrer">
          source
        </a>
      ) : (
        r.source.url
      )}
      , catalog {r.edition}).{r.measure === 'limit' ? '' : ' A best case elsewhere, not a measurement of this system.'}
    </>
  )
}

/** Exact below 1,000 (3.9 cores), compact above (12k req/s). */
const num = (x: number) => (Math.abs(x) >= 1000 ? compact(x) : fmt(x))

const sig = (x: number) => Number(x.toPrecision(3)).toString()
