/** The messages between the extension and the preview's webview. Nothing here runs: both sides import the types. */

export type ParamValue = number | string | boolean

/** From the extension to the webview. */
export type ToPreview =
  /**
   * The text to draw, its document, and the file name the diagnostics give. Its version, and the edits the preview
   * has not followed yet (null: a whole new text, nothing to follow), while it tracks live changes.
   */
  | { type: 'source'; uri: string; source: string; name: string; version: number; edits: Edit[] | null }
  /** Track live changes: the preview shows what each edit changed. */
  | { type: 'track'; on: boolean }
  /** The box the cursor is in, or none. */
  | { type: 'select'; id: string | null }
  /** Asks what the preview shows; answered with `state`. */
  | { type: 'state?'; request: number }

/** From the webview to the extension: untrusted in the sense that the extension checks every field. */
export type FromPreview =
  | { type: 'ready' }
  /** A box was clicked: show its declaration. */
  | { type: 'reveal'; id: string }
  | ({ type: 'state'; request: number } & Shown)
  /** The edits of a document up to `version` were followed: the boxes they changed were shown. */
  | { type: 'tracked'; uri: string; version: number; boxes: string[] }

/** What the preview shows: the values that differ from the defaults (a share link carries them), the boxes drawn. */
export interface Shown {
  values: Record<string, ParamValue>
  boxes: string[]
  selected: string | null
}

/** Where an edit changed the text, in the offsets of the text sent with it, and the version it made. */
export interface Edit {
  from: number
  to: number
  version: number
}

/** What the webview keeps across a reload of the window. */
export interface PreviewState {
  uri: string
  source: string
  name: string
  values?: Record<string, ParamValue>
}

/** A box id as the language writes one. */
export const ID = /^[A-Za-z_]\w*$/
