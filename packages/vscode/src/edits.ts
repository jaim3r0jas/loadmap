import { fingerprint } from '@loadmap/dsl/internal'
import type { Edit } from './protocol'

/** A change as `onDidChangeTextDocument` gives it: the offsets of the text before it. */
export interface Change {
  rangeOffset: number
  rangeLength: number
  text: string
}

/**
 * Where the edits the preview has not followed yet changed the text, in its offsets now, each with the version that
 * made it. Only what the user wrote: a change that keeps the tokens (Format re-indenting, a comment) is no edit, and
 * one that replaces the whole text (a revert, the file read again) starts over.
 */
export class Edits {
  private pending: Edit[] = []
  private whole = true
  private key: string

  constructor(private text: string) {
    this.key = fingerprint(text)
  }

  /**
   * Follows `text` from now on, with no edit in it yet: a whole new text (another document), or the one shown, whose
   * next edit is followed from what the preview draws now (tracking just turned on).
   */
  reset(text: string, whole = true) {
    this.text = text
    this.key = fingerprint(text)
    this.pending = []
    this.whole = whole
  }

  /** The changes of one event, applied in their order, and the text and version they made. */
  apply(changes: readonly Change[], text: string, version: number) {
    const was = this.text.length
    this.text = text
    const key = fingerprint(text)
    const tokens = key !== this.key
    this.key = key
    if (changes.some((c) => c.rangeOffset === 0 && c.rangeLength >= was && was > 0)) {
      this.pending = []
      this.whole = true
      return
    }
    for (const c of changes) {
      const end = c.rangeOffset + c.rangeLength
      const map = (p: number, assoc: -1 | 1) =>
        p < c.rangeOffset || (p === c.rangeOffset && (assoc < 0 || end > p))
          ? p
          : p >= end
            ? p + c.text.length - c.rangeLength
            : assoc < 0
              ? c.rangeOffset
              : c.rangeOffset + c.text.length
      this.pending = this.pending.map((e) => ({ ...e, from: map(e.from, -1), to: map(e.to, 1) }))
      if (tokens) this.pending.push({ from: c.rangeOffset, to: c.rangeOffset + c.text.length, version })
    }
  }

  /** What the preview gets with the text: the edits, or null for a whole new text (once). */
  take(): Edit[] | null {
    if (!this.whole) return [...this.pending]
    this.whole = false
    this.pending = []
    return null
  }

  /** The preview showed what changed up to `version`. */
  tracked(version: number) {
    this.pending = this.pending.filter((e) => e.version > version)
  }
}
