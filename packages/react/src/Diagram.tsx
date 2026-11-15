import type { ComponentState } from '@loadmap/core'
import { multiple, pct } from '@loadmap/core/format'
import type { Scene, SceneEdge, SceneNode, SceneTier, TextSpot } from '@loadmap/layout'
import {
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { boxComponent } from './camera'
import type { Handover } from './engine'
import { edge, rankLabels } from './ranks'
import type { LoadmapController } from './useLoadmap'
import type { Insets } from './viewpoint'

// a box's detail comes with the first one the reader asks for, in the chunk full screen's panels come in
const Detail = lazy(() => import('./later').then((m) => ({ default: m.Detail })))

const STATE_STROKE: Record<ComponentState, string> = {
  off: 'var(--lm-line)',
  ok: 'var(--lm-ok)',
  warn: 'var(--lm-warn)',
  over: 'var(--lm-drop)',
}

const tokenColor = (c: string) => (['accent', 'alt', 'ok', 'warn', 'drop', 'muted'].includes(c) ? `var(--lm-${c})` : c)

/** The architecture: SVG for the structure, a canvas on top for the dots. Expands to full screen. */
export interface DiagramProps {
  lm: LoadmapController
  legend?: boolean
  /** A click (or Enter) on a box, by its id. Every box is a button then, one without a component too. */
  onNodeClick?: (id: string) => void
  /** The box drawn as selected, by its id. */
  selected?: string | null
  /**
   * The board fills its container, which gives it a height, as a canvas the reader pans and zooms (the wheel alone
   * zooms it), with no Full screen button. Insets are the pixels on each side that something of the page floats over:
   * Fit frames the diagram in what they leave, and the legend and the zoom buttons stay clear of them.
   */
  canvas?: boolean | Partial<Insets>
}

export function Diagram({ lm, legend = true, onNodeClick, selected = null, canvas = false }: DiagramProps) {
  const { scene, engine, reducedMotion } = lm
  const zoom = lm.zoom || !!canvas
  const inset = { top: 0, right: 0, bottom: 0, left: 0, ...(typeof canvas === 'object' ? canvas : {}) }
  const insetKey = `${inset.top} ${inset.right} ${inset.bottom} ${inset.left}`
  // read when a box is pressed, so a new function each render does not redraw every box
  const click = useRef(onNodeClick)
  click.current = onNodeClick
  const [onClick] = useState(() => (id: string) => click.current?.(id))
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const full = lm.fullScreen
  // the node whose detail shows, and whether a tap pinned it
  const [tip, setTip] = useState<{ id: string; pinned: boolean } | null>(null)
  const detailId = useId()

  // the engine takes a new scene before the page paints: a new structure starts its move from what was drawn
  useLayoutEffect(() => {
    if (scene) engine.setScene(scene, { cut: reducedMotion })
  }, [engine, scene, reducedMotion])
  // what to draw: the scene, or each frame of the move to it
  const frameId = useSyncExternalStore(engine.subscribe, () => engine.frameId)
  const frame = engine.frame
  // the limit passing to another component: the old one's ring is drawn while it fades
  const hand = useSyncExternalStore(engine.subscribe, () => engine.handover)
  // bind after every structural render, and every frame of a move: the worker fills are new elements, or elsewhere
  // biome-ignore lint/correctness/useExhaustiveDependencies: reducedMotion changes the drawn elements
  useEffect(() => {
    engine.bind(svgRef.current, canvasRef.current)
  }, [engine, frame, reducedMotion])
  // a render draws the whole scene's viewBox and new rings as React made them: the engine takes both back before the
  // page paints
  useLayoutEffect(() => {
    engine.applyCamera()
    engine.drawHalos()
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new structure is drawn with the colours read again
  useEffect(() => {
    if (lm.root) engine.readColors(lm.root)
  }, [engine, scene, lm.root])
  // the labels and colours for these values, and this frame, are on screen: export waits for this
  useEffect(() => {
    engine.drawnValues = JSON.stringify(lm.values)
    engine.drawnFocus = lm.focus
    engine.drawnFrame = frameId
  })

  // the canvas's own size, not the board's: a canvas shown again, or a board that never changes size after its first
  // layout, is measured too. In device pixels where the browser counts them, so a fractional size or place stays sharp
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box: ResizeObserverBoxOptions =
      typeof ResizeObserverEntry !== 'undefined' && 'devicePixelContentBoxSize' in ResizeObserverEntry.prototype
        ? 'device-pixel-content-box'
        : 'content-box'
    const ro = new ResizeObserver(([e]) => {
      // only the canvas the engine draws on: another board on the same engine measures its own
      const px = e?.target === engine.canvas && pixels(e)
      if (px) engine.resize(px)
    })
    // a screen of another density (the window moved, the page zoomed) need not change the size: observed again, the
    // canvas is measured now
    let mq: MediaQueryList | undefined
    const watch = () => {
      mq?.removeEventListener('change', watch)
      ro.disconnect()
      ro.observe(canvas, { box })
      if (typeof matchMedia !== 'function') return
      mq = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
      mq.addEventListener('change', watch)
    }
    watch()
    return () => {
      ro.disconnect()
      mq?.removeEventListener('change', watch)
    }
  }, [engine])

  // the reader's hands on the board, and its size in pixels with what floats over it. The code comes with the first
  // board that zooms; a chunk that cannot load leaves the board as it is, drawn whole, without the hands
  const shape = useRef({ canvas: !!canvas, inset })
  shape.current = { canvas: !!canvas, inset }
  const zoomed = useRef<{ measure(): void; off(): void } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a canvas or not; its insets come through the ref
  useEffect(() => {
    const board = boardRef.current
    if (!zoom || !board) return
    let gone = false
    import('./zoom')
      .then(({ mountZoom }) => {
        if (!gone) zoomed.current = mountZoom(board, engine, () => shape.current)
      })
      .catch(() => {})
    return () => {
      gone = true
      zoomed.current?.off()
      zoomed.current = null
    }
  }, [engine, zoom, !!canvas])
  // new insets (a panel pinned, an editor resized) keep the reader's view: only what Fit frames changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: insetKey stands for the insets
  useEffect(() => zoomed.current?.measure(), [insetKey])

  // a board that pans in its own box (a phone in full screen) keeps what the camera frames in the middle of it
  // and its title at the top of what shows, under the bar
  const follow = () => {
    const wrap = wrapRef.current
    const board = boardRef.current
    const c = engine.camera
    const title = titleRef.current
    // nothing to follow unless the story plays: no reading of the layout on every frame
    if (!c && !engine.cue) return
    if (!wrap || !board || !engine.frame || wrap.scrollHeight <= wrap.clientHeight) {
      title?.style.removeProperty('top')
      title?.style.removeProperty('bottom')
      return
    }
    const k = board.clientHeight / engine.frame.height
    // a board that zooms draws what the camera frames in its own middle
    const y = engine.viewer ? board.clientHeight / 2 : c && (c.y + c.h / 2) * k
    if (c && y != null) wrap.scrollTop = board.offsetTop + y - wrap.clientHeight / 2
    if (title) {
      title.style.top = `${Math.max(0, wrap.scrollTop - board.offsetTop + (barRef.current?.offsetHeight ?? 0))}px`
      // at the top of what shows, not stretched to the bottom a lower third keeps
      title.style.bottom = 'auto'
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow reads only refs and the engine
  useEffect(() => {
    let raf = 0
    let last = 0
    const frame = (ts: number) => {
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0
      last = ts
      if (!engine.paused && engine.scene) {
        engine.step(dt, { particles: !reducedMotion })
        engine.draw({ particles: !reducedMotion })
        follow()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, reducedMotion])

  // back on the page, the keyboard is where it was before: the panel it was in has moved
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !full) buttonRef.current?.focus()
    was.current = full
  }, [full])
  // the board as large as fits under the bar: as wide as the screen, unless that leaves the rows below it less than
  // they need (a flexible row its min-height). The bar keeps its width, or a narrow board would wrap the legend and
  // shrink itself again. Only the screen and the rows around it change it, never the load
  useEffect(() => {
    const wrap = wrapRef.current
    const bar = barRef.current
    const root = lm.root
    if (!full || !scene || !wrap || !bar || !root) return
    const px = (x: string) => Number.parseFloat(x) || 0
    const fit = () => {
      const rs = getComputedStyle(root)
      // the rows around the wrap, each with its gap: not where they are now, which a centred wrap would change
      let around = px(rs.paddingTop) + px(rs.paddingBottom)
      const add = (el: Element) => {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') return
        around += px(rs.rowGap) + (px(cs.flexGrow) > 0 ? px(cs.minHeight) : (el as HTMLElement).offsetHeight)
      }
      for (const el of root.children) if (el !== wrap) add(el)
      // focus centres the rows between two spacers: the second is a row too
      if (getComputedStyle(root, '::after').content !== 'none') around += px(rs.rowGap)
      const h = root.clientHeight - around - bar.offsetHeight - px(getComputedStyle(wrap).rowGap)
      const w = Math.min(wrap.clientWidth, (h * scene.width) / scene.height)
      wrap.style.setProperty('--lm-fit', `${Math.max(0, Math.floor(w))}px`)
    }
    const ro = new ResizeObserver(fit)
    const watch = () => {
      ro.disconnect()
      ro.observe(bar)
      ro.observe(root)
      for (const el of root.children) ro.observe(el)
    }
    watch()
    // a row that comes or goes (the dock, the line, another mode) is watched from then on
    const mo = new MutationObserver(() => {
      watch()
      fit()
    })
    mo.observe(root, { childList: true, attributeFilter: ['data-mode'] })
    return () => {
      ro.disconnect()
      mo.disconnect()
      wrap.style.removeProperty('--lm-fit')
    }
  }, [full, scene, lm.root])
  // F switches between the panels and focus, unless the keyboard is in a field or a panel is open whole
  const { setFullScreenMode, fullScreenMode } = lm
  const modesRef = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    const root = lm.root
    // a root that fills its frame shows what the page picked
    if (!full || !root || lm.fill) return
    const f = (e: KeyboardEvent) => {
      if ((e.key !== 'f' && e.key !== 'F') || e.ctrlKey || e.metaKey || e.altKey) return
      if (typing(e.composedPath()[0] ?? null) || root.querySelector(':scope > [data-drawer]')) return
      e.preventDefault()
      if (e.repeat) return
      const next = fullScreenMode === 'focus' ? 'panels' : 'focus'
      // the keyboard was on a panel the other mode does not show: it waits on the switch
      if (document.activeElement?.closest('.lm-dock, .lm-line'))
        modesRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus()
      setFullScreenMode(next)
    }
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [full, fullScreenMode, setFullScreenMode, lm.root, lm.fill])

  return (
    <div className="lm-wrap" ref={wrapRef} data-canvas={canvas ? '' : undefined}>
      <div className="lm-bar" ref={barRef}>
        {legend ? <Legend lm={lm} /> : <span />}
        <span className="lm-tools">
          {/* a root that fills its frame for good has neither: the page picks what it shows */}
          {full && !lm.fill && (
            <fieldset className="lm-modes" aria-label="Full screen shows (F)" ref={modesRef}>
              {(['panels', 'focus'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  data-mode={m}
                  aria-pressed={fullScreenMode === m}
                  aria-keyshortcuts="F"
                  onClick={() => setFullScreenMode(m)}
                >
                  {m === 'panels' ? 'Panels' : 'Focus'}
                </button>
              ))}
            </fieldset>
          )}
          {!lm.fill && !canvas && (
            <button type="button" className="lm-btn" onClick={lm.toggleFullScreen} aria-pressed={full} ref={buttonRef}>
              {full ? '✕ Close' : '⤢ Full screen'}
            </button>
          )}
        </span>
      </div>
      <div
        className="lm-board"
        ref={boardRef}
        data-zoom={zoom ? '' : undefined}
        // while the structure moves, the board's shape follows the frame drawn in it; a canvas takes its container's
        style={canvas ? undefined : frame ? { aspectRatio: `${frame.width} / ${frame.height}` } : { minHeight: 240 }}
      >
        {frame && (
          <Structure
            lm={lm}
            scene={frame}
            hand={hand}
            svgRef={svgRef}
            rates={reducedMotion}
            setTip={setTip}
            onClick={onNodeClick ? onClick : undefined}
            selected={selected}
          />
        )}
        <canvas ref={canvasRef} hidden={reducedMotion} />
        {/* the story's title over the board, the same size whatever the camera shows; the story bar speaks it */}
        {lm.cue && (
          <div className="lm-title" data-top={lm.cue.top || undefined} aria-hidden="true" ref={titleRef}>
            <b>{lm.cue.title}</b>
            {lm.cue.detail && <span>{lm.cue.detail}</span>}
          </div>
        )}
      </div>
      {/* outside the board, which clips: a detail taller than the room beside its box still shows whole. Placed on the
          frame drawn, which a move to a new structure changes every frame */}
      {frame && tip && !lm.storyPlaying && (
        <Suspense fallback={null}>
          <Detail lm={lm} scene={frame} id={tip.id} board={boardRef.current} detailId={detailId} />
        </Suspense>
      )}
    </div>
  )
}

/**
 * The device pixels an element covers: as the browser counts them, snapped as it draws, unless they disagree with its
 * size × the pixel ratio (an emulated ratio, which Chromium leaves out of them). Nothing for an element not shown.
 */
function pixels(e: ResizeObserverEntry): { width: number; height: number } | null {
  const s = e.contentBoxSize[0]
  if (!s?.inlineSize || !s.blockSize) return null
  const dpr = globalThis.devicePixelRatio || 1
  const width = Math.round(s.inlineSize * dpr)
  const height = Math.round(s.blockSize * dpr)
  const d = e.devicePixelContentBoxSize?.[0]
  return d && Math.abs(d.inlineSize - width) <= 1 && Math.abs(d.blockSize - height) <= 1
    ? { width: d.inlineSize, height: d.blockSize }
    : { width, height }
}

/** The keyboard is in a field that takes letters: the first target of the key, inside a web component too. */
function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  const keys = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color']
  return t instanceof HTMLInputElement && !keys.includes(t.type)
}

