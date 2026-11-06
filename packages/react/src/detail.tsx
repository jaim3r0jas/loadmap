import { type CrossingRange, reach } from '@loadmap/core'
import { compact, fmt, multiple, multiples, pct } from '@loadmap/core/format'
import type { Scene, SceneNode } from '@loadmap/layout'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { boxComponent } from './camera'
import { rankLabels } from './ranks'
import { scenarioColor, useComparison } from './scenarios'
import type { LoadmapController } from './useLoadmap'

/**
 * A box's component in words, over the board: utilization, demand against capacity and where it came from, where it
 * reaches the target and 100 % (with dates, given growth), and its target in each scenario. HTML, so exports leave it out.
 */
export function Detail({
  lm,
  scene,
  id,
  board,
  detailId,
}: {
  lm: LoadmapController
  scene: Scene
  id: string
  board: HTMLDivElement | null
  detailId: string
}) {
  const { model, ev } = lm
  const n = scene.nodes.find((x) => x.id === id)
  const cid = n && boxComponent(lm.ev, n)
  const comparison = useComparison(lm)
  const rows = model.scenarios.length > 1 ? comparison.rows : []
  // the box this describes: set on its element, so the SVG need not render again for it
  useEffect(() => {
    const el = board?.querySelector(`[data-node="${CSS.escape(id)}"]`)
    el?.setAttribute('aria-describedby', detailId)
    return () => el?.removeAttribute('aria-describedby')
  }, [board, id, detailId])
  const c = cid ? ev.components[cid] : undefined
  const tip = useRef<HTMLDivElement>(null)
  // placed in the wrap, beside the board: below a box in the upper half, above one in the lower half, unless that side
  // lacks the room that is visible (a board that pans in its own box, full screen, the window); as a last resort over it
  const box = n && `${n.x} ${n.y} ${n.w} ${n.h}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: `box` stands for the node's geometry
  useLayoutEffect(() => {
    const el = tip.current
    const wrap = el?.offsetParent
    if (!el || !n || !board || !(wrap instanceof HTMLElement)) return
    const place = () => {
      // where the board draws the scene: its own width, or what the reader's view shows of it
      const p = lm.engine.viewer?.placement()
      const k = p ? p.k : board.clientWidth / scene.width
      const [dx, dy] = p ? [p.dx, p.dy] : [0, 0]
      const w = wrap.getBoundingClientRect()
      // the wrap's coordinates of a viewport y: its children scroll with it
      const y = (v: number) => v - w.top - wrap.clientTop + wrap.scrollTop
      let lo = 0
      let hi = innerHeight
      for (let a: Element | null = wrap; a; a = a.parentElement) {
        if (getComputedStyle(a).overflowY === 'visible') continue
        const r = a.getBoundingClientRect()
        lo = Math.max(lo, r.top)
        hi = Math.min(hi, r.bottom)
      }
      const [top, bottom] = [y(lo) + 4, y(hi) - 4]
      const h = el.offsetHeight
      const boxTop = board.offsetTop + dy + n.y * k
      const boxBottom = board.offsetTop + dy + (n.y + n.h) * k
      const below = boxBottom + 6
      const above = boxTop - 6 - h
      const sides = n.y + n.h / 2 < scene.height / 2 ? [below, above] : [above, below]
      const fits = sides.find((t) => t >= top && t + h <= bottom)
      const roomier = bottom - boxBottom >= boxTop - top ? below : above
      el.style.top = `${Math.max(top, Math.min(fits ?? roomier, bottom - h))}px`
      el.style.left = `${Math.max(0, Math.min(board.offsetLeft + dx + n.x * k, wrap.clientWidth - el.offsetWidth))}px`
    }
    place()
    // a box the reader pans or zooms takes its detail along
    const off = lm.engine.viewer ? lm.engine.subscribe(place) : null
    // the room changes as the page or the board's own box scrolls, the screen turns, or the text grows
    const ro = new ResizeObserver(place)
    ro.observe(el)
    ro.observe(board)
    document.addEventListener('scroll', place, { capture: true, passive: true })
    addEventListener('resize', place)
    return () => {
      off?.()
      ro.disconnect()
      document.removeEventListener('scroll', place, { capture: true })
      removeEventListener('resize', place)
    }
  }, [box, board, scene])
  if (!n || !c || !board) return null
  const at = (r: CrossingRange | null, x: number | null) =>
    r ? reach(r, model.searchMax, model.dateAt) : multiple(x, model.searchMax)
  const num = (x: number) => (Math.abs(x) >= 1000 ? compact(x) : fmt(x))
  const cap = c.capacity
  const rank = rankLabels(ev, model).get(c.id)
  return (
    <div id={detailId} className="lm-tip lm-detail" role="tooltip" ref={tip}>
      <b>
        {c.name}
        {rank && (
          <span className="lm-tag" data-kind={rank.rank === 1 ? 'first' : 'rank'}>
            {rank.word}
          </span>
        )}
      </b>
      {c.util == null || !cap ? (
        <span>switched off</span>
      ) : (
        <>
          <span>
            <strong>{pct(c.util)}</strong> · {num(c.demand ?? 0)} of {fmt(cap.value)} {cap.unit}
            {cap.within ? ` ±${pct(cap.within)}` : ''}
          </span>
          <span className="lm-sub">
            capacity{' '}
            <span className="lm-prov" data-kind={cap.provenance}>
              {cap.provenance}
            </span>
            {cap.source ? `, ${cap.source}` : ''}
          </span>
          <span>
            {pct(model.thresholds.target)} at {at(c.targetRange, c.target)}
          </span>
          <span>
            {pct(model.thresholds.full)} at {at(c.fullRange, c.full)}
          </span>
          {blocks(lm, n).map((line) => (
            <span key={line}>{line}</span>
          ))}
          {c.over && (
            <span className="lm-sub">
              Past {pct(model.thresholds.full)}: {c.over}.
            </span>
          )}
        </>
      )}
      {rows.length > 0 && (
        <span className="lm-sub">
          {pct(model.thresholds.target)} by scenario:{' '}
          {rows.map((r, i) => {
            const x = r.components.find((y) => y.id === cid)
            return (
              <span key={r.label} className="lm-nowrap">
                {i > 0 && ' · '}
                <b className="lm-key" style={{ background: scenarioColor(model, r.label) }} />
                {r.label} {x?.targetRange == null ? 'off' : multiples(x.targetRange, model.searchMax, true)}
              </span>
            )
          })}
        </span>
      )}
    </div>
  )
}

/** What a box's building blocks do at these values: pods running, cache answers, what a stage turns away. */
function blocks(lm: LoadmapController, n: SceneNode): string[] {
  const out: string[] = []
  for (const id of n.stages) {
    const s = lm.ev.stages[id]
    if (s?.kind === 'workers' && s.autoscale)
      out.push(`${s.running} of ${s.pods} pods running, each held near ${pct(s.autoscale.target)}`)
    if (s?.kind === 'cache') out.push(`${pct(s.hit)} answered here`)
    if ((s?.kind === 'pass' || s?.kind === 'limit' || s?.kind === 'cache') && s.shed > 0)
      out.push(`${pct(s.shed)} of what reaches it turned away`)
  }
  return out
}
