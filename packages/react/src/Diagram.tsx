import { type ComponentState, type CrossingRange, reach } from '@loadmap/core'
import { compact, fmt, multiple, multiples, pct } from '@loadmap/core/format'
import type { Scene, SceneEdge, SceneNode, TextSpot } from '@loadmap/layout'
import { memo, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { scenarioColor, useComparison } from './scenarios'
import type { LoadmapController } from './useLoadmap'

const STATE_STROKE: Record<ComponentState, string> = {
  off: 'var(--lm-line)',
  ok: 'var(--lm-ok)',
  warn: 'var(--lm-warn)',
  over: 'var(--lm-drop)',
}

const tokenColor = (c: string) => (['accent', 'alt', 'ok', 'warn', 'drop', 'muted'].includes(c) ? `var(--lm-${c})` : c)

/** The architecture: SVG for the structure, a canvas on top for the dots. Expands to full screen. */
export function Diagram({ lm, legend = true }: { lm: LoadmapController; legend?: boolean }) {
  const { scene, engine, reducedMotion } = lm
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  // the node whose detail shows, and whether a tap pinned it
  const [tip, setTip] = useState<{ id: string; pinned: boolean } | null>(null)
  const detailId = useId()

  // bind after every structural render: the worker fills are new elements
  // bind when the structure is new: the worker fills are new elements
  // biome-ignore lint/correctness/useExhaustiveDependencies: reducedMotion changes the drawn elements
  useEffect(() => {
    if (scene) engine.setScene(scene)
    engine.bind(svgRef.current, canvasRef.current)
    if (lm.root) engine.readColors(lm.root)
  }, [engine, scene, reducedMotion, lm.root])
  // the labels and colours for these values are on screen: export waits for this
  useEffect(() => {
    engine.drawnValues = JSON.stringify(lm.values)
  })

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(board)
    return () => ro.disconnect()
  }, [engine])

  useEffect(() => {
    let raf = 0
    let last = 0
    const frame = (ts: number) => {
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0
      last = ts
      if (!engine.paused && engine.scene) {
        engine.step(dt, { particles: !reducedMotion })
        engine.draw({ particles: !reducedMotion })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, reducedMotion])

  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else wrapRef.current?.requestFullscreen?.().catch(() => {})
  }

  return (
    <div className="lm-wrap" ref={wrapRef}>
      <div className="lm-bar">
        {legend ? <Legend lm={lm} /> : <span />}
        <button type="button" className="lm-btn" onClick={toggle} aria-pressed={full}>
          {full ? '✕ Close' : '⤢ Full screen'}
        </button>
      </div>
      <div
        className="lm-board"
        ref={boardRef}
        style={scene ? { aspectRatio: `${scene.width} / ${scene.height}` } : { minHeight: 240 }}
      >
        {scene && <Structure lm={lm} scene={scene} svgRef={svgRef} rates={reducedMotion} setTip={setTip} />}
        <canvas ref={canvasRef} hidden={reducedMotion} />
      </div>
      {/* outside the board, which clips: a detail taller than the room beside its box still shows whole */}
      {scene && tip && <Detail lm={lm} scene={scene} id={tip.id} board={boardRef.current} detailId={detailId} />}
    </div>
  )
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

/** The component a box stands for: its stages' component, or its own. */
function componentOf(lm: LoadmapController, n: SceneNode): string | undefined {
  return n.stages.map((s) => lm.ev.stages[s]?.component).find(Boolean) ?? n.component ?? undefined
}

type Tip = { id: string; pinned: boolean } | null

/** The SVG. It does not read the detail's state, so a hover re-renders the detail, not every box and edge. */
const Structure = memo(function Structure({
  lm,
  scene,
  svgRef,
  rates,
  setTip,
}: {
  lm: LoadmapController
  scene: Scene
  svgRef: React.RefObject<SVGSVGElement | null>
  rates: boolean
  setTip: (t: Tip | ((t: Tip) => Tip)) => void
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
    if (!c) return {}
    const title = labels.nodes[n.id]?.title
    return {
      tabIndex: 0,
      role: 'button',
      className: 'lm-node',
      'aria-label': `${title && title !== c.name ? `${title}, ` : ''}${c.name}: ${c.util == null ? 'switched off' : pct(c.util)}`,
      onPointerEnter: (e: React.PointerEvent) =>
        e.pointerType === 'mouse' && setTip((t) => (t?.pinned ? t : { id: n.id, pinned: false })),
      onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setTip((t) => (t?.pinned ? t : null)),
      onFocus: () => setTip((t) => (t?.pinned ? t : { id: n.id, pinned: false })),
      onBlur: () => setTip((t) => (t?.pinned ? t : null)),
      onClick: () => setTip((t) => (t?.pinned && t.id === n.id ? null : { id: n.id, pinned: true })),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') setTip(null)
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setTip((t) => (t?.pinned && t.id === n.id ? null : { id: n.id, pinned: true }))
        }
      },
    }
  }
  const summary = scene.nodes.map((n) => labels.nodes[n.id]?.title).join(', ')
  // a group, not an image: an image's children are hidden from screen readers, and the boxes are buttons
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
          handlers={handlers(n)}
        />
      ))}
    </svg>
  )
})

