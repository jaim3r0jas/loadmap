import {
  Children,
  type CSSProperties,
  isValidElement,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'
import { hasDesign, LoadRange, Scenarios } from './bar'
import { Canvas, useCanvasPanels, useCanvasSize } from './Canvas'
import { type DiagramProps, Legend } from './Diagram'
import type { Story } from './story'
import type { LoadmapController } from './useLoadmap'
import { VerdictLine } from './verdictLine'

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
 * the scenarios into one control, the title gives way first where the row is short of room, and the legend shows on a
 * wide one. One row always:
 * nothing the reader does changes its height.
 */
export function BarParts({
  lm,
  title,
  legend = true,
  onStory,
}: {
  lm: LoadmapController
  title?: ReactNode | false
  legend?: boolean
  /** Starts the story: the bar has its button only where the canvas shows the story (`over`). */
  onStory?: () => void
}) {
  const size = useCanvasSize()
  const tight = size.width === 'compact' || size.short
  const heading = title === false ? null : (title ?? lm.model.title)
  return (
    <>
      {heading && <h2>{heading}</h2>}
      {tight ? <ScenarioPick lm={lm} /> : <Scenarios lm={lm} />}
      {onStory && lm.model.story.length > 0 && (
        <button type="button" className="lm-btn lm-canvas-play" onClick={onStory}>
          ▶ Story
        </button>
      )}
      {legend && size.width === 'wide' && !size.short && <Legend lm={lm} />}
      {/* a root that fills its frame for good has neither: the page picks what it shows */}
      {!lm.fill && (
        <span className="lm-canvas-tools">
          {lm.fullScreen && (
            <button
              type="button"
              className="lm-btn lm-canvas-chrome"
              aria-pressed={lm.fullScreenMode === 'panels'}
              aria-keyshortcuts="F"
              title="Show the panels (F)"
              onClick={() => lm.setFullScreenMode(lm.fullScreenMode === 'panels' ? 'focus' : 'panels')}
            >
              Panels
            </button>
          )}
          <button
            type="button"
            className="lm-btn lm-canvas-full"
            aria-pressed={lm.fullScreen}
            aria-label={lm.fullScreen ? 'Close full screen' : 'Full screen'}
            title={lm.fullScreen ? 'Close full screen' : 'Full screen'}
            onClick={lm.toggleFullScreen}
          >
            {lm.fullScreen ? '✕' : '⤢'}
          </button>
        </span>
      )}
    </>
  )
}

/**
 * What the console under a canvas holds: the load, and under it the verdict in one line. Where the line has room,
 * "Why" opens the limits and the count of assumptions opens them.
 */
export function ConsoleParts({ lm, extra = 0 }: { lm: LoadmapController; extra?: number }) {
  const size = useCanvasSize()
  const { panels, show, under } = useCanvasPanels()
  // on a wide canvas only: the line keeps its room for the first limit's name
  const links = size.width === 'wide' && !size.short && !under
  return (
    <>
      <LoadRange lm={lm} />
      <div className="lm-canvas-verdict" data-tier={lm.ev.verdict.tier}>
        <VerdictLine
          lm={lm}
          extra={extra}
          open={links ? (p, from) => show(p === 'verdict' ? 'limits' : 'assumptions', from) : undefined}
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
  /** The panel that is open (one of the page's own by its id); null for none. Leave it out and the frame keeps it itself. */
  open?: FramePanel | (string & {}) | null
  /** The panel open at first, when the frame keeps it itself. */
  defaultOpen?: FramePanel | (string & {}) | null
  /** A panel opened or closed (null). */
  onOpen?: (panel: FramePanel | null) => void
  /** The page's own assumption lines, shown with the model's. */
  assumptions?: readonly ReactNode[]
  /** The headroom chart, in its tab. Default true. */
  headroom?: boolean
  /** The scenarios side by side under the headroom chart, when the model has two or more. Default true. */
  compare?: boolean
  /**
   * The page around the frame scrolls: the plain wheel and one finger are the page's. Default: true in a page, false
   * in a root that fills its container (say so for one in a frame of a page that scrolls). Never in full screen.
   */
  scrolls?: boolean
  className?: string
  /** The box's own style: its height, when the page's CSS does not give it. */
  style?: CSSProperties
  /**
   * The page's own: each `Canvas.Panel` a panel whose tab comes before the frame's, anything else drawn over the
   * canvas.
   */
  children?: ReactNode
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
  headroom = true,
  compare = true,
  scrolls,
  className,
  style,
  onNodeClick,
  selected,
  children,
}: FrameProps) {
  // a model with nothing to set but the load has no Design
  // with the least chrome (a full screen's, or a filled frame's, other mode) the diagram, the load and the verdict
  // alone: no tabs, no panel
  const least = lm.fullScreen && lm.fullScreenMode === 'focus'
  const shown = least ? [] : panels.filter((p) => p !== 'controls' || hasDesign(lm))
  // the page's own panels go with the frame's; what it draws over the canvas stays
  const own = least
    ? Children.toArray(children).filter((c) => !(isValidElement(c) && c.type === Canvas.Panel))
    : children
  // the story takes the canvas while a step of it shows or it plays: its text over the bar, the panels away
  // held from its start to Done: stopped before its first step shows (a pause, a value the reader changed), the
  // strip stays, with a way out of its own
  const live = lm.step != null || lm.storyPlaying
  const [told, setTold] = useState(live)
  const [seen, setSeen] = useState(lm.step != null)
  if (live && !told) setTold(true)
  if (told && lm.step != null && !seen) setSeen(true)
  if (told && !live && seen) {
    setTold(false)
    setSeen(false)
  }
  const leave = () => {
    setTold(false)
    setSeen(false)
  }
  // the story's bar comes with the first story shown: a page whose reader never starts it does not load it
  const [StoryBar, setStoryBar] = useState<typeof Story | null>(null)
  useEffect(() => {
    if (!told || StoryBar) return
    let on = true
    import('./story').then((m) => on && setStoryBar(() => m.Story))
    return () => {
      on = false
    }
  }, [told, StoryBar])
  const drawn = told && !!StoryBar
  const box = useRef<HTMLDivElement>(null)
  const was = useRef(told)
  // the story was started from its button, by the keyboard's owner: the focus goes into it once it is drawn, and
  // back to the button when it is gone
  const from = useRef<'button' | 'moved' | null>(null)
  useEffect(() => {
    // the keyboard goes with the story, and only then: from the button that started it into the story, where the
    // arrows step it; and back to that button when the story it was in is gone. Never from the load or a box, nor
    // from the page outside, and never scrolling the page
    const root = box.current
    const doc = root?.ownerDocument
    if (!root || !doc) return
    const play = root.querySelector<HTMLElement>('.lm-canvas-play')
    const at = doc.activeElement
    if (told && !was.current) from.current = at === play ? 'button' : null
    // the button is out of reach under the strip by now: the focus is still on it, or nowhere
    if (drawn && from.current === 'button' && (at === play || at === doc.body)) {
      root.querySelector<HTMLElement>('.lm-canvas-over .lm-story')?.focus({ preventScroll: true })
      from.current = 'moved'
    }
    if (!told && was.current) {
      if (from.current && at === doc.body) play?.focus({ preventScroll: true })
      from.current = null
    }
    was.current = told
  }, [told, drawn])
  return (
    <Canvas
      ref={box}
      lm={lm}
      scrolls={scrolls}
      over={
        told ? (
          <>
            {StoryBar && <StoryBar lm={lm} />}
            {!live && (
              <button type="button" className="lm-btn lm-canvas-leave" aria-label="Leave the story" onClick={leave}>
                Done
              </button>
            )}
            {/* the bar is out of reach under the story: full screen keeps a way out (a phone has no Esc) */}
            {lm.fullScreen && !lm.fill && (
              <button
                type="button"
                className="lm-btn lm-canvas-leave"
                aria-label="Close full screen"
                title="Close full screen"
                onClick={lm.toggleFullScreen}
              >
                ✕
              </button>
            )}
          </>
        ) : undefined
      }
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
        <BarParts lm={lm} title={title} legend={legend} onStory={() => lm.setStoryPlaying(true)} />
      </Canvas.Bar>
      <Canvas.Console>
        <ConsoleParts lm={lm} extra={assumptions?.length} />
      </Canvas.Console>
      {own}
      {shown.map((p) => (
        <Canvas.Panel key={p} id={p} title={TITLES[p]}>
          <Suspense fallback={null}>
            <Body lm={lm} id={p} assumptions={assumptions} headroom={headroom} compare={compare} />
          </Suspense>
        </Canvas.Panel>
      ))}
    </Canvas>
  )
}
