import type { ChatMessage, ExploreCall, Proposal } from '@loadmap/dsl/assist'
import type { Connected, KeptSettings } from './AskPanel'

/** A turn of the conversation as the panel draws it. */
export interface Turn {
  /** Counts the turns of the conversation: what React keys them by. */
  n: number
  role: 'user' | 'assistant'
  text: string
}

/**
 * The Ask panel's conversation, held by the studio: the canvas draws only the open panel, so the Ask panel is mounted
 * anew each time its tab opens, and finds the conversation and its proposal where it left them.
 */
export interface AskMemory {
  turns: Turn[]
  note: string
  /** Where a refusal from the page sends the reader, with the note they belong to: any other note drops them. */
  ways?: { note: string; links: readonly { href: string; label: string }[] }
  request: string
  proposal: Proposal | null
  usage: string
  thread: ChatMessage[]
  /** What was asked, about which box, of which model: what an accepted version's trace says. */
  asked: { request: string; box: string | null; model: string }
  ops: string[]
  used?: { input: number; output: number; cached?: number }
  /** The last answer was words only: "Draft this" may follow. */
  advice: boolean
  /** The stores the reader connected, by id; null until they press Connect. */
  stores: Connected | null
  /** The reader said yes to every look this session. */
  allowed: boolean
  /** The looks the model asked for, waiting for the reader's press. */
  looks: ExploreCall[] | null
  /** Rounds of looks since the reader last asked: the model must answer after a few. */
  rounds: number
  /** What the page keeps for the reader, as last read (null: nothing can be kept now). */
  kept?: KeptSettings | null
  /** "Remember it for my account". */
  remember: boolean
  /** The key the page gave back, for this page: asked of it once. */
  fetched?: { provider: string; key: string; repo?: string } | null
  /** Whose setting the panel edits: the reader's default, or the open repository's own. */
  scope?: 'default' | 'repo'
  /** The repository's own setting has a key of its own. */
  ownKey?: boolean
  /** The settings folded to their one line. */
  folded?: boolean
}

export const askMemory = (): AskMemory => ({
  turns: [],
  note: '',
  request: '',
  proposal: null,
  usage: '',
  thread: [],
  asked: { request: '', box: null, model: '' },
  ops: [],
  advice: false,
  stores: null,
  allowed: false,
  looks: null,
  rounds: 0,
  remember: true,
})
