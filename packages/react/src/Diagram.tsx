import type { ComponentState } from '@loadmap/core'
import type { Scene, SceneEdge, SceneNode, TextSpot } from '@loadmap/layout'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
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
        {scene && <Structure lm={lm} scene={scene} svgRef={svgRef} rates={reducedMotion} />}
        <canvas ref={canvasRef} hidden={reducedMotion} />
      </div>
    </div>
  )
}

function Legend({ lm }: { lm: LoadmapController }) {
  const flows = lm.view.def.flows as Record<string, { color: string; label?: string }>
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
      <span>
        {lm.reducedMotion
          ? 'line width: rate'
          : `one dot ≈ ${lm.engine.sim.dotScale.toLocaleString('en-US')} a second · ${lm.engine.sim.speed}× speed`}
      </span>
    </div>
  )
}

function Structure({
  lm,
  scene,
  svgRef,
  rates,
}: {
  lm: LoadmapController
  scene: Scene
  svgRef: React.RefObject<SVGSVGElement | null>
  rates: boolean
}) {
  const marker = useId().replace(/:/g, '')
  const { labels, ev } = lm
  const stateOf = (n: SceneNode): ComponentState | null => {
    const c = n.stage ? ev.stages[n.stage]?.component : n.component
    return c ? (ev.components[c]?.state ?? null) : null
  }
  const summary = scene.nodes.map((n) => labels.nodes[n.id]?.title).join(', ')
  return (
    <svg ref={svgRef} viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={`Diagram: ${summary}`}>
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
        />
      ))}
    </svg>
  )
}

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
    seq.slice(1).forEach((to, i) => {
      const e = scene.edges.find((x) => x.from === seq[i] && x.to === to)
      if (e)
        out.push(
          <path
            key={`${f}:${e.id}`}
            d={pathOf(e.points)}
            fill="none"
            stroke={tokenColor(flows[f]!.color)}
            strokeOpacity=".45"
            strokeWidth={1.5 + (6 * (ev.flows[f] ?? 0)) / max}
          />,
        )
    })
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
}: {
  n: SceneNode
  state: ComponentState | null
  title?: string
  sub?: string
  lm: LoadmapController
}) {
  const stroke = state ? STATE_STROKE[state] : 'var(--lm-line)'
  const flows = lm.view.def.flows as Record<string, { color: string }>
  const e = 6
  return (
    <g style={{ color: 'var(--lm-fg)' }} data-node={n.id}>
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
          key={`${c.flow}${c.index}`}
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
            data-stage={n.stage}
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
