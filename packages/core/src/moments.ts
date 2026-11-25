// types only from the model: a value would split the packed core in two
import { capital, duration, fmt, pct, period } from './format'
import type { Evaluation, Model } from './model'
import type { LooseValues } from './params'

/** One step of a moment: the load then, each flow's lost share, each pool's pods ready, and what is past full. */
export interface MomentStep {
  /** Seconds from the start of the way up: the middle of the step. */
  t: number
  /** Its length in seconds: short on the way up, longer once every pod could be ready. */
  dt: number
  load: number
  /** Each flow's share lost for good at this step. */
  lost: Readonly<Record<string, number>>
  /** Each autoscaled pool with a ready time: the pods ready to take work. */
  ready: Readonly<Record<string, number>>
  /** The components past full. */
  over: readonly string[]
}

/** What a preset's moment does on its way up: the load climbs over its ramp, then holds for its length. */
export interface Moment {
  preset: string
  /** Seconds the load takes to climb from the default to the preset's. */
  ramp: number
  /** Seconds it then holds. */
  lasts: number
  steps: readonly MomentStep[]
  /**
   * Each flow over the whole moment: the units it lost, their share of what it sent, the worst share at one step, and
   * the seconds from and until which it lost more than it does once every pod is ready.
   */
  lost: Readonly<Record<string, { units: number; share: number; worst: number; from?: number; until?: number }>>
  /**
   * The components with no figure on the way: a published one whose pool is still starting pods, which is never scaled.
   * What is lost there is not known, and the text says so.
   */
  unknown: readonly string[]
  /** One sentence: "8× in 30 s: up to 14 % of requests is lost for 2 min, until the sixth pod of the API is ready." */
  text: string
}

/** The key `moment()` sets each pool's ready share under: the model reads it, a definition cannot write it. */
const PODS_READY = Symbol.for('loadmap.podsReady')

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
]
const ordinal = (n: number) => {
  if (ORDINALS[n - 1]) return ORDINALS[n - 1]!
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')}`
}
/** A span of a moment: seconds to two minutes, then as a stock's time reads. */
const span = (s: number) => (s < 120 ? `${fmt(Math.round(s))} s` : period(s))

/**
 * A preset's moment walked in its own time: a fixed number of steps over the ramp and the length, no clock and no
 * randomness. The load climbs from the default to the preset's over its ramp, then holds; a pool that autoscales takes
 * the pods it wants only its `ready` time after it wants them, and until then has the share of its capacity that is
 * ready. One evaluation a step, the same values evaluated once. A module of its own: a page loads it only when a
 * preset with a moment is shown.
 */