const pathOf = (pts: readonly [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')

function Edge({ e, text, marker }: { e: SceneEdge; text?: string; marker: string }) {
  return (
    <g>
      <path
        d={pathOf(e.points)}
        fill="none"
        stroke="var(--lm-muted)"
        strokeOpacity=".7"
        markerEnd={`url(#${marker})`}
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
    const seq = [scene.flowFrom[f], ...(ev.routes[f] ?? []).map((s) => scene.stageNode[s])].filter(
      (n, i, a) => n && n !== a[i - 1],
    )
    const rate = ev.flows[f] ?? 0
    const legs: [string | undefined, string | undefined, number][] = seq.slice(1).map((to, i) => [seq[i], to, rate])
    // a fan-out's branches carry the rate times their share
    const last = (ev.routes[f] ?? []).at(-1)
    const st = last ? ev.stages[last] : undefined
    if (st?.kind === 'fanout')
      for (const b of st.to[f] ?? []) legs.push([scene.stageNode[last!], scene.stageNode[b.stage], rate * b.share])
    for (const [from, to, r] of legs) {
      const e = scene.edges.find((x) => x.from === from && x.to === to)
      if (e)
        out.push(
          <path
            key={`${f}:${e.id}`}
            d={pathOf(e.points)}
            fill="none"
            stroke={tokenColor(flows[f]!.color)}
            strokeOpacity=".45"
            strokeWidth={1.5 + (6 * Math.min(r, max)) / max}
          />,
        )
    }
  }
  return <g>{out}</g>
}

function Txt({
  s,
  children,
  anchor = 'middle',
  fill = 'currentColor',
}: {
  s: TextSpot
  children?: ReactNode
  anchor?: 'start' | 'middle'
  fill?: string
}) {
  return (
    <text x={s.x} y={s.y} fontSize={s.size} fontWeight={s.weight} textAnchor={anchor} fill={fill}>
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
  handlers,
}: {
  n: SceneNode
  state: ComponentState | null
  title?: string
  sub?: string
  lm: LoadmapController
  handlers: React.SVGProps<SVGGElement>
}) {
  const stroke = state ? STATE_STROKE[state] : 'var(--lm-line)'
  const flows = lm.view.def.flows as Record<string, { color: string }>
  const e = 6
  return (
    <g style={{ color: 'var(--lm-fg)' }} data-node={n.id} {...handlers}>
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
      {n.members.map((m) => (
        <g key={m.label}>
          <rect x={m.x} y={m.y} width={m.w} height={m.h} rx="4" fill="none" stroke="var(--lm-line)" />
          <Txt s={m.spot} anchor="start" fill="var(--lm-muted)">
            {m.label}
          </Txt>
        </g>
      ))}
      {n.groups.map((g) => (
        <Txt
          key={`${g.flow}@${g.spot.x},${g.spot.y}`}
          s={g.spot}
          anchor="start"
          fill={tokenColor(flows[g.flow]?.color ?? 'muted')}
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
          fill="var(--lm-lane)"
          stroke={tokenColor(flows[c.flow]?.color ?? 'muted')}
          strokeOpacity=".6"
        />
      ))}
      {n.slots.map((s) => (
        <g key={s.index}>
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx="2"
            fill="var(--lm-surface)"
            stroke="currentColor"
            strokeOpacity=".45"
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
    </g>
  )
}

/**
 * A box's component in words, over the board: utilization, demand against capacity and where it came from, where it
 * reaches the target and 100 % (with dates, given growth), and its target in each scenario. HTML, so exports leave it out.
 */
function Detail({
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
  const cid = n && componentOf(lm, n)
  const comparison = useComparison(lm)
  const rows = model.scenarios.length > 1 ? comparison.rows : []
  // the box this describes: set on its element, so the SVG need not render again for it
  useEffect(() => {
    const el = board?.querySelector(`[data-node="${CSS.escape(id)}"]`)
    el?.setAttribute('aria-describedby', detailId)
    return () => el?.removeAttribute('aria-describedby')
  }, [board, id, detailId])
  const c = cid ? ev.components[cid] : undefined
  if (!n || !c || !board) return null
  // placed in the wrap, beside the board: below a box in the upper half, above one in the lower half
  const k = board.clientWidth / scene.width
  const below = n.y + n.h / 2 < scene.height / 2
  const top = board.offsetTop + (below ? (n.y + n.h) * k + 6 : n.y * k - 6)
  const place = { top, transform: below ? undefined : 'translateY(-100%)' }
  const at = (r: CrossingRange | null, x: number | null) =>
    r ? reach(r, model.searchMax, model.dateAt) : multiple(x, model.searchMax)
  const num = (x: number) => (Math.abs(x) >= 1000 ? compact(x) : fmt(x))
  const cap = c.capacity
  return (
    <div
      id={detailId}
      className="lm-tip lm-detail"
      role="tooltip"
      style={{ ...place, left: `clamp(0px, ${board.offsetLeft + n.x * k}px, calc(100% - 17rem))` }}
    >
      <b>
        {c.name}
        {c === ev.firstLimit && (
          <span className="lm-tag" data-kind="first">
            first limit
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
