import type { KeyboardEvent } from 'react'
import type { LoadmapController } from './useLoadmap'

/**
 * The model's story, a step at a time: the step's text, where it is, back and next. ← and → move through it while
 * the bar has the keyboard focus (the sliders keep their own arrows).
 */
export function Story({ lm }: { lm: LoadmapController }) {
  const { story } = lm.model
  if (!story.length) return null
  const i = lm.step
  const step = i == null ? null : story[i]
  const last = story.length - 1
  // aria-disabled, not disabled, at either end: a disabled button would drop the keyboard focus, and the arrows with it
  const go = (to: number) => lm.setStep(Math.max(0, Math.min(last, to)))
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(i == null ? 0 : i + 1)
    else if (e.key === 'ArrowLeft' && i != null) go(i - 1)
    else return
    e.preventDefault()
  }
  return (
    <fieldset className="lm-story" onKeyDown={keys}>
      <legend>Story</legend>
      <p aria-live="polite">
        {step ? (
          <>
            <b>
              {i! + 1} of {story.length}
            </b>{' '}
            {step.text}
          </>
        ) : (
          `A walk through this model in ${story.length} steps.`
        )}
      </p>
      <span className="lm-story-nav">
        {i != null && (
          <button type="button" onClick={() => go(i - 1)} aria-disabled={i === 0}>
            Back
          </button>
        )}
        <button type="button" onClick={() => go(i == null ? 0 : i + 1)} aria-disabled={i === last}>
          {i == null ? 'Start' : 'Next'}
        </button>
        {i != null && (
          <button type="button" onClick={() => lm.setStep(null)} aria-label="Leave the story">
            Done
          </button>
        )}
      </span>
    </fieldset>
  )
}