export function moment<P>(
  model: Model<P, string, string, string>,
  values: LooseValues,
  preset: string,
  steps = 120,
): Moment {
  const own = <T>(o: Readonly<Record<string, T>> | undefined, k: string) =>
    o && Object.hasOwn(o, k) ? o[k] : undefined
  const lasts = own(model.def.peaks, preset)
  if (lasts == null) throw new Error(`loadmap: preset "${preset}" has no moment: give it how long it lasts`)
  const ramp = own(model.def.ramps, preset) ?? 0
  if (!(Number.isInteger(steps) && steps >= 2)) throw new Error(`loadmap: a moment takes 2 steps or more, not ${steps}`)
  const shown = {
    ...model.defaults(),
    ...values,
    ...own(model.def.presets as Record<string, object>, preset),
  } as Record<string, unknown>
  const from = model.defaults().load as number
  const to = shown.load as number
  const loadAt = (t: number) => (ramp > 0 && t < ramp ? from + ((to - from) * Math.max(0, t)) / ramp : to)

  const cache = new Map<string, Evaluation>()
  const at = (load: number, ready?: Readonly<Record<string, number>>) => {
    const key = `${load}|${ready ? JSON.stringify(ready) : ''}`
    let ev = cache.get(key)
    if (!ev) {
      ev = model.evaluate({ ...shown, load, ...(ready ? { [PODS_READY]: ready } : {}) } as never) as Evaluation
      cache.set(key, ev)
    }
    return ev
  }

  // the pools that take time to start pods: by stage, with their component
  const base = at(to)
  const pools = Object.values(base.stages).flatMap((s) =>
    s.kind === 'workers' && s.autoscale?.ready
      ? [{ stage: s.id, component: s.component, max: s.autoscale.max, ready: s.autoscale.ready }]
      : [],
  )
  const wanted = (stage: string, load: number) => {
    const s = at(load).stages[stage]
    return s?.kind === 'workers' ? s.running : 0
  }
  // a pod wanted at τ takes work at τ + ready; one no longer wanted stops at once
  const readyAt = (t: number) => {
    const counts: Record<string, number> = {}
    const shares: Record<string, number> = {}
    for (const p of pools) {
      const before = wanted(p.stage, from)
      const late = t >= p.ready ? wanted(p.stage, loadAt(t - p.ready)) : before
      const want = wanted(p.stage, loadAt(t))
      const n = Math.min(want, Math.max(before, late))
      counts[p.stage] = n
      // the capacity is the pool at its max pods, which the autoscaler takes as it needs: with every pod it wants
      // ready it is whole, and short of them it has the pods ready (two pools on one component: the one further behind)
      const share = n >= want ? 1 : n / p.max
      shares[p.component] = Math.min(shares[p.component] ?? 1, share)
    }
    return { counts, shares: Object.values(shares).every((x) => x >= 1) ? undefined : shares }
  }

  const flows = Object.keys(base.flows)
  // once every pod is ready: what the preset itself loses, held as long as it lasts
  const steady = Object.fromEntries(flows.map((f) => [f, base.lost[f]?.share ?? 0]))
  const full = model.thresholds.full
  const total = ramp + lasts
  // the way up in fine steps, and the rest of the moment, where nothing more starts, in a quarter as many: a short ramp
  // inside a long moment is still seen. With nothing to wait for, one even grid
  const settled = Math.min(total, ramp + 2 * Math.max(0, ...pools.map((p) => p.ready)))
  const split = settled > 0 && settled < total
  const fine = split ? steps : steps + Math.ceil(steps / 4)
  const edges: number[] = []
  for (let i = 0; i <= fine; i++) edges.push(((split ? settled : total) * i) / fine)
  if (split) {
    const coarse = Math.ceil(steps / 4)
    for (let i = 1; i <= coarse; i++) edges.push(settled + ((total - settled) * i) / coarse)
  }
  const out: MomentStep[] = []
  const unknown = new Set<string>()
  const sent: Record<string, number> = Object.fromEntries(flows.map((f) => [f, 0]))
  // what each flow loses above what it does once every pod is ready: the way up's own loss
  const extra: Record<string, number> = Object.fromEntries(flows.map((f) => [f, 0]))
  const lastStep: Record<string, number> = {}
  const lost = Object.fromEntries(
    flows.map((f) => [
      f,
      { units: 0, share: 0, worst: 0 } as {
        units: number
        share: number
        worst: number
        from?: number
        until?: number
      },
    ]),
  )
  for (let i = 0; i < edges.length - 1; i++) {
    // each step at its middle: the sums are a midpoint rule over the moment
    const dt = edges[i + 1]! - edges[i]!
    const t = edges[i]! + dt / 2
    const load = loadAt(t)
    const { counts, shares } = readyAt(t)
    const ev = at(load, shares)
    // a published figure is never scaled: while its pool starts pods it has none, and what is lost there is not known
    for (const c of Object.keys(shares ?? {}))
      if (ev.components[c]?.capacity?.missing === 'with pods still starting') unknown.add(c)
    const step: Record<string, number> = {}
    for (const f of flows) {
      const l = ev.lost[f] ?? { rate: 0, share: 0 }
      step[f] = l.share
      sent[f]! += (ev.flows[f] ?? 0) * dt
      const x = lost[f]!
      x.units += l.rate * dt
      x.worst = Math.max(x.worst, l.share)
      extra[f]! += Math.max(0, l.share - steady[f]!) * (ev.flows[f] ?? 0) * dt
      if (l.share > steady[f]! + 1e-6) {
        x.from ??= edges[i]!
        x.until = edges[i + 1]!
        lastStep[f] = i
      }
    }
    const over = Object.values(ev.components)
      .filter((c) => c.util != null && c.util > full)
      .map((c) => c.id)
    out.push({ t, dt, load, lost: step, ready: counts, over })
  }
  for (const f of flows) lost[f]!.share = sent[f]! > 0 ? Math.min(1, lost[f]!.units / sent[f]!) : 0

  // the flow that loses most on the way up speaks, and what ends its loss: a pod that is ready then, or the end
  const worst = flows.filter((f) => lost[f]!.until != null).sort((a, b) => extra[b]! - extra[a]!)[0]
  const head = ramp > 0 ? `${fmt(to)}× in ${duration(ramp)}` : `${fmt(to)}× at once`
  const holds = flows.filter((f) => steady[f]! > 1e-6).sort((a, b) => steady[b]! - steady[a]!)[0]
  let text = holds
    ? `${capital(head)}: no more is lost on the way than once every pod is ready, ${pct(steady[holds]!, true)} of ${model.def.flows[holds]?.label ?? holds}.`
    : `${capital(head)}: everything keeps up on the way.`
  if (worst) {
    const x = lost[worst]!
    const label = model.def.flows[worst]?.label ?? worst
    const last = lastStep[worst]!
    let ends = last >= out.length - 1 ? `, to the end of its ${period(lasts)}` : ''
    if (!ends) {
      // the step where the loss ends: a pod that became ready there ends it
      const now = out[last + 1]!.ready
      const then = out[last]!.ready
      const p = pools.find((q) => now[q.stage]! > then[q.stage]!)
      if (p)
        ends = `, until the ${ordinal(now[p.stage]!)} pod of ${base.components[p.component]?.short ?? p.component} is ready`
    }
    // what the preset loses even with every pod ready goes on after
    const then = steady[worst]! > 1e-6 ? `, then ${pct(steady[worst]!, true)} as it holds` : ''
    text = `${capital(head)}: up to ${pct(x.worst, true)} of ${label} is lost for ${span(x.until! - x.from!)}${ends}${then}.`
  } else if (!holds) {
    // past full on the way, not at the moment itself
    const onTheWay = (c: string) => !base.components[c] || !(base.components[c]!.util! > full)
    const c = out.flatMap((s) => s.over).find(onTheWay)
    if (c) text = `${capital(head)}: nothing is lost, but ${base.components[c]?.short ?? c} is past full on the way.`
  }
  if (unknown.size) {
    const who = [...unknown].map((c) => base.components[c]?.short ?? c)
    const many = who.length > 1
    text = `${capital(head)}: ${who.join(' and ')} ${many ? 'have' : 'has'} no published benchmark while ${many ? 'their' : 'its'} pods start, so what is lost on the way is not known.`
  }
  return { preset, ramp, lasts, steps: out, lost, unknown: [...unknown], text }
}
