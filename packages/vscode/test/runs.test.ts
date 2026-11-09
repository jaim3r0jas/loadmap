import { type Published, published } from '@loadmap/core'
import { fmt } from '@loadmap/core/format'
import { loadCatalog } from '@loadmap/dsl'
import { addPublished, latestEdition } from '@loadmap/dsl/internal'
import { beforeAll, describe, expect, it } from 'vitest'
import { componentRows, runs } from '../src/runs'

let components: Record<string, Published>
beforeAll(async () => {
  const e = await loadCatalog()
  components = { ...e[latestEdition(e)]!.components }
})

describe('Add from the catalog, as QuickPick rows', () => {
  it('lists the components by name, and says which publish nothing', () => {
    const rows = componentRows(Object.values(components))
    expect(rows.map((r) => r.label)).toEqual([...rows.map((r) => r.label)].sort((a, b) => a.localeCompare(b)))
    expect(rows.find((r) => r.component.id === 'postgresql')!.detail).toMatch(/^Nothing published/)
    expect(rows.find((r) => r.component.id === 'kafka')!.detail).not.toMatch(/^Nothing published/)
  })

  it('gives each published capacity as a row, the figure published() gives for what the row writes', () => {
    const kafka = components.kafka!
    const rows = runs(kafka)
    // the latency run is a reference, never a capacity
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      const cap = published(kafka, { ...r.pick.conditions, ...(r.pick.figure ? { figure: r.pick.figure } : {}) })
      expect(cap.ref).toBeTruthy()
      expect(r.label).toBe(`${fmt(cap.value)} ${cap.unit}`)
      expect(r.url).toMatch(/^https:\/\//)
    }
    expect(rows[0]!.description).toContain('3 brokers')
    expect(rows[0]!.detail).toMatch(/^published, a best case: .* · run by /)
  })

  it('names the figure where runs share their conditions, and the version where it decides', () => {
    const k8s = runs(components.kubernetes!)
    expect(k8s.map((r) => r.pick.figure)).toEqual(['nodes', 'pods', 'containers', 'pods-per-node'])
    expect(k8s[0]!.detail).toMatch(/^published limit/)
    expect(runs(components.kafka!).every((r) => r.pick.figure === undefined)).toBe(true)
    const valkey = runs(components.valkey!)
    expect(valkey.map((r) => r.pick.version)).toEqual(['8.0'])
    expect(valkey[0]!.description).toMatch(/ · 8\.0$/)
  })

  it('has one row that says so for a component without a published capacity', () => {
    for (const id of ['postgresql', 'opensearch']) {
      const rows = runs(components[id]!)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.label).toBe('No published benchmark')
      expect(rows[0]!.pick.conditions).toEqual({})
    }
    expect(runs(components.opensearch!)[0]!.detail).toContain('latency, not a capacity')
  })

  it('writes text that compiles, for every row of every component', () => {
    // the smallest definition: each pick compiles it twice
    const text = 'loadmap 1\nload "Users" { max: 10; default: 2 }\n'
    for (const c of Object.values(components))
      for (const r of runs(c)) {
        const added = addPublished(text, { component: c, ...r.pick, into: 'new' })
        expect(added, `${c.id}: ${r.label} ${r.description}`).not.toHaveProperty('error')
      }
  })
})
