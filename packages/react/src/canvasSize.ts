import type { Insets } from './viewpoint'

/**
 * Where a canvas changes its arrangement, by its own size in pixels (never the window's): from `wide` the panel stands
 * beside the diagram behind a rail, narrower it is a sheet over the console (under `compact` the bars tighten too),
 * lower than `short` the bars fold to a row each, and a full screen from `pin` wide keeps the panel open. `rail` and
 * `panel` are the widths of the rail and of the panel beside the diagram, `tabs` the height of the row of tabs over
 * the console, `sheet` the least a sheet stands.
 */
export const CANVAS = {
  compact: 520,
  wide: 900,
  short: 420,
  pin: 1280,
  rail: 44,
  panel: 340,
  tabs: 36,
  sheet: 160,
} as const

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

/**
 * Where the open panel stands: beside the diagram, which keeps its height, or on a compact canvas, too narrow for
 * the two side by side, as a sheet on the console.
 */
export function placement(size: CanvasSize): 'side' | 'sheet' {
  return size.width === 'compact' && !size.pinned ? 'sheet' : 'side'
}

/**
 * Where the panels' tabs are: at the head of a pinned panel, a rail down the edge of a wide canvas, a row over the
 * console of a narrower one, and one menu at the top of a low one, which has no row to give.
 */
export function tabsAt(size: CanvasSize): 'head' | 'rail' | 'row' | 'menu' {
  return size.pinned ? 'head' : size.short ? 'menu' : size.width === 'wide' ? 'rail' : 'row'
}

/** The heights of the bar over the canvas's top and of the console over its bottom, in pixels. */
export interface Bars {
  top: number
  bottom: number
}

/**
 * What a canvas of this size always keeps for itself, a panel open or not: the diagram is arranged for what these
 * leave. Only a new size, a new mode or a bar of another height changes it, so nothing the reader opens lays the
 * diagram out again. A canvas without panels (`panels` false) keeps only its bars.
 */
export function reserved(size: CanvasSize, bars: Bars, panels = true): Insets {
  const tabs = panels ? tabsAt(size) : null
  const right = tabs === 'head' ? CANVAS.panel : tabs === 'rail' ? CANVAS.rail : 0
  return { top: bars.top, right, bottom: bars.bottom + (tabs === 'row' ? CANVAS.tabs : 0), left: 0 }
}

/**
 * How far the open panel reaches over a canvas of `w` by `h` pixels: beside the diagram its width, counted from the
 * canvas's edge (so with the rail it stands behind); as a sheet its height over the console and the tabs, half of
 * what the bars leave or all of it (`whole`).
 */
export function reach(size: CanvasSize, bars: Bars, w: number, h: number, whole = false): number {
  if (size.pinned) return CANVAS.panel
  const keeps = reserved(size, bars)
  if (placement(size) === 'side') return keeps.right + Math.round(Math.min(CANVAS.panel, (w - keeps.right) * 0.6))
  const room = Math.max(0, h - keeps.top - keeps.bottom)
  return whole ? room : Math.min(room, Math.max(CANVAS.sheet, Math.round(room / 2)))
}

/**
 * What covers the canvas now: the reserved part, and the open panel over more of it (`panel` is its extent in pixels;
 * 0 while it is closed). Beside the diagram it stands over the rail, so its width counts from the canvas's edge; as a
 * sheet it stands on the console, which stays in view, so its height adds to it. Fit frames the diagram in the rest.
 */
export function covered(size: CanvasSize, bars: Bars, panel: number, panels = true): Insets {
  const base = reserved(size, bars, panels)
  if (!(panel > 0)) return base
  return placement(size) === 'side'
    ? { ...base, right: Math.max(base.right, panel) }
    : { ...base, bottom: base.bottom + panel }
}
