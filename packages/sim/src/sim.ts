import { type Evaluation, type Model, niceStep, type ResolvedStage } from '@loadmap/core'
import { busyOf, type Fill, fillOrder } from './fill'
import { rng } from './rng'

export interface SimOptions {
  seed?: number
  /** Simulated seconds per real second. Default 10. */
  speed?: number
  /** About how many dots a second all flows together should spawn; sets the dot scale. Default 28. */
  dotTarget?: number
  /** Every flow with any rate spawns at least this many dots a second, so a small flow stays visible. Default 1. */
  minDots?: number
  /** And at most this many per flow. Default 40. */
  maxDots?: number
  /** Real seconds a dot takes from one stage to the next. Default 0.45. */
  legSeconds?: number
  /** Most dots alive at once. Default 800. */
  maxParticles?: number
}

/** Where a dot is or is heading: a stage (null: the flow's source), and a cell inside it (partition or worker). */
export interface Place {
  stage: string | null
  cell?: number
}

export interface Particle {
  id: number
  flow: string
  /** Index into the flow's route of the stage it is heading to or at. */
  leg: number
  phase: 'move' | 'hold' | 'fade'
  /** Real seconds into the current phase, and its length. */
  t: number
  dur: number
  from: Place
  to: Place
  outcome?: 'delivered' | 'dropped' | 'rejected'
}

export interface QueueState {
  /** Units waiting. */
  backlog: number
  /** Age of the oldest unit waiting, in simulated seconds: what a consumer-lag dashboard shows. */
  lag: number
  /** Units per second arriving, served and dropped (smoothed). */
  arriving: number
  served: number
  dropped: number
}

interface Cohort {
  t: number
  n: number
}

const MERGE_WINDOW = 1 // simulated seconds: arrivals this close share a cohort
const MAX_COHORTS = 2000
const TAU = 3 // simulated seconds: smoothing of the rates shown on meters

/**
 * A fluid model of the queues, driven by the model's utilization, plus dots sampled from it.
 *
 * Each queue stage is drained by the next stage on each flow's route, at that stage's capacity: what its flows carry
 * at the load where its component runs out (the limits' "full at N×"), so a queue grows exactly when the load passes
 * the point the bars show. Flows share that capacity by priority (1 first), across every queue feeding the stage.
 * Backlog is kept as arrival cohorts, so the lag is the real age of the oldest unit and a drop rule can remove
 * exactly the units older than its limit.
 */
export class Sim {
  readonly speed: number
  time = 0
  particles: Particle[] = []
  dotScale = 1

  #o: Required<SimOptions>
  #r: () => number
  #model: Model
  #ev!: Evaluation
  #shape = ''
  #queues = new Map<string, Map<string, { cohorts: Cohort[]; s: QueueState }>>()
  #busy = new Map<string, number>()
  #fills = new Map<string, Fill>()
  #shed = new Map<string, number>()
  #inflow = new Map<string, number>() // `${stage}/${flow}` → units per second reaching that stage
  #capacity = new Map<string, number>() // stage → units per second it can drain
  #spawn = new Map<string, number>()
  #nextId = 1

