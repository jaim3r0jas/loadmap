import { type CSSProperties, type KeyboardEvent, useRef } from 'react'
import type { LoadmapController } from './useLoadmap'

/**
 * The model's story, a step at a time: the step's text, where it is, play, back and next. ← and → move through it
 * while the bar has the keyboard focus (the sliders keep their own arrows). The text keeps the room of the longest
 * step, so stepping through it never moves what is below.
 */
export function Story({ lm }: { lm: LoadmapController }) {
  const bar = useRef<HTMLFieldSetElement>(null)
  const { story } = lm.model
  if (!story.length) return null
  const i = lm.step
  const last = story.length - 1
  // aria-disabled, not disabled, at either end: a disabled button would drop the keyboard focus, and the arrows with it
  const go = (to: number) => {
    const next = Math.max(0, Math.min(last, to))
    // at either end the button stays clickable but does nothing: showing the step again would undo the reader's values
    if (next !== i) lm.setStep(next)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(i == null ? 0 : i + 1)
    else if (e.key === 'ArrowLeft' && i != null) go(i - 1)
    else return
    e.preventDefault()
  }
  const playing = lm.storyPlaying
  return (
    <fieldset className="lm-story" onKeyDown={keys} ref={bar} tabIndex={-1} data-playing={playing || undefined}>
      <legend>Story</legend>
      {/* every text in one cell, only the shown one visible: the cell is as tall as the longest. A screen reader hears
          the shown one from its own live region, which only a change of text makes speak */}
      <span className="lm-sr" aria-live="polite">
        {i == null
          ? `A walk through this model in ${story.length} steps.`
          : `${i + 1} of ${story.length}. ${story[i]!.text}${lm.stepChanged ? ' You changed the values since.' : ''}`}
      </span>
      <p aria-hidden="true">
        <span data-shown={i == null || undefined}>A walk through this model in {story.length} steps.</span>
        {story.map((st, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the steps are the model's, in its order
          <span key={k} data-shown={k === i || undefined}>
            <b>
              {k + 1} of {story.length}
            </b>{' '}
            {st.text}
            <em data-shown={(k === i && lm.stepChanged) || undefined}> You changed the values since.</em>
          </span>
        ))}
      </p>
      {i != null && (
        <span className="lm-story-progress" aria-hidden="true">
          {story.map((st, k) => (
            <i
              // a new key starts the fill again
              key={k === i ? `${k}-${playing}` : k}
              data-state={k < i ? 'done' : k === i ? 'now' : undefined}
              style={k === i ? ({ '--lm-step': `${st.seconds}s` } as CSSProperties) : undefined}
            />
          ))}
        </span>
      )}
      <span className="lm-story-nav">
        <button type="button" onClick={() => lm.setStoryPlaying(!playing)} aria-pressed={playing}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        {i != null && (
          <button type="button" onClick={() => go(i - 1)} aria-disabled={i === 0}>
            Back
          </button>
        )}
        <button type="button" onClick={() => go(i == null ? 0 : i + 1)} aria-disabled={i === last}>
          {i == null ? 'Start' : 'Next'}
        </button>
        {i != null && lm.stepChanged && (
          <button
            type="button"
            onClick={() => {
              lm.setStep(i)
              // the button goes once the step is back: the bar keeps the focus, and the arrows with it
              bar.current?.focus()
            }}
          >
            Show again
          </button>
        )}
        {i != null && (
          <button type="button" onClick={() => lm.setStep(null)} aria-label="Leave the story">
            Done
          </button>
        )}
      </span>
    </fieldset>
  )
}
