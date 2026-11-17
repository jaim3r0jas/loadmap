import type { ComponentState, Evaluation } from '@loadmap/core'
import type { Scene, SceneNode, SceneSubsystem } from '@loadmap/layout'
import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { LoadmapController } from './useLoadmap'

// Nothing here is imported from the board but types: a page loads this file with the first diagram that has a
// subsystem, and a chunk that reached back into the board's would split that one for every page.

/** Enter or Space presses what a click does. */
const pressed = (press: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    press()
  }
}

const past = (states: (ComponentState | null)[]) =>
  states.includes('over') ? 'over' : states.includes('warn') ? 'warn' : undefined

/**
 * The subsystems' frames behind the boxes and edges: a tint that lets a lane show through and deepens where a frame
 * stands in another, its name at its top (up its left side running down, as a tier's), and its line in the colour of
 * the worst box inside once one is past its target. The name is a button that closes the subsystem into one box; on
 * a board that zooms, the frame is one that flies in to it, and the path to where the view is shows over the board.
 * Paint goes in attributes, as a tier's does: export resolves the tokens in them.
 */
export function Frames({
  scene,
  stateOf,
  lm,
}: {
  scene: Scene
  stateOf: (n: SceneNode) => ComponentState | null
  lm: LoadmapController
}) {
  const [board, setBoard] = useState<Element | null>(null)
  const viewer = lm.engine.viewer
  const frames = scene.subsystems.map((s, i) => {
    const state = past(scene.nodes.filter((n) => s.nodes.includes(n.id)).map(stateOf))
    const { x, y, size, weight } = s.title
    const close = () => lm.setClosed([...lm.closed, s.id])
    const enter = () => lm.engine.viewer?.enter(s)
    return (
      <g
        key={s.id}
        ref={i ? undefined : (g) => setBoard(g?.ownerSVGElement?.parentElement ?? null)}
        data-subsystem-id={s.id}
        data-state={state}
        opacity={s.fade}
      >
        <rect
          {...(viewer && {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${s.label}: fly in to it`,
            onClick: enter,
            onKeyDown: pressed(enter),
          })}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={10}
          fill="var(--lm-muted)"
          fillOpacity={0.07}
          stroke={state ? `var(--lm-${state === 'over' ? 'drop' : 'warn'})` : 'var(--lm-line)'}
          strokeWidth={state ? 1.5 : 1}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: an SVG text cannot be a <button> */}
        <text
          role="button"
          tabIndex={0}
          aria-label={`${s.label}: open. Close it into one box`}
          aria-expanded
          onClick={close}
          onKeyDown={pressed(close)}
          x={x}
          y={y}
          fontSize={size}
          fontWeight={weight}
          fill="var(--lm-muted)"
          textAnchor={s.vertical ? 'end' : undefined}
          transform={s.vertical ? `rotate(-90 ${x} ${y})` : undefined}
        >
          {`${OPEN} ${s.label}`}
        </text>
      </g>
    )
  })
  return (
    <>
      {frames}
      {board && viewer && createPortal(<Crumbs lm={lm} scene={scene} />, board)}
    </>
  )
}

const CRUMBS_CSS = `
.lm-crumbs { position: absolute; left: 8px; top: 8px; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; max-width: calc(100% - 16px); padding: 3px 6px; font-size: 12px; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; box-shadow: 0 2px 10px rgb(0 0 0 / .12); cursor: auto; }
.lm-crumbs button { font: inherit; color: var(--lm-accent); background: none; border: 0; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
.lm-crumbs button:hover { text-decoration: underline; }
.lm-crumbs [aria-current] { padding: 2px 4px; font-weight: 600; color: var(--lm-fg); }
.lm-crumbs span[aria-hidden] { color: var(--lm-muted); }
@media (pointer: coarse) { .lm-crumbs button { min-height: 44px; } }
`

/**
 * Where the view is, as the path down the subsystems to it: the whole diagram, then each frame around the middle of
 * what the board shows, while the board shows only a part. Each step back is a button that flies out to it. It follows
 * the view however it moved: a click on a frame, the reader's own drag, a story's camera.
 */
function Crumbs({ lm, scene }: { lm: LoadmapController; scene: Scene }) {
  const { engine } = lm
  useSyncExternalStore(engine.subscribe, () => engine.viewId)
  const doc = lm.root?.ownerDocument
  if (doc && !doc.getElementById('loadmap-crumbs-css')) {
    const el = doc.createElement('style')
    el.id = 'loadmap-crumbs-css'
    el.textContent = CRUMBS_CSS
    doc.head.appendChild(el)
  }
  const viewer = engine.viewer
  const r = viewer?.box()
  // the whole diagram shows: nothing to say
  if (!viewer || !r || (r.w >= scene.width * 0.95 && r.h >= scene.height * 0.95)) return null
  const [cx, cy] = [r.x + r.w / 2, r.y + r.h / 2]
  const around = (s: SceneSubsystem) => cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h
  const path: SceneSubsystem[] = []
  for (let s = scene.subsystems.findLast(around); s; s = scene.subsystems.find((x) => x.id === s?.in)) path.unshift(s)
  const last = path.at(-1)
  return (
    <nav className="lm-crumbs" aria-label="Where the view is">
      <button type="button" onClick={() => viewer.go(null, true)}>
        Whole diagram
      </button>
      {path.map((s) => (
        <span key={s.id} style={{ display: 'contents' }}>
          <span aria-hidden="true">›</span>
          {s === last ? (
            <span aria-current="location">{s.label}</span>
          ) : (
            <button type="button" onClick={() => viewer.enter(s)}>
              {s.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}

/** What a frame's name starts with, and a closed subsystem's box: the same marks a folder tree uses. */
const OPEN = '\u25BE'

/** The state of the worst component inside a closed subsystem's box: what its outline says. */
export function stateIn(ev: Evaluation, n: SceneNode): ComponentState | null {
  const states = n.stages.map((s) => {
    const c = ev.stages[s]?.component
    return c ? (ev.components[c]?.state ?? null) : null
  })
  return past(states) ?? (states.includes('ok') ? 'ok' : states.includes('off') ? 'off' : null)
}

/** A closed subsystem's box is a button that opens it; one closed inside it stays closed. */
export function opener(lm: LoadmapController, id: string, title = id) {
  const open = () => lm.setClosed(lm.closed.filter((c) => c !== id))
  return {
    tabIndex: 0,
    role: 'button',
    className: 'lm-node',
    'aria-label': `${title}: closed. Open it`,
    'aria-expanded': false,
    onClick: open,
    onKeyDown: pressed(open),
  }
}
