/** `loadmap 1.1` is [1, 1]; `loadmap 1` is 1.0. */
export type Version = readonly [major: number, minor: number]

/** The version a `loadmap` line says, read from its text: `1.10` is ten, not `1.1`. Undefined when it is not one. */
export function parseVersion(text: string): Version | undefined {
  const m = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.exec(text)
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined
}

export function versionText(v: Version): string {
  return `${v[0]}.${v[1]}`
}

/** Whether `a` comes before `b`. */
export function before(a: Version, b: Version): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]
}

/**
 * The version a stamp's text says, as the compiler reads it: 0.32 read any spelling of the number 1 (`1.00`, `1e0`),
 * so that is still 1.0. Undefined when it is no version.
 */
export function stampVersion(text: string, value: number): Version | undefined {
  const parsed = parseVersion(text)
  return parsed && parsed[0] >= 1 ? parsed : value === 1 ? [1, 0] : undefined
}
