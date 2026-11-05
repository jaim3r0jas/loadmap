// For loadmap's own packages (the dsl): no promise of stability between versions

const blamed = new WeakMap<object, string>()

/** The flow an error was raised computing: by that flow itself, not by a component or another flow it read. */
export const flowOf = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null ? blamed.get(err) : undefined

export function blame(err: unknown, flow: string) {
  if (typeof err === 'object' && err !== null && !blamed.has(err)) blamed.set(err, flow)
}
