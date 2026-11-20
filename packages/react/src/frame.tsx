import { type CSSProperties, lazy, type ReactNode, Suspense } from 'react'
import { Canvas, useCanvasPanels, useCanvasSize } from './Canvas'
// with the dock in one module until `<Loadmap>` becomes this frame: the line then gets a module of its own, so a
// first load holds it without the dock
import { VerdictLine } from './compact'
import { type DiagramProps, Legend } from './Diagram'
import { hasDesign, LoadRange } from './panels'
import { Scenarios } from './scenarios'
import type { LoadmapController } from './useLoadmap'

// what each panel is made of comes with the first one a reader opens. The parts it shares a module with (the load
// slider's, the scenarios') are in the first load until they are split from it, with the budget, when `<Loadmap>`
// becomes this frame
const Body = lazy(() => import('./framePanels').then((m) => ({ default: m.FramePanelBody })))

/** A frame's panels, in the order of their tabs: one opens at a time. */
export const FRAME_PANELS = ['limits', 'controls', 'headroom', 'live', 'assumptions'] as const
export type FramePanel = (typeof FRAME_PANELS)[number]

/** What each tab says. */
const TITLES: Record<FramePanel, string> = {
  limits: 'Limits',
  controls: 'Design',
  headroom: 'Headroom',
  live: 'Live',
  assumptions: 'Assumes',
}

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

/**
 * What the console under a canvas holds: the load, and under it the verdict in one line. Where the line has room,
 * "Why" opens the limits and the count of assumptions opens them.
 */
export function ConsoleParts({ lm, extra = 0 }: { lm: LoadmapController; extra?: number }) {
  const size = useCanvasSize()
  const { panels, show } = useCanvasPanels()
  // on a wide canvas only: the line keeps its room for the first limit's name
  const links = size.width === 'wide' && !size.short
  return (
    <>
      <LoadRange lm={lm} />
      <div className="lm-canvas-verdict" data-tier={lm.ev.verdict.tier}>
        <VerdictLine
          lm={lm}
          extra={extra}
          open={links ? (p, from) => show(p === 'verdict' ? 'limits' : p, from) : undefined}
          why={panels.includes('limits')}
          assumptions={panels.includes('assumptions')}
        />
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
  /** The panels the frame offers, in the order of their tabs. Default: every one; Design only when the model has one. */
  panels?: readonly FramePanel[]
  /** The panel that is open; null for none. Leave it out and the frame keeps it itself. */
  open?: FramePanel | null
  /** The panel open at first, when the frame keeps it itself. */
  defaultOpen?: FramePanel | null
  /** A panel opened or closed (null). */
  onOpen?: (panel: FramePanel | null) => void
  /** The page's own assumption lines, shown with the model's. */
  assumptions?: readonly ReactNode[]
  className?: string
  /** The box's own style: its height, when the page's CSS does not give it. */
  style?: CSSProperties
}

/**
 * A loadmap whole in one canvas: the bar over its top, the diagram, and the console with the load and the verdict under
 * it. The three that always show; the panels open from here.
 */
export function Frame({
  lm,
  title,
  legend = true,
  panels = FRAME_PANELS,
  open,
  defaultOpen,
  onOpen,
  assumptions,
  className,
  style,
  onNodeClick,
  selected,
}: FrameProps) {
  // a model with nothing to set but the load has no Design
  const shown = panels.filter((p) => p !== 'controls' || hasDesign(lm))
  return (
    <Canvas
      lm={lm}
      legend={false}
      open={open}
      defaultOpen={defaultOpen}
      onOpen={onOpen as (id: string | null) => void}
      className={className ? `lm-frame ${className}` : 'lm-frame'}
      style={style}
      onNodeClick={onNodeClick}
      selected={selected}
    >
      <Canvas.Bar>
        <BarParts lm={lm} title={title} legend={legend} />
      </Canvas.Bar>
      <Canvas.Console>
        <ConsoleParts lm={lm} extra={assumptions?.length} />
      </Canvas.Console>
      {shown.map((p) => (
        <Canvas.Panel key={p} id={p} title={TITLES[p]}>
          <Suspense fallback={null}>
            <Body lm={lm} id={p} assumptions={assumptions} />
          </Suspense>
        </Canvas.Panel>
      ))}
    </Canvas>
  )
}
