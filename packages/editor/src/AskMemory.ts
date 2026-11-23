import type { ChatMessage, ExploreCall, Proposal } from '@loadmap/dsl/assist'
import type { Connected, KeptSettings } from './AskPanel'

/** A turn of the conversation as the panel draws it. */
export interface Turn {
  /** Counts the turns of the conversation: what React keys them by. */
  n: number
  role: 'user' | 'assistant'
  text: string
  /** A line the panel adds, not a message: a proposal applied or discarded. */
  event?: boolean
}

/** One conversation: the whole diagram's, or a box's. What the panel draws, and what the model is sent again. */
export interface Thread {
  turns: Turn[]
  thread: ChatMessage[]
  proposal: Proposal | null
  usage: string
  advice: boolean
  asked: { request: string; box: string | null; model: string }
  ops: string[]
  used?: { input: number; output: number; cached?: number }
  rounds: number
  /** The looks the model asked for, waiting for the reader's press. */
  looks?: ExploreCall[] | null
}

export const freshThread = (): Thread => ({
  turns: [],
  thread: [],
  proposal: null,
  usage: '',
  advice: false,
  asked: { request: '', box: null, model: '' },
  ops: [],
  rounds: 0,
})

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
  /** The conversation drawn now: '' for the whole diagram, else the box it is about. */
  current: string
  /** The other conversations, by the box they are about ('' for the whole diagram). */
  threads: Record<string, Thread>
  /** The scope the conversations are kept for (a repository, the draft); undefined before the page named one. */
  keptScope?: string
  /** The scope whose kept conversations have been read: only then are they written. */
  keptLoaded?: string
  /** What the page keeps for the reader, as last read (null: nothing can be kept now). */
  kept?: KeptSettings | null
  /** "Remember it for my account". */
  remember: boolean
  /** The key the page gave back, for this page: asked of it once. */
  fetched?: { provider: string; key: string; repo?: string; typed?: boolean } | null
  /** The repository the scope and the kept settings were for (undefined: none open). */
  repoId?: string
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
  current: '',
  threads: {},
  remember: true,
})
