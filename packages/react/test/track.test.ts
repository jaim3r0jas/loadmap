import { type Preset, p } from '@loadmap/core'
import { fmt } from '@loadmap/core/format'
import { describe, expect, it } from 'vitest'
import { labelled, loadScale, marksOf, zones } from '../src/track'

describe('the load slider', () => {
  it('puts a load that spans ten times or more on a log scale, snapped to its step', () => {
    const { at, of } = loadScale(p.load({ max: 100 }))
    expect(at(1)).toBe(0)
    expect(at(10)).toBeCloseTo(0.5)
    expect(at(100)).toBe(1)
    expect(of(0.5)).toBe(10)
    expect(of(0.43)).toBe(7)
    // past either end it stays at the end
    expect([at(0), at(500), of(-1), of(2)]).toEqual([0, 1, 1, 100])
  })

  it('keeps a short span linear, and a step under one exact', () => {
    const { at, of } = loadScale(p.load({ min: 1, max: 5, step: 0.1 }))
    expect(at(3)).toBe(0.5)
    expect(of(0.26)).toBe(2)
    expect(of(0.3)).toBe(2.2)
    // a step taken by the keys comes back on the grid, without a float's dust
    expect(of(at(1.1 + 0.1))).toBe(1.2)
    const zero = loadScale(p.load({ min: 0, max: 100, step: 5 }))
    expect(zero.at(50)).toBe(0.5)
    expect(zero.of(0.52)).toBe(50)
  })

  it('marks every preset that sets the load, a derived one at its own multiple', () => {
    const presets: Preset<any>[] = [
      { label: 'Today · 1×', values: { load: 1 }, derived: false },
      { label: 'Black Friday', values: { load: 40, pods: 6 }, derived: false },
      { label: 'Bigger pods', values: { pods: 6 }, derived: false },
      { label: '50 % target · 7.4×', values: { load: 7 }, derived: true },
      { label: 'Runs out · 14×', values: { load: 14 }, derived: true },
    ]
    const marks = marksOf(presets, { low: 14.2, high: 20 }, p.load({ max: 100 }), fmt)
    expect(marks.map((m) => [m.text, m.load, m.kind])).toEqual([
      ['1×', 1, 'preset'],
      ['40×', 40, 'preset'],
      ['7.4×', 7, 'target'],
      ['14×', 14, 'full'],
    ])
    // a preset of the page's own keeps its multiple whatever its name; past the range, runs out is at its end
    const own = marksOf<any>(
      [
        { label: 'Peak · Friday', values: { load: 12 }, derived: false },
        { label: 'Runs out · 80×', values: { load: 50 }, derived: true },
      ],
      { low: 80, high: 90 },
      p.load({ max: 50 }),
      fmt,
    )
    expect(own.map((m) => [m.text, m.kind])).toEqual([
      ['12×', 'preset'],
      ['80×', 'full'],
    ])
  })

  it('colours the track by what the load does, a ± range as a blend', () => {
    const { at } = loadScale(p.load({ max: 100 }))
    expect(zones({ low: 10, high: 10 }, { low: 10 ** 1.5, high: 100 }, at)).toBe(
      'linear-gradient(to right, var(--lm-ok) 0, var(--lm-ok) 50.00%, var(--lm-warn) 50.00%, var(--lm-warn) 75.00%, var(--lm-drop) 100.00%)',
    )
    // nothing reaches the target: all of it is under
    expect(zones(null, null, at)).toBe('linear-gradient(to right, var(--lm-ok) 0)')
    expect(zones(null, { low: 10, high: 10 }, at)).toBe(
      'linear-gradient(to right, var(--lm-ok) 0, var(--lm-ok) 50.00%, var(--lm-drop) 50.00%)',
    )
  })

  it('keeps the crossings labelled first; a label with no room keeps its tick', () => {
    const { at } = loadScale(p.load({ max: 100 }))
    const mark = (load: number, kind: 'target' | 'full' | 'preset') => ({
      preset: { label: '', values: { load }, derived: kind !== 'preset' },
      load,
      text: `${load}×`,
      kind,
    })
    const marks = [mark(1, 'preset'), mark(7, 'target'), mark(8, 'preset'), mark(14, 'full')]
    expect(labelled(marks, at, 600)).toEqual([true, true, false, true])
    // a narrower track: the runs-out label no longer fits beside the target's
    expect(labelled(marks, at, 120)).toEqual([true, true, false, false])
  })
})