function Legend({ lm }: { lm: LoadmapController }) {
  const flows = lm.view.def.flows as Record<string, { color: string; label?: string }>
  const grey =
    Object.values(lm.ev.overload).some((o) => o.merge) || Object.values(lm.ev.stages).some((s) => s.kind === 'fanout')
  return (
    <div className="lm-legend">
      {Object.entries(flows).map(([f, v]) => (
        <span key={f}>
          <i style={{ background: tokenColor(v.color) }} />
          {v.label ?? f}
        </span>
      ))}
      <span>
        <i style={{ background: 'var(--lm-ok)' }} />
        done
      </span>
      <span>
        <i style={{ background: 'var(--lm-drop)' }} />
        dropped or rejected
      </span>
      {grey && (
        <span>
          <i style={{ background: 'var(--lm-muted)' }} />
          superseded or unread
        </span>
      )}
      <span>
        {lm.reducedMotion
          ? 'line width: rate'
          : `one dot ≈ ${lm.engine.sim.dotScale.toLocaleString('en-US')} a second · ${lm.engine.sim.speed}× speed`}
      </span>
    </div>
  )
}

const componentOf = (lm: LoadmapController, n: SceneNode) => boxComponent(lm.ev, n)

type Tip = { id: string; pinned: boolean } | null

