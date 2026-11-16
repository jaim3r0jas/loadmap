const blamed = new WeakMap<object, { flow: string; prop?: string; stage?: string }>()

/** The flow an error was raised computing: by that flow itself, not by a component or another flow it read. */
export const flowOf = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null ? blamed.get(err)?.flow : undefined

/**
 * The property of its flow an error is about (`timeout`, `route`), and the stage there, when the error names one: so
 * a definition can mark that line rather than the flow's.
 */
export const propOf = (err: unknown): { prop: string; stage?: string } | undefined => {
  const b = typeof err === 'object' && err !== null ? blamed.get(err) : undefined
  return b?.prop ? { prop: b.prop, ...(b.stage && { stage: b.stage }) } : undefined
}

export function blame(err: unknown, flow: string, at?: { prop: string; stage?: string }) {
  if (typeof err === 'object' && err !== null && !blamed.has(err)) blamed.set(err, { flow, ...at })
}

/** An error about one property of a flow. */
export function flowError(message: string, flow: string, prop: string, stage?: string): Error {
  const err = new Error(message)
  blame(err, flow, { prop, ...(stage && { stage }) })
  return err
}
