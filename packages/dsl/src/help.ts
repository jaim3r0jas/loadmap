// What an editor needs beyond compiling: completion, hover, signature help, quick fixes, definitions, references and
// rename. One entry of its own in the build, so the
// pages that only read a definition never load it.
export { type Completion, type Completions, completions } from './complete'
export type { EditResult, TextChange } from './edit'
export { type QuickFix, quickFixes } from './fixes'
export { type Hover, hover, type SignatureHelp, signatureHelp } from './hover'
export { definition, references, rename } from './references'