/** The SVG. It does not read the detail's state, so a hover re-renders the detail, not every box and edge. */
const Structure = memo(function Structure({
  lm,
  scene,
  hand,
  svgRef,
  rates,
  setTip,
  onClick,
  selected,
}: {
  lm: LoadmapController
  scene: Scene
  hand: Handover | null
  svgRef: React.RefObject<SVGSVGElement | null>
  rates: boolean
  setTip: (t: Tip | ((t: Tip) => Tip)) => void
  onClick?: (id: string) => void
  selected: string | null
}) {
  const marker = useId().replace(/:/g, '')
  const { labels, ev } = lm
  const stateOf = (n: SceneNode): ComponentState | null => {
    const c = componentOf(lm, n)
    return c ? (ev.components[c]?.state ?? null) : null
  }
  // hover and focus show a box's detail; a tap (or Enter) pins it until the next one. A box is a button named by
  // its title, its component and its utilization; the detail describes it while it shows
  const handlers = (n: SceneNode) => {
    const cid = componentOf(lm, n)
    const c = cid ? ev.components[cid] : undefined
    const title = labels.nodes[n.id]?.title
    if (!c) {
      if (!onClick) return {}
      return {
        tabIndex: 0,
        role: 'button',
        className: 'lm-node',
        'aria-label': title ?? n.id,
        'aria-pressed': selected === n.id,
        onClick: () => onClick(n.id),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(n.id)
          }
        },
      }
    }
    const press = () => {
      setTip((t) => (t?.pinned && t.id === n.id ? null : { id: n.id, pinned: true }))
      onClick?.(n.id)
    }
    return {
      tabIndex: 0,
      role: 'button',
      className: 'lm-node',
      'aria-label': `${title && title !== c.name ? `${title}, ` : ''}${c.name}: ${c.missing != null ? 'no published benchmark' : c.util == null ? 'switched off' : pct(c.util)}`,
      ...(onClick ? { 'aria-pressed': selected === n.id } : {}),
      onPointerEnter: (e: React.PointerEvent) =>
        e.pointerType === 'mouse' && setTip((t) => (t?.pinned ? t : { id: n.id, pinned: false })),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setTip((t) => (t?.pinned ? t : null)),
      onFocus: () => setTip((t) => (t?.pinned ? t : { id: n.id, pinned: false })),
      onBlur: () => setTip((t) => (t?.pinned ? t : null)),
      onClick: press,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') setTip(null)
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          press()
        }
      },
    }
  }
  const summary = scene.nodes.map((n) => labels.nodes[n.id]?.title).join(', ')
  // the component that runs out first stands out, the engine making it breathe; the next two in line wear a badge.
  // A component drawn as several boxes is ringed on each but tagged once, and a box that is leaving wears nothing
  const ranks = rankLabels(ev, lm.model)
  const staying = lm.scene && new Set(lm.scene.nodes.map((n) => n.id))
  const boxes = (c: string) => scene.nodes.filter((n) => componentOf(lm, n) === c && (!staying || staying.has(n.id)))
  const first = ev.firstLimit
  const was = hand && hand.from !== first?.id && ev.components[hand.from] ? ev.components[hand.from] : null
  const wasBoxes = was ? boxes(was.id) : []
  // the old limit's badge if it is next in line, else a note of where it is now
  const wasRank = was && ranks.get(was.id)
  const note = was && (wasRank ? wasRank.text : `now ${multiple(edge(was), lm.model.searchMax)}`)
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <svg> cannot be a <fieldset>
    <svg ref={svgRef} viewBox={`0 0 ${scene.width} ${scene.height}`} role="group" aria-label={`Diagram: ${summary}`}>
      <defs>
        <marker
          id={marker}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--lm-muted)" />
        </marker>
      </defs>
      {scene.tiers.map((t, i) => (
        <Tier key={t.id} t={t} i={i} striped={lm.view.def.lanes === 'striped'} />
      ))}
      {rates && <RateStrokes lm={lm} scene={scene} />}
      {scene.edges.map((e) => (
        <Edge key={e.id} e={e} text={labels.edges[e.id]} marker={marker} />
      ))}
      {scene.nodes.map((n) => (
        <Node
          key={n.id}
          n={n}
          state={stateOf(n)}
          title={labels.nodes[n.id]?.title}
          sub={labels.nodes[n.id]?.sub}
          lm={lm}
          focused={!!lm.focus && componentOf(lm, n) === lm.focus}
          selected={selected === n.id}
          handlers={handlers(n)}
        />
      ))}
      {/* over the boxes, a layer of its own: its breathing moves no box, nor what a pointer aims at */}
      {was && wasBoxes.map((n) => <Halo key={`was-${n.id}`} n={n} kind="was" component={was.id} />)}
      {first &&
        boxes(first.id).map((n, i) => (
          <Halo key={n.id} n={n} kind="limit" component={first.id} tag={i ? undefined : ranks.get(first.id)?.text} />
        ))}
      {[...ranks].map(([c, r]) => {
        const n = r.rank > 1 && c !== was?.id ? boxes(c)[0] : undefined
        return n && <Badge key={c} n={n} text={r.text} />
      })}
      {note && wasBoxes[0] && <Badge n={wasBoxes[0]} text={note} was={!wasRank} />}
    </svg>
  )
})

