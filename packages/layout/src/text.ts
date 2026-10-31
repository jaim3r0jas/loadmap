/** Width in px of `text` at `size` px. The browser passes a canvas measurer; Node uses the estimate below. */
export type Measure = (text: string, size: number, weight?: number) => number

const NARROW = new Set([...'ijlrtf.,:;|!\'"()[] '])
const WIDE = new Set([...'mwMW@%'])

/** A sans-serif estimate, slightly generous so labels laid out with it never end up narrower than they render. */
export const estimateText: Measure = (text, size, weight = 400) => {
  let em = 0
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32
    else if (WIDE.has(ch)) em += 0.86
    else if (ch >= 'A' && ch <= 'Z') em += 0.68
    else em += 0.57
  }
  return Math.ceil(em * size * (weight >= 600 ? 1.06 : 1))
}
