import type { Evaluation, Model, ResolvedStage } from '@loadmap/core'
import { niceStep } from '@loadmap/core/format'
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
  /** Index into its way through (its path) of the stage it is heading to or at. */
  leg: number
  /** Which of the flow's paths it takes, past a split; the only one without. */
  path?: number
  phase: 'move' | 'hold' | 'fade'
  /** Real seconds into the current phase, and its length. */
  t: number
  dur: number
  from: Place
  to: Place
  /** Set on a copy made at a fan-out: the branch stage it is heading to. */
  branch?: string
  /** Set on a cache hit heading back to where it came from, answered. */
  back?: boolean
  /** Which attempt this is: 0 for the first, 1 for the first retry, and so on. */
  attempt?: number
  /**
   * superseded: merged into a newer unit of its key; unread: a fan-out that made no copy; answered: a cache hit back
   * where it came from.
   */
  outcome?: 'delivered' | 'dropped' | 'rejected' | 'superseded' | 'unread' | 'answered' | 'timedout'
}

export interface QueueState {
  /** Units waiting. */
  backlog: number
  /** Age of the oldest unit waiting, in simulated seconds: what a consumer-lag dashboard shows. */
  lag: number
  /** Units per second arriving, served, dropped and superseded by a merge (smoothed). */
  arriving: number
  served: number
  dropped: number
  merged: number
  /** A merge rule is at work: more than a second of arrivals waits. */
  merging: boolean
}

