/** The messages between the extension and the preview's webview. Nothing here runs: both sides import the types. */

export type ParamValue = number | string | boolean

/** From the extension to the webview. */
export type ToPreview =
  /** The text to draw, its document, and the file name the diagnostics give. */
  | { type: 'source'; uri: string; source: string; name: string }
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

/** What the preview shows: the values that differ from the defaults (a share link carries them), the boxes drawn. */
export interface Shown {
  values: Record<string, ParamValue>
  boxes: string[]
  selected: string | null
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
