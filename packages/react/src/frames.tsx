import type { ComponentState, Evaluation } from '@loadmap/core'
import type { Scene, SceneNode } from '@loadmap/layout'
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
 * a board that zooms, the frame is one that flies in to it (the path to where the view is shows with the zoom's
 * buttons, zoom.tsx).
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
  return scene.subsystems.map((s) => {
    const state = past(scene.nodes.filter((n) => s.nodes.includes(n.id)).map(stateOf))
    const { x, y, size, weight } = s.title
    const close = () => lm.setClosed([...lm.closed, s.id])
    // a board hidden at first has no viewer until it shows: the click asks for it then
    const enter = () => lm.engine.viewer?.enter(s, s.id)
    return (
      <g key={s.id} data-subsystem-id={s.id} data-state={state} opacity={s.fade}>
        <rect
          {...(lm.zoom && {
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