const emptyQueue = (): QueueState => ({
  backlog: 0,
  lag: 0,
  arriving: 0,
  served: 0,
  dropped: 0,
  merged: 0,
  merging: false,
})

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
  #fills = new Map<string, Fill>() // `${stage}/${running pods}` → fill order over the running pods
  #shed = new Map<string, number>()
  #late = new Map<string, number>() // `${flow}/${path}` or `${flow}/${path}/${cache}` → the share of those too slow
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

  /**
   * New values or a new evaluation: rates and capacities change, backlog stays. A new shape (partitions, workers)
   * keeps every dot whose partition or worker still exists, so switching designs does not empty the picture.
   */
  update(ev: Evaluation): void {
    this.#ev = ev
    // only what places dots: partitions and workers (a fan-out share or a label does not move a dot)
    const shape = JSON.stringify(
      (Object.values(ev.stages) as ResolvedStage[]).map((st) =>
        st.kind === 'queue'
          ? [st.id, st.partitions]
          : st.kind === 'workers'
            ? [st.id, st.pods, st.perPod, st.fill]
            : [st.id, st.kind],
      ),
    )
    if (shape !== this.#shape) {
      this.#shape = shape
      const fits = (at: Place, flow: string) => {
        if (at.stage == null) return true
        const st = ev.stages[at.stage] as ResolvedStage | undefined
        if (!st) return false
        if (at.cell == null) return true
        if (st.kind === 'queue') return at.cell < (st.partitions[flow] ?? 0)
        if (st.kind === 'workers') return at.cell < st.pods * st.perPod
        return false
      }
      this.particles = this.particles.filter((d) => fits(d.from, d.flow) && fits(d.to, d.flow))
      this.#fills.clear()
    }

    const full = this.#model.thresholds.full
    const stages = Object.values(ev.stages) as ResolvedStage[]
    // what each stage turns away of what actually reaches it, worked out by the model (the bottleneck decides)
    this.#shed.clear()
    for (const s of stages) this.#shed.set(s.id, 'shed' in s ? s.shed : 0)
    // the latency is worked out only for a flow with a timeout, per way: no other recording reads it
    this.#late.clear()
    for (const f of this.#model.flowIds)
      if (this.#model.def.flows[f]?.timeout != null)
        for (const w of ev.latency[f]?.ways ?? [])
          this.#late.set(`${f}/${w.path}${w.answeredAt ? `/${w.answeredAt}` : ''}`, w.timedOut)
    this.#inflow.clear()
    for (const f of this.#model.flowIds) {
      const ways = ev.paths[f] ?? []
      for (const way of ways) {
        let rate = (ev.flows[f] ?? 0) * way.share
        for (const st of way.stages) {
          const key = `${st}/${f}`
          // past a split, the ways that meet again add up
          this.#inflow.set(key, ways.length > 1 ? (this.#inflow.get(key) ?? 0) + rate : rate)
          const s = ev.stages[st] as ResolvedStage
          // a fan-out turns away copies, not arrivals
          if (s.kind !== 'fanout') rate *= 1 - (this.#shed.get(st) ?? 0)
          if (s.kind === 'cache') rate *= 1 - s.hit
        }
      }
    }
    // a stage drains what reaches it at the load where its component runs out, the same point the limits show
    this.#capacity.clear()
    // one evaluation per load where something runs out: with retries each one solves them again
    const atFull = new Map<number, Evaluation>()
    for (const s of stages) {
      const c = s.component ? ev.components[s.component] : undefined
      let cap = Number.POSITIVE_INFINITY
      if (c && c.util != null && c.full != null && Number.isFinite(c.full)) {
        if (c.full > 0) {
          let at = atFull.get(c.full)
          if (!at) {
            at = this.#model.evaluate({ ...ev.values, load: c.full })
            atFull.set(c.full, at)
          }
          cap = this.#model.flowIds.reduce((a, f) => a + (at.at[s.id]?.[f] ?? 0), 0)
        } else {
          // already past "full" at no load: scale what reaches it now
          const offered = this.#model.flowIds.reduce((x, f) => x + (ev.at[s.id]?.[f] ?? 0), 0)
          cap = c.util > 0 ? (offered * full) / c.util : 0
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
    return this.#queues.get(stage)?.get(flow)?.s ?? emptyQueue()
  }

  /** How busy a stage is, 0–1, smoothed: for a workers stage, the share of its workers at work. */
  busy(stage: string): number {
    return this.#busy.get(stage) ?? this.#steadyBusy(stage)
  }

  /**
   * The share a pass, limit or cache stage (of what reaches it) or a fan-out (of its copies) rejects because its
   * component is past capacity.
   */
  shed(stage: string): number {
    return this.#shed.get(stage) ?? 0
  }

  /** How busy worker `i` of a workers stage is, 0–1; 0 in a pod an autoscaler has not started. */
  slotBusy(stage: string, i: number): number {
    const s = this.#ev.stages[stage]
    if (s?.kind !== 'workers' || i >= s.running * s.perPod) return 0
    const key = `${stage}/${s.running}`
    let f = this.#fills.get(key)
    if (!f) {
      f = fillOrder(s.running, s.perPod, s.fill, this.#o.seed)
      this.#fills.set(key, f)
    }
    return busyOf(i, f, this.busy(stage))
  }

  /** Units per second actually reaching a stage on the flows' routes, after what stages before it turned away. */
  arriving(stage: string): number {
    return this.#model.flowIds.reduce((a, f) => a + (this.#inflow.get(`${stage}/${f}`) ?? 0), 0)
  }

  /** The pods a workers stage runs: fewer than it draws while an autoscaler holds it small. */
  running(stage: string): number {
    const s = this.#ev.stages[stage]
    return s?.kind === 'workers' ? s.running : 0
  }

  #util(component: string): number | null {
    return this.#ev.components[component]?.util ?? null
  }

  #steadyBusy(stage: string): number {
    const s = this.#ev.stages[stage]
    const u = s?.component ? this.#util(s.component) : null
    return Math.min(1, ((u ?? 0) / this.#model.thresholds.full) * this.#scaled(stage) * this.#even(stage))
  }

  /**
   * A connection's spread raises the utilization to its busiest member's; the workers drawn busy are the average, so
   * the fill takes it back out.
   */
  #even(stage: string): number {
    const c = this.#ev.stages[stage]?.component
    return 1 / ((c && this.#ev.components[c]?.spread?.factor) || 1)
  }

  /** The workers drawn over the workers running: the busy share of the running ones is that much higher. */
  #scaled(stage: string): number {
    const s = this.#ev.stages[stage]
    return s?.kind === 'workers' && s.running > 0 ? s.pods / s.running : 1
  }

  #stepQueues(dt: number): void {
    const ev = this.#ev
    const entries: {
      q: string
      f: string
      fq: { cohorts: Cohort[]; s: QueueState }
      drainer: string
      prio: number
      /** Units removed per unit of capacity used: 1, or 1 ÷ (1 − share) while a merge is at work. */
      k: number
    }[] = []
    for (const q of Object.values(ev.stages) as ResolvedStage[]) {
      if (q.kind !== 'queue') continue
      const qs = this.#queues.get(q.id) ?? new Map()
      this.#queues.set(q.id, qs)
      for (const f of this.#model.flowIds) {
        // the stage after a queue is the same on every way through it: the ways part only at a split
        const route = (ev.paths[f] ?? []).find((p) => p.stages.includes(q.id))?.stages
        if (!route) continue
        const fq = qs.get(f) ?? { cohorts: [], s: emptyQueue() }
        qs.set(f, fq)
        const inflow = this.#inflow.get(`${q.id}/${f}`) ?? 0
        const share = Math.min(0.95, Math.max(0, ev.overload[f]?.merge?.share ?? 0))
        // a merge works on backlog: more than a second of arrivals already waiting, this step's own not counted
        fq.s.merging = share > 0 && backlog(fq.cohorts) > inflow * 1
        const n = inflow * dt
        const last = fq.cohorts.at(-1)
        if (last && this.time - last.t < MERGE_WINDOW) last.n += n
        else if (n > 0) fq.cohorts.push({ t: this.time, n })
        if (fq.cohorts.length > MAX_COHORTS) fq.cohorts = mergePairs(fq.cohorts)
        const drainer = route[route.indexOf(q.id) + 1] ?? '∞'
        const k = fq.s.merging ? 1 / (1 - share) : 1
        entries.push({ q: q.id, f, fq, drainer, prio: this.#model.def.flows[f]?.priority ?? 1, k })
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
        // what each entry needs in capacity units: a merging one clears its backlog with 1 / k of it
        const want = group.reduce((a, e) => a + backlog(e.fq.cohorts) / e.k, 0)
        let took = 0
        for (const e of group) {
          const b = backlog(e.fq.cohorts)
          // a merge removes k units for each unit of capacity: the newest of each key is handled, the rest superseded
          // its capacity share is avail × (b / k) / want; that share removes k times as many units
          const removed = Number.isFinite(avail) ? (want > 0 ? Math.min(b, (avail * b) / want) : 0) : b
          const used = removed / e.k
          serveOldest(e.fq.cohorts, removed)
          took += used
          e.fq.s.served = ema(e.fq.s.served, used / dt, dt)
          e.fq.s.merged = ema(e.fq.s.merged, (removed - used) / dt, dt)
        }
        avail = Math.max(0, avail - took)
        taken.set(d, (taken.get(d) ?? 0) + took)
      }
    }

    for (const { q, f, fq } of entries) {
      let dropped = 0
      const rule = ev.overload[f]?.drop
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
        taken.has(s.id) && Number.isFinite(cap) && cap > 0
          ? (taken.get(s.id)! / (cap * dt)) * this.#scaled(s.id) * this.#even(s.id)
          : this.#steadyBusy(s.id)
      this.#busy.set(s.id, ema(this.#busy.get(s.id) ?? now, Math.min(1, now), dt))
    }
  }

  #spawnDots(dtReal: number): void {
    const { minDots, maxDots, legSeconds, maxParticles } = this.#o
    for (const f of this.#model.flowIds) {
      // a retrying flow spawns its new units; the retries come back from the units turned away
      const rate = this.#ev.retry[f]?.rate ?? this.#ev.flows[f] ?? 0
      if (rate <= 0) continue
      const perSec = Math.min(maxDots, Math.max(minDots, rate / this.dotScale))
      let acc = (this.#spawn.get(f) ?? 0) + perSec * dtReal
      while (acc >= 1) {
        acc -= 1
        if (this.particles.length >= maxParticles) continue
        const path = this.#pick(f)
        this.particles.push({
          id: this.#nextId++,
          flow: f,
          leg: 0,
          ...(path != null && { path }),
          phase: 'move',
          t: 0,
          dur: legSeconds,
          from: { stage: null },
          to: this.#place(this.#way(f, path)[0]!, f),
        })
      }
      this.#spawn.set(f, acc)
    }
  }

  /** A unit turned away, sent again from its source while it has retries left and the budget allows. */
  #retry(d: Particle): Particle | null {
    const r = this.#ev.retry[d.flow]
    const attempt = (d.attempt ?? 0) + 1
    if (!r || attempt > r.times || this.#r() >= r.retried) return null
    // a retry is a new attempt: it may go another way
    const path = this.#pick(d.flow)
    return {
      id: this.#nextId++,
      flow: d.flow,
      leg: 0,
      ...(path != null && { path }),
      phase: 'move',
      t: 0,
      dur: this.#o.legSeconds,
      from: { stage: null },
      to: this.#place(this.#way(d.flow, path)[0]!, d.flow),
      attempt,
    }
  }

  /**
   * The way a new dot goes, by the share of each: drawn only when a flow has more than one, so a model without a split
   * draws what it always drew, and its recordings stay the same.
   */
  #pick(flow: string): number | undefined {
    const ways = this.#ev.paths[flow] ?? []
    if (ways.length < 2) return undefined
    let x = this.#r()
    for (const [i, w] of ways.entries()) {
      x -= w.share
      if (x < 0) return i
    }
    return ways.length - 1
  }

  /** The stages a dot's way goes through; the first way when the shares changed and its way is gone. */
  #way(flow: string, path: number | undefined): readonly string[] {
    const ways = this.#ev.paths[flow] ?? []
    return (ways[path ?? 0] ?? ways[0])?.stages ?? this.#ev.routes[flow] ?? []
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
    const born: Particle[] = []
    const advance = (d: Particle) => {
      const route = this.#way(d.flow, d.path)
      if (d.leg + 1 >= route.length) {
        // too slow for its client: it fails at the end of its way and is sent again, as the model's share says
        const late = this.#late.get(`${d.flow}/${d.path ?? 0}`)
        if (late && this.#r() < late) return reject(d, 'timedout')
        return fade(d, 'delivered', 0.35)
      }
      d.leg++
      d.phase = 'move'
      d.t = 0
      d.dur = this.#o.legSeconds
      d.from = d.to
      d.to = this.#place(route[d.leg]!, d.flow)
    }

    const reject = (d: Particle, outcome: Particle['outcome'] = 'rejected') => {
      fade(d, outcome, 0.6)
      const again = this.particles.length + born.length < this.#o.maxParticles ? this.#retry(d) : null
      if (again) born.push(again)
    }
    for (const d of this.particles) {
      d.t += dtReal
      if (d.t < d.dur) continue
      if (d.phase === 'move' && d.back) {
        // answered by a cache, still too slow: its share of the way answered there
        const late = this.#late.get(`${d.flow}/${d.path ?? 0}/${d.from.stage ?? ''}`)
        if (late && this.#r() < late) reject(d, 'timedout')
        else fade(d, 'answered', 0.35)
        continue
      }
      const stage = ev.stages[d.to.stage ?? '']
      if (d.phase === 'fade' || !stage) {
        d.phase = 'fade'
        d.outcome ??= 'delivered'
        continue
      }
      if (d.phase === 'move' && d.branch) {
        // a fan-out copy ends where it lands
        const refused =
          this.#r() < this.shed(d.from.stage ?? '') || (stage.kind === 'pass' && this.#r() < this.shed(stage.id))
        fade(d, refused ? 'rejected' : 'delivered', 0.35)
      } else if (d.phase === 'move' && stage.kind === 'fanout') {
        let made = 0
        for (const b of stage.to[d.flow] ?? []) {
          const copies = Math.floor(b.share) + (this.#r() < b.share % 1 ? 1 : 0)
          for (let i = 0; i < copies; i++, made++)
            if (this.particles.length + born.length < this.#o.maxParticles)
              born.push({
                id: this.#nextId++,
                flow: d.flow,
                leg: d.leg,
                phase: 'move',
                t: 0,
                dur: this.#o.legSeconds,
                from: d.to,
                to: { stage: b.stage },
                branch: b.stage,
              })
        }
        // the copies carry on; a unit nobody receives fades where it stopped
        if (made) fade(d, 'delivered', 0)
        else fade(d, 'unread', 0.6)
      } else if (d.phase === 'move') {
        const turnsAway =
          stage.kind === 'pass' || stage.kind === 'limit' || stage.kind === 'cache' || stage.kind === 'split'
        if (turnsAway && this.#r() < this.shed(stage.id)) reject(d)
        else if (stage.kind === 'cache' && this.#r() < stage.hit) {
          // answered here: back along the edge it came in on
          const to = d.from
          d.from = d.to
          d.to = to
          d.t = 0
          d.dur = this.#o.legSeconds
          d.back = true
        } else if (stage.kind === 'queue') {
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
        const mergeShare = q?.merging ? (ev.overload[d.flow]?.merge?.share ?? 0) : 0
        if (this.#r() < mergeShare) fade(d, 'superseded', 0.6)
        else if (this.#r() < dropShare) fade(d, 'dropped', 0.6)
        else advance(d)
      }
    }
    this.particles = this.particles.filter((d) => !(d.phase === 'fade' && d.t >= d.dur)).concat(born)
  }

  #place(stage: string, flow: string): Place {
    const s = this.#ev.stages[stage]
    if (s?.kind === 'queue') {
      const n = s.partitions[flow] ?? 0
      return n > 0 ? { stage, cell: Math.floor(this.#r() * n) } : { stage }
    }
    // only among the running pods: the ones an autoscaler has not started take no work
    if (s?.kind === 'workers') return { stage, cell: this.#pickWorker(s.id, s.running * s.perPod) }
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
