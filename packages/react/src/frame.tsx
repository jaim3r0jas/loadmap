import type { CSSProperties, ReactNode } from 'react'
import { Canvas, useCanvasSize } from './Canvas'
import { VerdictLine } from './compact'
import { type DiagramProps, Legend } from './Diagram'
import { LoadRange } from './panels'
import { Scenarios } from './scenarios'
import type { LoadmapController } from './useLoadmap'

/**
 * The scenarios as one control: a canvas too narrow or too low for a row of buttons still names the one that is on.
 * A reader who changed a value sees "your own values" until they pick a scenario again.
 */
function ScenarioPick({ lm }: { lm: LoadmapController }) {
  const { model } = lm
  if (!model.scenarios.length) return null
  return (
    <select
      className="lm-canvas-pick"
      aria-label="Scenario"
      value={lm.scenario?.label ?? ''}
      onChange={(e) => e.target.value && lm.setScenario(e.target.value)}
    >
      {!lm.scenario && <option value="">your own values</option>}
      {model.scenarios.map((s) => (
        <option key={s.label} value={s.label}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

/**
 * What the bar over a canvas holds: the title, the scenarios and the flows' legend. A compact or a short canvas folds
 * the scenarios into one control, a short one leaves the title out, and the legend shows on a wide one. One row always:
 * nothing the reader does changes its height.
 */
export function BarParts({
  lm,
  title,
  legend = true,
}: {
  lm: LoadmapController
  title?: ReactNode | false
  legend?: boolean
}) {
  const size = useCanvasSize()
  const tight = size.width === 'compact' || size.short
  const heading = title === false ? null : (title ?? lm.model.title)
  return (
    <>
      {heading && !size.short && <h2>{heading}</h2>}
      {tight ? <ScenarioPick lm={lm} /> : <Scenarios lm={lm} />}
      {legend && size.width === 'wide' && !size.short && <Legend lm={lm} />}
    </>
  )
}

/** What the console under a canvas holds: the load, and under it the verdict in one line. */
export function ConsoleParts({ lm }: { lm: LoadmapController }) {
  return (
    <>
      <LoadRange lm={lm} />
      <div className="lm-canvas-verdict" data-tier={lm.ev.verdict.tier}>
        <VerdictLine lm={lm} />
      </div>
    </>
  )
}

export interface FrameProps extends Pick<DiagramProps, 'onNodeClick' | 'selected'> {
  lm: LoadmapController
  /** Defaults to the model's title; false hides it. */
  title?: ReactNode | false
  /** The flows' legend in the bar. */
  legend?: boolean
  className?: string
  /** The box's own style: its height, when the page's CSS does not give it. */
  style?: CSSProperties
}

/**
 * A loadmap whole in one canvas: the bar over its top, the diagram, and the console with the load and the verdict under
 * it. The three that always show; the panels open from here.
 */
export function Frame({ lm, title, legend = true, className, style, onNodeClick, selected }: FrameProps) {
  return (
    <Canvas lm={lm} legend={false} className={className} style={style} onNodeClick={onNodeClick} selected={selected}>
      <Canvas.Bar>
        <BarParts lm={lm} title={title} legend={legend} />
      </Canvas.Bar>
      <Canvas.Console>
        <ConsoleParts lm={lm} />
      </Canvas.Console>
    </Canvas>
  )
}
