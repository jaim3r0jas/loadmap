import { describe, expect, it } from 'vitest'
import { CANVAS, canvasSize, covered, reserved } from '../src/canvasSize'

const bars = { top: 48, bottom: 64 }

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

describe('the room a canvas keeps for itself', () => {
  it('is the bars, the rail when wide, and the whole panel when pinned', () => {
    expect(reserved(canvasSize(480, 600), bars)).toEqual({ top: 48, right: 0, bottom: 64, left: 0 })
    expect(reserved(canvasSize(700, 600), bars)).toEqual({ top: 48, right: 0, bottom: 64, left: 0 })
    expect(reserved(canvasSize(1000, 600), bars)).toEqual({ top: 48, right: CANVAS.rail, bottom: 64, left: 0 })
    expect(reserved(canvasSize(1440, 900, true), bars)).toEqual({ top: 48, right: CANVAS.panel, bottom: 64, left: 0 })
  })

  it('does not change when a panel opens: only what is covered does', () => {
    for (const [w, h, full] of [
      [480, 600, false],
      [700, 600, false],
      [1000, 600, false],
      [1440, 900, true],
    ] as const) {
      const size = canvasSize(w, h, full)
      expect(covered(size, bars, 0)).toEqual(reserved(size, bars))
      expect(reserved(size, bars)).toEqual(reserved(size, bars))
    }
    // beside the diagram when wide, a sheet from the bottom otherwise
    expect(covered(canvasSize(1000, 600), bars, 340)).toEqual({ top: 48, right: 340, bottom: 64, left: 0 })
    expect(covered(canvasSize(480, 600), bars, 300)).toEqual({ top: 48, right: 0, bottom: 300, left: 0 })
  })

  it('never covers less than it keeps: a pinned panel is already out of the room', () => {
    const size = canvasSize(1440, 900, true)
    expect(covered(size, bars, 300).right).toBe(CANVAS.panel)
    expect(covered(canvasSize(480, 600), bars, 40).bottom).toBe(64)
  })
})