/**
 * A tier's lane behind the boxes: filled in two alternating shades (striped: every other one clear) or its own colours,
 * a divider before all but the first, and its header with the name. Paint goes in attributes, never classes: export
 * resolves the tokens in them and drops the classes. Its own colours go in its style as well, for each theme
 * (`light-dark()`, and without a dark one the light one's hue at the lightness of the theme's dark lanes): a browser
 * that cannot read that drops it and keeps the attribute, the light colour.
 */
function Tier({ t, i, striped }: { t: SceneTier; i: number; striped: boolean }) {
  const h = t.head
  const fill = t.fill ?? (i % 2 ? 'var(--lm-tier)' : striped ? 'transparent' : 'var(--lm-tier-base)')
  const own = (t.fill || t.fillDark) && `light-dark(${fill}, ${t.fillDark ?? `oklch(from ${t.fill} .28 c h)`})`
  const [x2, y2] = t.vertical ? [t.x + t.w, t.y] : [t.x, t.y + t.h]
  const under = t.vertical
    ? { x1: h.x + h.w, y1: h.y, x2: h.x + h.w, y2: h.y + h.h }
    : { x1: h.x, y1: h.y + h.h, x2: h.x + h.w, y2: h.y + h.h }
  return (
    <g className="lm-tier" data-tier-id={t.id} pointerEvents="none">
      {(own || fill !== 'transparent') && (
        <rect data-lane x={t.x} y={t.y} width={t.w} height={t.h} fill={fill} style={own ? { fill: own } : undefined} />
      )}
      <rect x={h.x} y={h.y} width={h.w} height={h.h} fill="var(--lm-tier-head)" />
      <line {...under} stroke="var(--lm-tier-line)" />
      {i > 0 && <line x1={t.x} y1={t.y} x2={x2} y2={y2} stroke="var(--lm-tier-line)" />}
      {t.lines.map(({ text, x, y, size, weight, fade }, k) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: a line is its place in the header
          key={k}
          opacity={fade}
          x={x}
          y={y}
          fontSize={size}
          fontWeight={weight}
          letterSpacing={t.spacing}
          fill="var(--lm-tier-fg)"
          textAnchor={t.vertical ? 'end' : undefined}
          transform={t.vertical ? `rotate(-90 ${x} ${y})` : undefined}
        >
          {text}
        </text>
      ))}
    </g>
  )
}

