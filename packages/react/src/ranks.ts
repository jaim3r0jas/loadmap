import type { ComponentResult, Evaluation, Model } from '@loadmap/core'
import { multiple } from '@loadmap/core/format'

/** What the diagram says on a component's box: the limit, or the next ones in line. */
export interface RankLabel {
  /** 1 for the limit, 2 and 3 for the next. */
  rank: number
  /** "LIMIT · 18×", "2nd · 20×". */
  text: string
  /** The words the detail and the limits list use: "limit", "2nd". */
  word: string
}

/** Badges after the limit: the two next in line. */
const BADGES = 2
const ORDINAL = ['', 'limit', '2nd', '3rd']

/** Where a component reaches the target, on the pessimistic edge the ranking uses. */
export const edge = (c: ComponentResult<string>): number | null => c.targetRange?.low ?? c.target

/**
 * The limit and the next two in line, by component: the multiple at which each reaches the target, the number the
 * headline gives. The next ones only when they reach it within the load's range, so a box far away wears nothing.
 */
export function rankLabels(ev: Evaluation, model: Model): Map<string, RankLabel> {
  const out = new Map<string, RankLabel>()
  const first = ev.firstLimit
  if (!first) return out
  const at = (c: ComponentResult<string>) => multiple(edge(c), model.searchMax)
  out.set(first.id, { rank: 1, text: `LIMIT · ${at(first)}`, word: 'limit' })
  const next = ev.ranked.filter((c) => c !== first && c.util != null).slice(0, BADGES)
  next.forEach((c, i) => {
    const x = edge(c)
    if (x == null || !Number.isFinite(x) || x > model.load.max) return
    const rank = i + 2
    out.set(c.id, { rank, text: `${ORDINAL[rank]} · ${at(c)}`, word: ORDINAL[rank]! })
  })
  return out
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The limit moves from one component to another between these values. */
export const handsOver = (a: Evaluation, b: Evaluation): boolean =>
  !!a.firstLimit && !!b.firstLimit && a.firstLimit.id !== b.firstLimit.id

/**
 * What the story says when a step hands the limit to another component: "API gateway fixed: the worker pool is next,
 * at 10×" when the old limit got further away, else "The push broker overtakes the position consumer: the limit is
 * 18× now". Null when the limit stays.
 */
export function handoverText(a: Evaluation, b: Evaluation, model: Model): string | null {
  const was = a.firstLimit
  const now = b.firstLimit
  if (!was || !now || !handsOver(a, b)) return null
  const at = multiple(edge(now), model.searchMax)
  const before = edge(was)
  const after = b.components[was.id] ? edge(b.components[was.id]!) : null
  const further = before != null && (after == null || after > before)
  return further
    ? `${was.name} fixed: ${now.short} ${now.plural ? 'are' : 'is'} next, at ${at}`
    : `${capital(now.short)} ${now.plural ? 'overtake' : 'overtakes'} ${was.short}: the limit is ${at} now`
}