  constructor(model: Model, ev: Evaluation, o: SimOptions = {}) {
    this.#o = {
      seed: 1,
      speed: 10,
      dotTarget: 28,
      minDots: 1,
      maxDots: 40,
      legSeconds: 0.45,
      maxParticles: 800,
      ...o,
    }
    this.speed = this.#o.speed
    this.#r = rng(this.#o.seed)
    this.#model = model
    this.update(ev)
    // start the workers at their steady-state share instead of ramping up from idle
    for (const s of Object.values(ev.stages)) if (s.kind === 'workers') this.#busy.set(s.id, this.#steadyBusy(s.id))
  }

  /** New values or a new evaluation: rates and capacities change, backlog stays. A new shape clears the dots. */
  update(ev: Evaluation): void {
    this.#ev = ev
    const shape = JSON.stringify(Object.values(ev.stages))
    if (shape !== this.#shape) {
      this.#shape = shape
      this.particles = []
      for (const s of Object.values(ev.stages) as ResolvedStage[])
        if (s.kind === 'workers') this.#fills.set(s.id, fillOrder(s.pods, s.perPod, s.fill, this.#o.seed))
    }

    const full = this.#model.thresholds.full
    this.#shed.clear()
    this.#inflow.clear()
    for (const s of Object.values(ev.stages) as ResolvedStage[]) {
      const u = s.kind === 'pass' ? this.#util(s.component) : null
      this.#shed.set(s.id, u != null && u > full ? 1 - full / u : 0)
    }
    for (const f of this.#model.flowIds) {
      let rate = ev.flows[f] ?? 0
      for (const st of ev.routes[f] ?? []) {
        this.#inflow.set(`${st}/${f}`, rate)
        rate *= 1 - (this.#shed.get(st) ?? 0)
      }
    }
    // a stage drains what its flows carry at the load where its component runs out, the same point the limits show
    this.#capacity.clear()
    const routedThrough = (s: string) => this.#model.flowIds.filter((f) => ev.routes[f]?.includes(s))
    for (const s of Object.values(ev.stages) as ResolvedStage[]) {
      const c = s.component ? ev.components[s.component] : undefined
      let cap = Number.POSITIVE_INFINITY
      if (c && c.util != null && c.full != null && Number.isFinite(c.full)) {
        if (c.full > 0) {
          const at = this.#model.evaluate({ ...ev.values, load: c.full })
          cap = routedThrough(s.id).reduce((a, f) => a + (at.flows[f] ?? 0), 0)
        } else {
          // already past "full" at no load: scale what it carries now
          const now = routedThrough(s.id).reduce((a, f) => a + (this.#inflow.get(`${s.id}/${f}`) ?? 0), 0)
          cap = c.util > 0 ? (now * full) / c.util : 0
        }
      }
      this.#capacity.set(s.id, cap)
    }

    const total = this.#model.flowIds.reduce((a, f) => a + (ev.flows[f] ?? 0), 0)
    this.dotScale = Math.max(1, niceStep(total / this.#o.dotTarget))
  }

  /** Advance by `dtReal` real seconds: the queues by dtReal × speed, the dots by dtReal. */
  step(dtReal: number, o: { particles?: boolean } = {}): void {
    if (!(dtReal > 0)) return
    const dt = dtReal * this.speed
    this.time += dt
    this.#stepQueues(dt)
    if (o.particles !== false) {
      this.#spawnDots(dtReal)
      this.#moveDots(dtReal)
    }
  }

  queue(stage: string, flow: string): QueueState {
    return this.#queues.get(stage)?.get(flow)?.s ?? { backlog: 0, lag: 0, arriving: 0, served: 0, dropped: 0 }
  }

  /** How busy a stage is, 0–1, smoothed: for a workers stage, the share of its workers at work. */
  busy(stage: string): number {
    return this.#busy.get(stage) ?? this.#steadyBusy(stage)
  }

  /** The share of arrivals a pass stage rejects because its component is past capacity. */
  shed(stage: string): number {
    return this.#shed.get(stage) ?? 0
  }

  /** How busy worker `i` of a workers stage is, 0–1. */
  slotBusy(stage: string, i: number): number {
    const f = this.#fills.get(stage)
    return f ? busyOf(i, f, this.busy(stage)) : 0
  }

  #util(component: string): number | null {
    return this.#ev.components[component]?.util ?? null
  }

  #steadyBusy(stage: string): number {
    const s = this.#ev.stages[stage]
    const u = s?.component ? this.#util(s.component) : null
    return Math.min(1, (u ?? 0) / this.#model.thresholds.full)
  }

  #stepQueues(dt: number): void {
    const ev = this.#ev
    const entries: { q: string; f: string; fq: { cohorts: Cohort[]; s: QueueState }; drainer: string; prio: number }[] =
      []
    for (const q of Object.values(ev.stages) as ResolvedStage[]) {
      if (q.kind !== 'queue') continue
      const qs = this.#queues.get(q.id) ?? new Map()
      this.#queues.set(q.id, qs)
      for (const f of this.#model.flowIds) {
        const route = ev.routes[f] ?? []
        if (!route.includes(q.id)) continue
        const fq = qs.get(f) ?? { cohorts: [], s: { backlog: 0, lag: 0, arriving: 0, served: 0, dropped: 0 } }
        qs.set(f, fq)
        const n = (this.#inflow.get(`${q.id}/${f}`) ?? 0) * dt
        const last = fq.cohorts.at(-1)
        if (last && this.time - last.t < MERGE_WINDOW) last.n += n
        else if (n > 0) fq.cohorts.push({ t: this.time, n })
        if (fq.cohorts.length > MAX_COHORTS) fq.cohorts = mergePairs(fq.cohorts)
        const drainer = route[route.indexOf(q.id) + 1] ?? '∞'
        entries.push({ q: q.id, f, fq, drainer, prio: this.#model.def.flows[f]?.priority ?? 1 })
      }
    }

    // each drainer's capacity goes to its flows by priority, across every queue that feeds it;
    // flows of equal priority share in proportion to their backlog
    const taken = new Map<string, number>()
    for (const d of new Set(entries.map((e) => e.drainer))) {
      const feeding = entries.filter((e) => e.drainer === d)
      let avail = d === '∞' ? Number.POSITIVE_INFINITY : (this.#capacity.get(d) ?? Number.POSITIVE_INFINITY) * dt
      for (const pr of [...new Set(feeding.map((e) => e.prio))].sort((a, b) => a - b)) {
        const group = feeding.filter((e) => e.prio === pr)
        const want = group.reduce((a, e) => a + backlog(e.fq.cohorts), 0)
        let took = 0
        for (const e of group) {
          const b = backlog(e.fq.cohorts)
          const take = Number.isFinite(avail) ? (want > 0 ? Math.min(b, (avail * b) / want) : 0) : b
          serveOldest(e.fq.cohorts, take)
          took += take
          e.fq.s.served = ema(e.fq.s.served, take / dt, dt)
        }
        avail = Math.max(0, avail - took)
        taken.set(d, (taken.get(d) ?? 0) + took)
      }
    }

    for (const { q, f, fq } of entries) {
      let dropped = 0
      const rule = this.#model.def.flows[f]?.overload?.drop
      if (rule)
        while (fq.cohorts.length && this.time - fq.cohorts[0]!.t > rule.olderThan) dropped += fq.cohorts.shift()!.n
      const inflow = this.#inflow.get(`${q}/${f}`) ?? 0
      // a sliver of the step's own arrivals is rounding, not backlog
      if (backlog(fq.cohorts) < 1e-9 * Math.max(1, inflow)) fq.cohorts = []
      fq.s.backlog = backlog(fq.cohorts)
      fq.s.lag = fq.cohorts.length ? this.time - fq.cohorts[0]!.t : 0
      fq.s.arriving = ema(fq.s.arriving, inflow, dt)
      fq.s.dropped = ema(fq.s.dropped, dropped / dt, dt)
    }

    for (const s of Object.values(ev.stages) as ResolvedStage[]) {
      if (s.kind !== 'workers') continue
      const cap = this.#capacity.get(s.id) ?? Number.POSITIVE_INFINITY
      const now =
        taken.has(s.id) && Number.isFinite(cap) && cap > 0 ? taken.get(s.id)! / (cap * dt) : this.#steadyBusy(s.id)
      this.#busy.set(s.id, ema(this.#busy.get(s.id) ?? now, Math.min(1, now), dt))
    }
  }

  #spawnDots(dtReal: number): void {
    const { minDots, maxDots, legSeconds, maxParticles } = this.#o
    for (const f of this.#model.flowIds) {
      const rate = this.#ev.flows[f] ?? 0
      if (rate <= 0) continue
      const perSec = Math.min(maxDots, Math.max(minDots, rate / this.dotScale))
      let acc = (this.#spawn.get(f) ?? 0) + perSec * dtReal
      while (acc >= 1) {
        acc -= 1
        if (this.particles.length >= maxParticles) continue
        const first = this.#ev.routes[f]![0]!
        this.particles.push({
          id: this.#nextId++,
          flow: f,
          leg: 0,
          phase: 'move',
          t: 0,
          dur: legSeconds,
          from: { stage: null },
          to: this.#place(first, f),
        })
      }
      this.#spawn.set(f, acc)
    }
  }

  #moveDots(dtReal: number): void {
    const ev = this.#ev
    const fade = (d: Particle, outcome: Particle['outcome'], dur: number) => {
      d.phase = 'fade'
      d.outcome = outcome
      d.t = 0
      d.dur = dur
      d.from = d.to
    }
    const advance = (d: Particle) => {
      const route = ev.routes[d.flow]!
      if (d.leg + 1 >= route.length) return fade(d, 'delivered', 0.35)
      d.leg++
      d.phase = 'move'
      d.t = 0
      d.dur = this.#o.legSeconds
      d.from = d.to
      d.to = this.#place(route[d.leg]!, d.flow)
    }

    for (const d of this.particles) {
      d.t += dtReal
      if (d.t < d.dur) continue
      const stage = ev.stages[d.to.stage ?? '']
      if (d.phase === 'fade' || !stage) {
        d.phase = 'fade'
        d.outcome ??= 'delivered'
        continue
      }
      if (d.phase === 'move') {
        if (stage.kind === 'pass' && this.#r() < this.shed(stage.id)) fade(d, 'rejected', 0.6)
        else if (stage.kind === 'queue') {
          const lag = this.queue(stage.id, d.flow).lag
          d.phase = 'hold'
          d.t = 0
          d.dur = 0.12 + (Math.min(lag, 120) / 120) * 2.6
        } else if (stage.kind === 'workers') {
          d.phase = 'hold'
          d.t = 0
          d.dur = 0.15
        } else advance(d)
      } else if (d.phase === 'hold') {
        const q = stage.kind === 'queue' ? this.queue(stage.id, d.flow) : null
        const dropShare = q && q.arriving > 0 ? Math.min(1, q.dropped / q.arriving) : 0
        if (this.#r() < dropShare) fade(d, 'dropped', 0.6)
        else advance(d)
      }
    }
    this.particles = this.particles.filter((d) => !(d.phase === 'fade' && d.t >= d.dur))
  }

  #place(stage: string, flow: string): Place {
    const s = this.#ev.stages[stage]
    if (s?.kind === 'queue') {
      const n = s.partitions[flow] ?? 0
      return n > 0 ? { stage, cell: Math.floor(this.#r() * n) } : { stage }
    }
    if (s?.kind === 'workers') return { stage, cell: this.#pickWorker(s.id, s.pods * s.perPod) }
    return { stage }
  }

  /** A worker chosen in proportion to how busy it is, so dots land where the fill shows work. */
  #pickWorker(stage: string, n: number): number {
    let total = 0
    for (let i = 0; i < n; i++) total += this.slotBusy(stage, i)
    if (total <= 0.001) return Math.floor(this.#r() * n)
    let r = this.#r() * total
    for (let i = 0; i < n; i++) {
      r -= this.slotBusy(stage, i)
      if (r <= 0) return i
    }
    return n - 1
  }
}

export function createSim(model: Model, ev: Evaluation, o?: SimOptions): Sim {
  return new Sim(model, ev, o)
}

const backlog = (c: readonly Cohort[]) => c.reduce((a, x) => a + x.n, 0)

function serveOldest(c: Cohort[], amount: number): void {
  let left = amount
  while (left > 0 && c.length) {
    const head = c[0]!
    if (head.n <= left) {
      left -= head.n
      c.shift()
    } else {
      head.n -= left
      left = 0
    }
  }
}

function mergePairs(c: readonly Cohort[]): Cohort[] {
  const out: Cohort[] = []
  for (let i = 0; i < c.length; i += 2) {
    const a = c[i]!
    const b = c[i + 1]
    out.push(b ? { t: a.t, n: a.n + b.n } : a)
  }
  return out
}

function ema(prev: number, now: number, dt: number): number {
  return prev + (now - prev) * Math.min(1, dt / TAU)
}
