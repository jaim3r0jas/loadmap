// What an editor needs beyond compiling: completion, hover, signature help. One entry of its own in the build, so the
// pages that only read a definition never load it.
export { type Completion, type Completions, completions } from './complete'
export { type Hover, hover, type SignatureHelp, signatureHelp } from './hover'
