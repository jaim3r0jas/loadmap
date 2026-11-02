import { compile, formatDiagnostic } from '@loadmap/dsl'
import { collisions, layout } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../src/templates'

describe('templates', () => {
  it('are six, with unique ids and the title their source declares', () => {
    expect(TEMPLATES).toHaveLength(6)
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(6)
    for (const t of TEMPLATES) expect(t.source).toContain(`title: "${t.title}"`)
  })

  for (const t of TEMPLATES)
    describe(t.id, () => {
      const r = compile(t.source)

      it('compiles without a warning and keeps every expectation', () => {
        expect(r.diagnostics.map((d) => formatDiagnostic(d, t.source, `${t.id}.loadmap`))).toEqual([])
        expect(r.expectations.length).toBeGreaterThan(0)
        for (const e of r.expectations) expect(e.result.ok, e.result.message).toBe(true)
      })

      // the defaults, each scenario, and every select at its smallest and its largest option
      it('lays out without a collision in both directions', async () => {
        const model = r.definition!.model
        const view = r.definition!.view
        const selects = model.params.flatMap(({ id, def }) =>
          def.kind === 'select' ? [{ id, options: def.options }] : [],
        )
        expect(selects.length).toBeGreaterThan(0)
        const pick = (i: 0 | -1) => Object.fromEntries(selects.map((p) => [p.id, p.options.at(i)]))
        const sets = [{}, ...model.scenarios.map((s) => s.values), pick(0), pick(-1)]
        for (const direction of ['RIGHT', 'DOWN'] as const)
          for (const values of sets) {
            const scene = await layout(view, model.evaluate(values), { direction })
            expect(collisions(scene), `${direction} ${JSON.stringify(values)}`).toEqual([])
          }
      })
    })
})
