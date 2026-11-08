// What a model shows, read from the model and its view: the chips on the examples page. Read, not written, so a
// template or an example that gains a feature shows it with no edit to the page.
import type { Model, View } from '@loadmap/react'

/** The features a model and its view use, in a fixed order: building blocks first, then how it is told. */
export function features(model: Model, view: View): string[] {
  const stages = Object.values(model.def.stages) as { kind: string; autoscale?: unknown }[]
  const kinds = new Set(stages.map((s) => s.kind))
  // a rule set by a parameter (retries 0 or 3) counts where any declared design turns it on
  const evs = [model.evaluate(), ...model.scenarios.map((s) => model.evaluate(s.values))]
  const overload = evs.flatMap((ev) => Object.values(ev.overload) as { drop?: unknown; merge?: unknown }[])
  const assumptions = evs[0]!.assumptions
  const priorities = new Set(model.flowIds.map((f) => model.def.flows[f]?.priority ?? 0))
  const all: [string, boolean][] = [
    ['queue', kinds.has('queue')],
    ['cache', kinds.has('cache')],
    ['rate limiter', kinds.has('limit')],
    ['autoscale', stages.some((s) => s.kind === 'workers' && s.autoscale)],
    ['retries', evs.some((ev) => Object.values(ev.retry).some((r) => r && r.times > 0))],
    ['fan-out', kinds.has('fanout')],
    ['priority', priorities.size > 1],
    ['drop', overload.some((o) => o.drop)],
    ['merge', overload.some((o) => o.merge)],
    ['± range', assumptions.some((a) => a.kind === 'capacity' && (a.capacity.within ?? 0) > 0)],
    ['fit', assumptions.some((a) => a.kind === 'fit')],
    ['tiers', Object.keys(view.def.tiers ?? {}).length > 0],
    ['scenarios', model.scenarios.length > 1],
    ['growth', model.growth != null],
    ['expectations', model.expectations.length > 0],
    ['story', model.story.length > 0],
    ['stable layout', view.def.layout === 'stable'],
  ]
  return all.filter(([, on]) => on).map(([name]) => name)
}