const pathOf = (pts: readonly [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')

function Edge({ e, text, marker }: { e: SceneEdge; text?: string; marker: string }) {
  // a new edge draws in from its start; its arrow comes once it is whole
  const drawing = e.draw != null && e.draw < 1
  return (
    <g opacity={e.fade}>
      <path
        d={pathOf(e.points)}
        fill="none"
        stroke="var(--lm-muted)"
        strokeOpacity=".7"
        markerEnd={drawing ? undefined : `url(#${marker})`}
        {...(drawing ? { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - e.draw! } : {})}
      />
      {e.label && text && (
        <text
          x={e.label.x + e.label.w / 2}
          y={e.label.y + e.label.h / 2 + 4}
          textAnchor="middle"
          fontSize="11"
          fill="var(--lm-muted)"
        >
          {text}
        </text>
      )}
    </g>
  )
}

/** With reduced motion, each flow is a static stroke along its edges, its width scaled by its rate. */
function RateStrokes({ lm, scene }: { lm: LoadmapController; scene: Scene }) {
  const { ev } = lm
  const flows = lm.view.def.flows as Record<string, { color: string }>
  const max = Math.max(1e-9, ...Object.values(ev.flows as Record<string, number>))
  const out: ReactNode[] = []
  for (const f of Object.keys(flows)) {
    const legs: [string | undefined, string | undefined, number][] = []
    // each way the flow goes carries its share of the rate; ways that share an edge add up on it
    for (const way of ev.paths[f] ?? []) {
      const seq = [scene.flowFrom[f], ...way.stages.map((s) => scene.stageNode[s])].filter(
        (n, i, a) => n && n !== a[i - 1],
      )
      const rate = (ev.flows[f] ?? 0) * way.share
      for (const [i, to] of seq.slice(1).entries()) legs.push([seq[i], to, rate])
      // a fan-out's branches carry the rate times their share
      const last = way.stages.at(-1)
      const st = last ? ev.stages[last] : undefined
      if (st?.kind === 'fanout')
        for (const b of st.to[f] ?? []) legs.push([scene.stageNode[last!], scene.stageNode[b.stage], rate * b.share])
    }
    const on = new Map<string, { points: Scene['edges'][number]['points']; r: number }>()
    for (const [from, to, r] of legs) {
      const e = scene.edges.find((x) => x.from === from && x.to === to)
      if (!e) continue
      const had = on.get(e.id)
      on.set(e.id, { points: e.points, r: (had?.r ?? 0) + r })
    }
    for (const [id, { points, r }] of on)
      out.push(
        <path
          key={`${f}:${id}`}
          d={pathOf(points)}
          fill="none"
          stroke={tokenColor(flows[f]!.color)}
          strokeOpacity=".45"
          strokeWidth={1.5 + (6 * Math.min(r, max)) / max}
        />,
      )
  }
  return <g>{out}</g>
}

function Txt({
  s,
  children,
  anchor = 'middle',
  fill = 'currentColor',
  opacity,
}: {
  s: TextSpot
  children?: ReactNode
  anchor?: 'start' | 'middle'
  fill?: string
  opacity?: number
}) {
  return (
    <text x={s.x} y={s.y} fontSize={s.size} fontWeight={s.weight} textAnchor={anchor} fill={fill} opacity={opacity}>
      {children}
    </text>
  )
}

function Node({
  n,
  state,
  title,
  sub,
  lm,
  focused,
  selected,
  handlers,
}: {
  n: SceneNode
  state: ComponentState | null
  title?: string
  sub?: string
  lm: LoadmapController
  focused: boolean
  selected: boolean
  handlers: React.SVGProps<SVGGElement>
}) {
  const stroke = state ? STATE_STROKE[state] : 'var(--lm-line)'
  const flows = lm.view.def.flows as Record<string, { color: string }>
  // an autoscaled pool draws every pod it may run; the ones it does not run now are dashed and faint
  const st = n.kind === 'pool' ? lm.ev.stages[n.stages[0] ?? ''] : undefined
  const running = st?.kind === 'workers' ? st.running : n.members.length
  // a pod past the pool's size is leaving the drawing: it fades out as it was, running
  const idle = (i: number) => i >= running && i < (st?.kind === 'workers' ? st.pods : n.members.length)
  // behind an exclusive connection, a running worker that reads no partition is dashed too
  const a = st?.kind === 'workers' ? st.assignment : undefined
  const unassigned = (i: number) => a != null && i < a.weights.length && a.weights[i] === 0
  const e = 6
  // a box that comes or goes grows from, or shrinks to, a little smaller than itself
  const grow =
    n.fade == null
      ? undefined
      : `translate(${n.x + n.w / 2} ${n.y + n.h / 2}) scale(${0.92 + 0.08 * n.fade}) translate(${-n.x - n.w / 2} ${-n.y - n.h / 2})`
  return (
    <g
      style={{ color: 'var(--lm-fg)' }}
      opacity={n.fade}
      transform={grow}
      data-node={n.id}
      data-focus={focused || undefined}
      data-selected={selected || undefined}
      {...handlers}
    >
      {n.shape === 'cylinder' ? (
        <>
          <path
            d={`M${n.x} ${n.y + e} A${n.w / 2} ${e} 0 0 1 ${n.x + n.w} ${n.y + e} V${n.y + n.h - e} A${n.w / 2} ${e} 0 0 1 ${n.x} ${n.y + n.h - e} Z`}
            fill="var(--lm-surface)"
            stroke={stroke}
            strokeWidth="1.5"
          />
          <path
            d={`M${n.x} ${n.y + e} A${n.w / 2} ${e} 0 0 0 ${n.x + n.w} ${n.y + e}`}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
          />
        </>
      ) : (
        <rect
          x={n.x}
          y={n.y}
          width={n.w}
          height={n.h}
          rx="6"
          fill="var(--lm-surface)"
          stroke={stroke}
          strokeWidth="1.5"
        />
      )}
      <Txt s={n.title}>{title}</Txt>
      {n.sub && sub && (
        <Txt s={n.sub} fill="var(--lm-muted)">
          {sub}
        </Txt>
      )}
      {n.members.map((m, i) => (
        <g key={m.label} data-idle={idle(i) || undefined} opacity={idle(i) ? 0.45 * (m.fade ?? 1) : m.fade}>
          <rect
            x={m.x}
            y={m.y}
            width={m.w}
            height={m.h}
            rx="4"
            fill="none"
            stroke="var(--lm-line)"
            strokeDasharray={idle(i) ? '3 3' : undefined}
          />
          <Txt s={m.spot} anchor="start" fill="var(--lm-muted)">
            {m.label}
          </Txt>
        </g>
      ))}
      {n.groups.map((g, i) => (
        <Txt
          // biome-ignore lint/suspicious/noArrayIndexKey: the place in the list is the member; a move changes the position every frame
          key={`${g.flow}#${i}`}
          s={g.spot}
          anchor="start"
          fill={tokenColor(flows[g.flow]?.color ?? 'muted')}
          opacity={g.fade}
        >
          {g.text}
        </Txt>
      ))}
      {n.cells.map((c) => (
        <rect
          key={`${c.stage}/${c.flow}/${c.index}`}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          rx="1.5"
          opacity={c.fade}
          fill="var(--lm-lane)"
          stroke={tokenColor(flows[c.flow]?.color ?? 'muted')}
          strokeOpacity=".6"
        />
      ))}
      {n.slots.map((s) => (
        <g key={s.index} opacity={s.fade}>
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx="2"
            fill="var(--lm-surface)"
            stroke="currentColor"
            strokeOpacity={unassigned(s.index) ? '.3' : '.45'}
            strokeDasharray={unassigned(s.index) ? '2 2' : undefined}
            data-unassigned={unassigned(s.index) || undefined}
          />
          <rect
            data-slot={s.index}
            data-stage={n.stages[0]}
            data-y={s.y}
            data-s={s.w}
            x={s.x + 1}
            y={s.y + s.h - 1}
            width={s.w - 2}
            height={0}
            rx="1"
            fill="var(--lm-accent)"
          />
        </g>
      ))}
      {/* last, so the keyboard focus style (on the first child) stays on the box */}
      {selected && (
        <rect
          className="lm-selected"
          x={n.x - 3}
          y={n.y - 3}
          width={n.w + 6}
          height={n.h + 6}
          rx="8"
          fill="none"
          stroke="var(--lm-accent)"
          strokeWidth="2.5"
        />
      )}
      {focused && (
        <rect
          className="lm-focus"
          x={n.x - 5}
          y={n.y - 5}
          width={n.w + 10}
          height={n.h + 10}
          rx="9"
          fill="none"
          stroke="var(--lm-accent)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
      )}
    </g>
  )
}

/** A tag's width in scene units for its text: wide enough for any digit, so the same text keeps its size. */
const tagWidth = (text: string, perChar: number) => Math.ceil(12 + text.length * perChar)

/**
 * A ring around the limit's box with a soft glow and, on one box of it, a "LIMIT · 18×" tag on its top edge. The
 * engine scales the ring and its glow on its own clock (`data-ring`) and fades the whole in and out; it is a layer of
 * its own, so it moves nothing else, and it fades with its box. The tag stays still: text drawn scaled by a fraction
 * is not rasterised the same twice, and a recording must be. `was`: the old limit's ring while it fades, without a tag.
 */
function Halo({ n, kind, component, tag }: { n: SceneNode; kind: 'limit' | 'was'; component: string; tag?: string }) {
  const d = 7
  const box = { x: n.x - d, y: n.y - d, width: n.w + 2 * d, height: n.h + 2 * d, rx: 10 }
  const w = tag ? tagWidth(tag, 5.6) : 0
  const tx = n.x + n.w + d - w - 8
  return (
    <g className="lm-halo" data-halo={kind} data-component={component} data-fade={n.fade ?? 1} pointerEvents="none">
      <g data-ring="" data-cx={n.x + n.w / 2} data-cy={n.y + n.h / 2}>
        <rect {...box} data-glow="" fill="none" stroke="var(--lm-drop)" strokeWidth="10" strokeOpacity=".22" />
        <rect {...box} fill="none" stroke="var(--lm-drop)" strokeWidth="2.5" />
      </g>
      {tag && (
        <g data-tag={tag}>
          <rect x={tx} y={box.y - 7.5} width={w} height="15" rx="3" fill="var(--lm-drop)" />
          <text
            x={tx + w / 2}
            y={box.y + 3.5}
            textAnchor="middle"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing=".06em"
            fill="var(--lm-surface)"
          >
            {tag}
          </text>
        </g>
      )}
    </g>
  )
}

/**
 * A quiet badge on a box's top edge: where the next in line reach the target ("2nd · 20×"), or, while the limit
 * passes on, where the old limit is now. No ring, no breathing. `was`: a note the engine fades in and out.
 */
function Badge({ n, text, was }: { n: SceneNode; text: string; was?: boolean }) {
  const w = tagWidth(text, 4.9)
  const tx = n.x + n.w - w - 6
  return (
    <g className="lm-badge" data-badge={text} data-was={was || undefined} opacity={n.fade} pointerEvents="none">
      <g data-show="">
        <rect x={tx} y={n.y - 7} width={w} height="14" rx="7" fill="var(--lm-surface)" stroke="var(--lm-muted)" />
        <text x={tx + w / 2} y={n.y + 3} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="var(--lm-muted)">
          {text}
        </text>
      </g>
    </g>
  )
}
