import type { ComponentState } from '@loadmap/core'
import type { Scene, SceneNode } from '@loadmap/layout'

// Nothing here is imported from the board but types: a page loads this file with the first diagram that has a
// subsystem, and a chunk that reached back into the board's would split that one for every page.

/**
 * The subsystems' frames behind the boxes and edges: a tint that lets a lane show through and deepens where a frame
 * stands in another, its name at its top (up its left side running down, as a tier's), and its line in the colour of
 * the worst box inside once one is past its target. Paint goes in attributes, as a tier's does: export resolves the
 * tokens in them.
 */
export function Frames({ scene, stateOf }: { scene: Scene; stateOf: (n: SceneNode) => ComponentState | null }) {
  return scene.subsystems.map((s) => {
    const states = scene.nodes.filter((n) => s.nodes.includes(n.id)).map(stateOf)
    const past = states.includes('over') ? 'over' : states.includes('warn') ? 'warn' : undefined
    const { x, y, size, weight } = s.title
    return (
      <g key={s.id} data-subsystem-id={s.id} data-state={past} opacity={s.fade}>
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={10}
          fill="var(--lm-muted)"
          fillOpacity={0.07}
          stroke={past ? `var(--lm-${past === 'over' ? 'drop' : 'warn'})` : 'var(--lm-line)'}
          strokeWidth={past ? 1.5 : 1}
        />
        <text
          x={x}
          y={y}
          fontSize={size}
          fontWeight={weight}
          fill="var(--lm-muted)"
          textAnchor={s.vertical ? 'end' : undefined}
          transform={s.vertical ? `rotate(-90 ${x} ${y})` : undefined}
        >
          {s.label}
        </text>
      </g>
    )
  })
}
