import type { Engine } from './engine'

/** The share of the window's height a board on a page counts as its room: the diagram and its controls in one view. */
const INLINE_HEIGHT = 0.7

/**
 * Tells the engine the room of a board, now and as it changes, until the function it returns is called.
 *
 * A board on a page (`under` null) takes its height from the diagram, so its room is its width by most of the
 * window's height. The height is read again only when the width changes: a phone's address bar sliding away resizes
 * the window, and must not turn the diagram under a scroll.
 *
 * A board that fills the screen or its frame has what the rows around its wrap leave (`under()`), told again only for
 * a new size of the root or another mode, not when a row grows: a story step with a longer text must not move every
 * box. On a small screen it has none: there the board is as wide as the screen whatever its height and pans in a box
 * of its own, so the diagram runs as its shape says, in one row.
 */
export function watchRoom(
  engine: Engine,
  wrap: HTMLElement,
  root: HTMLElement | null,
  under: (() => number) | null,
): () => void {
  const view = wrap.ownerDocument.defaultView
  let page = { w: 0, h: 0 }
  let at = ''
  const tell = () => {
    const w = wrap.clientWidth
    if (under && root) {
      const key = `${root.clientWidth} ${root.clientHeight} ${root.dataset.mode}`
      if (key === at) return
      at = key
      const h = under()
      engine.setRoom(!view?.matchMedia('(max-width: 760px)').matches && w > 0 && h > 0 ? { w, h } : null)
    } else {
      if (Math.abs(w - page.w) >= 1) page = { w, h: INLINE_HEIGHT * (view?.innerHeight ?? 0) }
      if (page.w > 0 && page.h > 0) engine.setRoom(page)
    }
    // told, or none to tell: the layout waits no longer
    engine.expectRoom(false)
  }
  const ro = new ResizeObserver(tell)
  ro.observe(under && root ? root : wrap)
  const mo = new MutationObserver(tell)
  if (under && root) mo.observe(root, { attributeFilter: ['data-mode'] })
  tell()
  return () => {
    ro.disconnect()
    mo.disconnect()
  }
}
