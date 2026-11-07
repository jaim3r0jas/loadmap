import type { ButtonHTMLAttributes, KeyboardEvent, PointerEvent, ReactNode, Ref } from 'react'

/** The two side panels of a canvas: the code on the start side, the verdict and the rest on the end. */
export type Side = 'start' | 'end'

/** Pixels a folded panel's rail takes. */
export const RAIL = 44

/**
 * A panel's header: its name and a note beside it, its buttons, and at the outer end the one that folds it onto its
 * rail.
 */
export function PanelHead({
  side,
  title,
  note,
  fold,
  onFold,
  children,
}: {
  side: Side
  title: string
  note?: ReactNode
  /** The fold button's name. */
  fold: string
  onFold: () => void
  children?: ReactNode
}) {
  return (
    <div className="lme-pane-head">
      <h2>{title}</h2>
      {note}
      <span className="lme-grow" />
      {children}
      <button type="button" className="lm-btn lme-quiet lme-icon" aria-label={fold} title={fold} onClick={onFold}>
        {side === 'start' ? '‹' : '›'}
      </button>
    </div>
  )
}

/** A folded panel: a strip along its edge with a dot for its state and its name, written down the strip. */
export function Rail({
  side,
  tier,
  label,
  ref,
  ...rest
}: {
  side: Side
  tier: 'ok' | 'warn' | 'over'
  label: string
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'>) {
  return (
    <button type="button" ref={ref} className="lme-rail" data-side={side} data-tier={tier} {...rest}>
      <i aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

/**
 * The edge between a panel and the canvas: dragged, or moved with the arrows (Shift: further), Home and End; a
 * double-click puts it back. `onChange` has the new width, and `done` once the move is over (a page keeps it then).
 */
export function Resize({
  side,
  label,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  side: Side
  label: string
  value: number
  min: number
  max: number
  onChange: (px: number, done: boolean) => void
  onReset: () => void
}) {
  // the edge moves with the pointer: the start panel grows rightwards, the end panel leftwards
  const sign = side === 'start' ? 1 : -1
  const clamp = (px: number) => Math.round(Math.max(min, Math.min(max, px)))
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const edge = e.currentTarget
    const editor = edge.closest('.lme')
    const from = e.clientX
    let last = value
    edge.setPointerCapture(e.pointerId)
    editor?.setAttribute('data-dragging', '')
    const move = (ev: globalThis.PointerEvent) => {
      last = clamp(value + sign * (ev.clientX - from))
      onChange(last, false)
    }
    const up = () => {
      edge.removeEventListener('pointermove', move)
      edge.removeEventListener('pointerup', up)
      edge.removeEventListener('pointercancel', up)
      editor?.removeAttribute('data-dragging')
      // a click that moved nothing (the focus, a double-click) is no move
      if (last !== value) onChange(last, true)
    }
    edge.addEventListener('pointermove', move)
    edge.addEventListener('pointerup', up)
    edge.addEventListener('pointercancel', up)
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 64 : 16) * sign
    const to =
      e.key === 'ArrowLeft'
        ? value - step
        : e.key === 'ArrowRight'
          ? value + step
          : e.key === 'Home'
            ? min
            : e.key === 'End'
              ? max
              : null
    if (to == null) return
    e.preventDefault()
    onChange(clamp(to), true)
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> takes no focus nor pointer; this separator is moved
    <div
      className="lme-resize"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={nudge}
      onDoubleClick={onReset}
    />
  )
}
