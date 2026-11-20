import { fmt, multiple, multiples, pct } from '@loadmap/core/format'
import { plusMinus } from './panels'
import { whenRange } from './scenarios'
import type { LoadmapController } from './useLoadmap'

/** Opens what a link of the verdict's line stands for; `from` gets the keyboard back when it closes. */
export type OpenPanel = (panel: 'verdict' | 'assumptions', from: HTMLElement) => void

/**
 * The verdict in one line, from the same evaluation as the sentence: the load, how far the target holds, the first
 * limit and how sure its capacity is, what is past capacity. The sentence is its tooltip and opens under "Why".
 */
export function VerdictLine({
  lm,
  verdict = true,
  extra = 0,
  open,
  why = true,
  assumptions,
}: {
  lm: LoadmapController
  verdict?: boolean
  /** The page's own assumption lines, counted with the model's. */
  extra?: number
  open?: OpenPanel
  /** Shows "Why", which opens the verdict's sentence. */
  why?: boolean
  /** Shows the count of assumptions that opens them. */
  assumptions?: boolean
}) {
  const { ev, model, values } = lm
  const first = ev.firstLimit
  const range = ev.target
  const target = `${pct(model.thresholds.target)} target`
  const c = first?.capacity
  const kind = c?.ref ? 'published' : c?.provenance === 'estimated' ? 'estimated' : 'range'
  const sure = !c
    ? ''
    : kind === 'range'
      ? plusMinus(c)
      : `${kind === 'published' ? 'pub' : 'est'}${c.within ? ` ${plusMinus(c)}` : ''}`
  const over = ev.ranked.filter((x) => (x.util ?? 0) > model.thresholds.full)
  const when = range ? whenRange(model, range) : ''
  const estimated = ev.assumptions.filter((a) => a.kind === 'capacity' && a.capacity.provenance === 'estimated').length
  return (
    <>
      {verdict && (
        <p className="lm-headline" title={ev.verdict.text} aria-live="polite">
          {!first || !range ? (
            ev.verdict.text
          ) : (
            <>
              <b className="lm-num">{fmt(values.load)}×</b> ·{' '}
              {values.load < range.low ? (
                <>
                  the {target} holds to <b className="lm-num">{multiples(range, model.searchMax, true)}</b>
                  {when && ` (${when})`}
                </>
              ) : (
                <>
                  past the {target} from <b className="lm-num">{multiple(range.low, model.searchMax)}</b>
                </>
              )}{' '}
              · limited by <b>{first.name}</b>
              {sure && (
                <span className="lm-tag" data-kind={kind}>
                  {sure}
                </span>
              )}
              {over.length > 0 && (
                <>
                  {' '}
                  · <b>{over.map((x) => x.name).join(', ')}</b> past capacity
                </>
              )}
            </>
          )}
        </p>
      )}
      {open && verdict && why && (
        <button type="button" className="lm-link" onClick={(e) => open('verdict', e.currentTarget)}>
          Why ›
        </button>
      )}
      {open && assumptions && (
        <button type="button" className="lm-link" onClick={(e) => open('assumptions', e.currentTarget)}>
          What this assumes · {ev.assumptions.length + extra}
          {estimated > 0 && ` (${estimated} estimated)`} ›
        </button>
      )}
    </>
  )
}
