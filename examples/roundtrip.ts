// Checks that a .loadmap definition and the TypeScript it mirrors give the same model, layout and dots.
import type { Evaluation, Model } from '@loadmap/core'
import { compile, type Definition, formatDiagnostic } from '@loadmap/dsl'
import { labelsAt, layout, structureKey, type View } from '@loadmap/layout'
import { createSim } from '@loadmap/sim'
import { expect } from 'vitest'

export function compiled(source: string, file: string): Definition {
  const r = compile(source)
  const errors = r.diagnostics.map((d) => formatDiagnostic(d, source, file))
  expect(errors).toEqual([])
  return r.definition!
}

/** Everything the page shows from an evaluation, with fits reduced to their numbers. */
function shown(ev: Evaluation) {
  return {
    values: ev.values,
    flows: ev.flows,
    components: ev.components,
    ranked: ev.ranked.map((c) => c.id),
    firstLimit: ev.firstLimit?.id,
    firstFull: ev.firstFull?.id,
    verdict: ev.verdict,
    presets: ev.presets,
    assumptions: ev.assumptions.map((a) => (a.kind === 'fit' ? { ...a, fit: { ...a.fit } } : a)),
    stages: ev.stages,
    routes: ev.routes,
    overload: ev.overload,
  }
}

export function sameModel(ts: Model, dsl: Model, grid: readonly Record<string, unknown>[]) {
  expect(dsl.params.map((p) => [p.id, p.def.kind, p.def.label])).toEqual(
    ts.params.map((p) => [p.id, p.def.kind, p.def.label]),
  )
  expect([dsl.flowIds, dsl.componentIds, dsl.stageIds]).toEqual([ts.flowIds, ts.componentIds, ts.stageIds])
  for (const v of grid) {
    expect(shown(dsl.evaluate(v as any)), JSON.stringify(v)).toEqual(shown(ts.evaluate(v as any)))
    for (const p of ts.params)
      expect(dsl.isEnabled(p.id, { ...ts.defaults(), ...v })).toBe(ts.isEnabled(p.id, { ...ts.defaults(), ...v }))
  }
}

export async function sameView(ts: View, dsl: View, grid: readonly Record<string, unknown>[]) {
  for (const v of grid) {
    const a = ts.model.evaluate(v as any)
    const b = dsl.model.evaluate(v as any)
    expect(labelsAt(dsl, b)).toEqual(labelsAt(ts, a))
    for (const direction of ['RIGHT', 'DOWN'] as const) {
      expect(structureKey(dsl, b, { direction })).toBe(structureKey(ts, a, { direction }))
      expect(await layout(dsl, b, { direction })).toEqual(await layout(ts, a, { direction }))
    }
  }
}

export function sameDots(ts: Model, dsl: Model, values: Record<string, unknown>) {
  const a = createSim(ts, ts.evaluate(values as any), { seed: 7 })
  const b = createSim(dsl, dsl.evaluate(values as any), { seed: 7 })
  for (let i = 0; i < 600; i++) {
    a.step(1 / 30, { particles: true })
    b.step(1 / 30, { particles: true })
  }
  expect(b.particles.length).toBeGreaterThan(0)
  expect(b.particles).toEqual(a.particles)
  for (const s of ts.stageIds) {
    expect(b.busy(s)).toBe(a.busy(s))
    for (const f of ts.flowIds) expect(b.queue(s, f)).toEqual(a.queue(s, f))
  }
}

/** Defaults, presets, each option of each parameter, and a range of loads. */
export function grid(model: Model): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{}]
  for (const p of model.evaluate().presets) out.push(p.values)
  for (const { id, def } of model.params) {
    if (def.kind === 'select') for (const o of def.options) out.push({ [id]: o })
    if (def.kind === 'switch') out.push({ [id]: !def.default })
  }
  for (const load of [1, 10, 40, 100]) out.push({ load })
  return out
}
