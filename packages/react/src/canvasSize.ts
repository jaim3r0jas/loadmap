import type { Insets } from './viewpoint'

/**
 * Where a canvas changes its arrangement, by its own size in pixels (never the window's): narrower than `compact` the
 * panel is a sheet under a row of tabs, from `wide` it stands beside the diagram behind a rail, lower than `short` the
 * bars fold to a row each, and a full screen from `pin` wide keeps the panel open. `rail` and `panel` are the widths
 * of the rail and of the panel beside the diagram.
 */
export const CANVAS = { compact: 520, wide: 900, short: 420, pin: 1280, rail: 44, panel: 340 } as const

/** A canvas's size class: what its width and height give it room for. */
export interface CanvasSize {
  width: 'compact' | 'regular' | 'wide'
  /** Too low for two rows of bars. */
  short: boolean
  /** Full screen and wide enough: the panel stays open beside the diagram. */
  pinned: boolean
}

export function canvasSize(w: number, h: number, full = false): CanvasSize {
  return {
    width: w < CANVAS.compact ? 'compact' : w < CANVAS.wide ? 'regular' : 'wide',
    short: h < CANVAS.short,
    pinned: full && w >= CANVAS.pin,
  }
}

/** The heights of the bar over the canvas's top and of the console over its bottom, in pixels. */
export interface Bars {
  top: number
  bottom: number
}

/**
 * What a canvas of this size always keeps for itself, a panel open or not: the diagram is arranged for what these
 * leave. Only a new size, a new mode or a bar of another height changes it, so nothing the reader opens lays the
 * diagram out again.
 */
export function reserved(size: CanvasSize, bars: Bars): Insets {
  const right = size.pinned ? CANVAS.panel : size.width === 'wide' ? CANVAS.rail : 0
  return { top: bars.top, right, bottom: bars.bottom, left: 0 }
}

/**
 * What covers the canvas now: the reserved part, and the open panel over more of it (`panel` is its extent in pixels:
 * its width beside the diagram, its height as a sheet; 0 while it is closed). Fit frames the diagram in what is left.
 */
export function covered(size: CanvasSize, bars: Bars, panel: number): Insets {
  const base = reserved(size, bars)
  if (!(panel > 0)) return base
  return size.width === 'wide'
    ? { ...base, right: Math.max(base.right, panel) }
    : { ...base, bottom: Math.max(base.bottom, panel) }
}
