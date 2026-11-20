import { describe, expect, it } from 'vitest'
import { CANVAS, canvasSize, covered, placement, reach, reserved, tabsAt } from '../src/canvasSize'

const bars = { top: 48, bottom: 64 }
const SIZES = [
  [480, 600, false],
  [700, 600, false],
  [1000, 600, false],
  [800, 320, false],
  [360, 300, false],
  [1440, 900, true],
] as const

describe('a canvas reads its size class from its own box', () => {
  it('is compact under 520 px, wide from 900 px, and regular between', () => {
    expect(canvasSize(519, 600).width).toBe('compact')
    expect(canvasSize(520, 600).width).toBe('regular')
    expect(canvasSize(899, 600).width).toBe('regular')
    expect(canvasSize(900, 600).width).toBe('wide')
  })

  it('is short under 420 px of height, whatever its width', () => {
    expect(canvasSize(1200, 419).short).toBe(true)
    expect(canvasSize(1200, 420).short).toBe(false)
    expect(canvasSize(360, 300).short).toBe(true)
  })

  it('pins the panel only in full screen from 1280 px', () => {
    expect(canvasSize(1280, 800).pinned).toBe(false)
    expect(canvasSize(1279, 800, true).pinned).toBe(false)
    expect(canvasSize(1280, 800, true).pinned).toBe(true)
  })
})

describe('where the panels go', () => {
  it('puts the tabs on a rail when wide, in a row over the console when narrower, in a menu when low', () => {
    expect(tabsAt(canvasSize(1000, 600))).toBe('rail')
    expect(tabsAt(canvasSize(700, 600))).toBe('row')
    expect(tabsAt(canvasSize(480, 600))).toBe('row')
    expect(tabsAt(canvasSize(1000, 320))).toBe('menu')
    expect(tabsAt(canvasSize(360, 300))).toBe('menu')
    expect(tabsAt(canvasSize(1440, 900, true))).toBe('head')
  })

  it('stands the open panel beside the diagram, and as a sheet only on a compact canvas', () => {
    expect(placement(canvasSize(1000, 600))).toBe('side')
    expect(placement(canvasSize(700, 600))).toBe('side')
    expect(placement(canvasSize(800, 320))).toBe('side')
    expect(placement(canvasSize(480, 600))).toBe('sheet')
    expect(placement(canvasSize(360, 300))).toBe('sheet')
    expect(placement(canvasSize(1440, 900, true))).toBe('side')
  })
})

describe('the room a canvas keeps for itself', () => {
  it('is the bars, with the rail when wide, the row of tabs when narrower, the whole panel when pinned', () => {
    expect(reserved(canvasSize(480, 600), bars)).toEqual({ top: 48, right: 0, bottom: 64 + CANVAS.tabs, left: 0 })
    expect(reserved(canvasSize(700, 600), bars)).toEqual({ top: 48, right: 0, bottom: 64 + CANVAS.tabs, left: 0 })
    expect(reserved(canvasSize(1000, 600), bars)).toEqual({ top: 48, right: CANVAS.rail, bottom: 64, left: 0 })
    expect(reserved(canvasSize(800, 320), bars)).toEqual({ top: 48, right: 0, bottom: 64, left: 0 })
    expect(reserved(canvasSize(1440, 900, true), bars)).toEqual({ top: 48, right: CANVAS.panel, bottom: 64, left: 0 })
  })

  it('is the bars alone on a canvas without panels', () => {
    for (const [w, h, full] of SIZES)
      expect(reserved(canvasSize(w, h, full), bars, false)).toEqual({ top: 48, right: 0, bottom: 64, left: 0 })
  })

  it('does not change when a panel opens: only what is covered does, on one side', () => {
    for (const [w, h, full] of SIZES) {
      const size = canvasSize(w, h, full)
      const keeps = reserved(size, bars)
      expect(covered(size, bars, 0)).toEqual(keeps)
      for (const whole of [false, true]) {
        const open = covered(size, bars, reach(size, bars, w, h, whole))
        expect(open.top).toBe(keeps.top)
        expect(open.left).toBe(keeps.left)
        expect(open.right).toBeGreaterThanOrEqual(keeps.right)
        expect(open.bottom).toBeGreaterThanOrEqual(keeps.bottom)
        // never past the canvas
        expect(open.left + open.right).toBeLessThanOrEqual(w)
        expect(open.top + open.bottom).toBeLessThanOrEqual(h)
      }
    }
  })

  it('reaches from the edge beside the diagram, the rail with it; a pinned panel is already out of the room', () => {
    expect(reach(canvasSize(1000, 600), bars, 1000, 600)).toBe(CANVAS.rail + CANVAS.panel)
    expect(covered(canvasSize(1000, 600), bars, CANVAS.rail + CANVAS.panel).right).toBe(CANVAS.rail + CANVAS.panel)
    // six tenths of a narrower canvas at most
    expect(reach(canvasSize(520, 600), bars, 520, 600)).toBe(312)
    const pinned = canvasSize(1440, 900, true)
    expect(reach(pinned, bars, 1440, 900)).toBe(CANVAS.panel)
    expect(covered(pinned, bars, CANVAS.panel)).toEqual(reserved(pinned, bars))
  })

  it('stands a sheet on the console and the tabs: half of what the bars leave, or all of it', () => {
    const size = canvasSize(480, 600)
    const room = 600 - 48 - 64 - CANVAS.tabs
    expect(reach(size, bars, 480, 600)).toBe(room / 2)
    expect(reach(size, bars, 480, 600, true)).toBe(room)
    expect(covered(size, bars, room / 2).bottom).toBe(64 + CANVAS.tabs + room / 2)
    // a low one stands whole at once: half of it would show nothing
    expect(reach(canvasSize(360, 300), bars, 360, 300)).toBe(CANVAS.sheet)
  })
})
