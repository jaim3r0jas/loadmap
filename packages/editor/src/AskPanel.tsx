import type { Snapshot } from '@loadmap/core/measure'
import { compile, type HostFunctions, type MeasureQuery } from '@loadmap/dsl'
import {
  type AssistEvent,
  createAssistant,
  diffLines,
  type ExploreCall,
  explored,
  type ModelProvider,
  PROVIDERS,
  type Proposal,
  type ProviderPreset,
  providerFor,
} from '@loadmap/dsl/assist'
import { LOOKS } from '@loadmap/dsl/internal'
import { type FormEvent, Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AskMemory, Turn } from './AskMemory'
import { applyFiles } from './apply'
import { type Author, subject, type Trace } from './history'
import { forgetKey, readKey, takeKey } from './modelKeys'
import type { FileHost } from './reshape'

/**
 * The Ask panel: a conversation about the diagram with a model the reader picks, with their own key. An answer that
 * changes the files comes as a proposal: what it does, a diff per file, the capacities it wrote, what moves. Accept
 * puts it in the editor (an undo step per file, a version in the history); Reject drops it. Nothing reaches the text
 * before the reader accepts. Loaded the first time its tab opens.
 */

export interface AskPanelProps {
  /** What puts files in the editor: an accepted proposal changes them there. */
  host: FileHost
  /** The files as they are now. */
  files: () => { path: string; files: Readonly<Record<string, string>> }
  /** Keeps the files as a version of the history (nothing without one). */
  keep: (author: Author, message: string, trace?: Trace) => Promise<void>
  /** Draws a proposal in the canvas, or the files again (null). */
  onPreview: (p: Proposal | null, before?: boolean) => void
  /** What the canvas draws: the files (before), the proposal (after), or something else (an older version). */
  shows?: 'before' | 'after' | null
  reference: string | (() => Promise<string>)
  /** The providers offered, by id; every one by default. */
  providers?: readonly string[]
  /** The box selected in the diagram: the question is about it first, unless the reader takes the chip off. */
  selected: string | null
  /** Asked before the first request of a session: the page says what leaves it (a private repository's files). */
  confirmSend?: (provider: { id: string; name: string }) => boolean | Promise<boolean>
  /** A model of the page's own: no provider or key to pick. */
  model?: ModelProvider
  /** Where the conversation is kept while the panel is closed. */
  memory: AskMemory
  /** The reader's metrics, when the page can reach them: the model may ask to look, the diagram drawn with them. */
  data?: EditorData
  /** Draws the files with measured data, or as written (null): resolves to whether it could. */
  onMeasured?: (snapshot: Snapshot | null) => Promise<boolean>
  /** The page's own formula functions: the measures are read from a compile with them. */
  functions?: HostFunctions
  /** Ways to get a key without pasting one, by provider id: OpenRouter's sign-in. */
  signIn?: Readonly<Record<string, () => Promise<string>>>
  /** Where the page remembers the reader's model and key for them. */
  settings?: ModelSettings
}

/**
 * Where a page remembers the reader's choice of model and their keys, for them, so a return finds them set (the docs:
 * the site's service, for a reader connected to GitHub). The panel reads what is kept when it opens, asks for a key
 * only when a question needs it, and keeps a choice when the reader asks with "Remember it" ticked. An error is shown
 * by its message; `links` on it (`{ href, label }[]`, https addresses) follow the message.
 */
export interface ModelSettings {
  /** Who keeps them, in a few words, for the sentence under the box: "this site's service". */
  where: string
  /**
   * The repository open now, when it may have a model and key of its own (the docs: one opened from GitHub): an id that
   * names it for good, and its name to show.
   */
  repository?(): { id: string; name: string } | undefined
  /** What is kept for the reader now (with `repo`, that repository's own too), or null when nothing can be kept now. */
  load(repo?: string): Promise<KeptSettings | null>
  /** The key kept for a provider: with `repo`, that repository's own when it has one for the provider. */
  key(provider: string, repo?: string): Promise<string | undefined>
  /**
   * Keeps a choice of provider and model, and the key when one is given. With `repo`, the repository's own: `ownKey`
   * says it has a key of its own (the one given, or the one it had), else it uses the reader's key for the provider.
   */
  save(choice: { provider: string; model: string; key?: string; repo?: string; ownKey?: boolean }): Promise<void>
  /** Forgets the key kept for a provider, a repository's own choice, or everything kept for the reader. */
  remove(what: { key: string } | { repo: string } | 'all'): Promise<void>
}

/** What a page keeps for the reader: never a key itself, only which providers have one. */
export interface KeptSettings {
  /** The provider and model chosen last. */
  choice?: { provider: string; model: string }
  /** The providers with a key kept. */
  keys: readonly string[]
  /** The repository asked about, when it has its own choice: whether it has a key of its own too. */
  repo?: { provider: string; model: string; ownKey: boolean }
}

/** What the reader's metrics hold, once connected: the stores the model may explore, and those measures read from. */
export interface Connected {
  explore: readonly string[]
  measure: readonly string[]
}

/**
 * The reader's metrics as a page reaches them (the docs: `loadmap bridge` on the reader's own computer). Nothing is
 * asked of it before the reader presses Connect, and every look the model asks for waits for their press (or their
 * yes for the session).
 */
export interface EditorData {
  /** Where the metrics are read, in a few words: "loadmap bridge on this computer". */
  where: string
  /**
   * When the page must give a code to connect (`loadmap bridge` prints one), what to call it: the panel then asks for
   * it beside Connect and passes it on.
   */
  code?: string
  /** What the stores hold, by id: asked when the reader presses Connect. A refusal says why. */
  connect(code?: string): Promise<Connected>
  /** Runs the looks the model asked for, read only: their answers as text a model reads. */
  explore(calls: readonly ExploreCall[]): Promise<string>
  /** Reads the measures over a recent window: the snapshot the diagram is drawn with. */
  pull?(measures: readonly MeasureQuery[]): Promise<Snapshot>
}

export const ASK_CSS = `
.lme-ask { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; font-size: .84rem; min-width: 0; }
.lme-ask > *, .lme-ask-card > *, .lme-ask-thread > * { min-width: 0; max-width: 100%; }
.lme-ask form { display: grid; gap: 6px; }
.lme-ask-model { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.lme-ask-model select, .lme-ask-model input, .lme-ask textarea { min-width: 0; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 4px 7px; }
.lme-ask-key { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lme-ask-key input[type="password"] { flex: 1 1 12rem; }
.lme-ask-key legend, .lme-ask-scope legend { padding: 0; }
.lme-ask-scope { grid-column: 1 / -1; display: flex; gap: 4px; flex-wrap: wrap; }
.lme-ask-scope button[aria-pressed="true"] { background: var(--lm-accent-soft); font-weight: 600; }
.lme-ask-model > .lme-ask-row { grid-column: 1 / -1; }
.lme-ask-line { display: flex; gap: 6px; align-items: center; justify-content: space-between; padding: 4px 8px; border: 1px solid var(--lm-line); border-radius: 6px; overflow-wrap: anywhere; }
.lme-ask-thread { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.lme-ask-msg { padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.lme-ask-msg[data-role="user"] { background: var(--lm-accent-soft); justify-self: end; max-width: 90%; }
.lme-ask-msg[data-role="assistant"] { background: color-mix(in srgb, var(--lm-fg) 5%, transparent); }
.lme-ask-card { border: 1px solid var(--lm-accent); border-radius: 8px; padding: 8px 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; overflow-wrap: anywhere; }
.lme-ask-card ul { margin: 0; padding-left: 1.1em; }
.lme-ask-card pre { margin: 0; max-height: 240px; overflow: auto; font: .74rem/1.45 var(--lm-mono); }
.lme-ask-card .lme-add { background: color-mix(in srgb, var(--lm-ok) 16%, transparent); display: block; }
.lme-ask-card .lme-del { background: color-mix(in srgb, var(--lm-drop) 16%, transparent); display: block; }
.lme-ask-guess { color: var(--lm-warn, var(--lm-accent)); font-weight: 600; }
.lme-ask-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lme-ask-chip { display: inline-flex; gap: 4px; align-items: center; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--lm-line); background: var(--lm-surface); font: inherit; color: inherit; }
.lme-ask-usage { color: var(--lm-muted); font-size: .76rem; }
.lme-ask fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.lme-ask-code { width: 12ch; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 2px 6px; }
.lme-preview [data-node][data-proposed] { filter: drop-shadow(0 0 3px var(--lm-accent)) drop-shadow(0 0 1px var(--lm-accent)); }
.lme-preview [data-node][data-proposed="added"] > :is(:first-child, path:nth-child(2)) { stroke: var(--lm-accent); stroke-dasharray: 5 4; }
.lme-ask textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 56px; }
`

/** Questions about a box, one press each: the model answers in words, and "Draft this" turns advice into a change. */
const QUICK: { label: string; ask: (box: string) => string }[] = [
  { label: 'Explain it', ask: (b) => `Explain ${b}: what it is in this model, what limits it, and at what load.` },
  {
    label: 'What runs through it',
    ask: (b) => `What runs through ${b}: each flow that reaches it, how much, and what it costs it.`,
  },
  {
    label: 'Is a flow missing?',
    ask: (b) => `Is a flow missing at ${b}? Look at what reaches it and at what it does. Change nothing yet.`,
  },
  {
    label: 'Critique it',
    ask: (b) =>
      `Critique how ${b} is modelled: its capacity's source, its demand, what is missing. Change nothing yet.`,
  },
]

const DRAFT = 'Draft the change you suggest, as operations.'

/** The reader's choice of model, kept in this tab: the provider and the model's name, never the key. */
const PICK = 'loadmap-assist-model'

function readPick(list: readonly ProviderPreset[]): { provider: string; model: string } {
  try {
    const p = JSON.parse(sessionStorage.getItem(PICK) ?? 'null')
    if (p && list.some((x) => x.id === p.provider) && typeof p.model === 'string') return p
  } catch {}
  const first = list[0]!
  return { provider: first.id, model: first.model ?? '' }
}

export default function AskPanel(p: AskPanelProps) {
  const id = useId()
  const list = PROVIDERS.filter((x) => !p.providers || p.providers.includes(x.id))
  // whether this tab chose a model already, as the panel opened: the reader's kept choice does not override it
  const [chosenHere] = useState(() => {
    try {
      return sessionStorage.getItem(PICK) != null
    } catch {
      return false
    }
  })
  const [pick, setPick] = useState(() => readPick(list))
  const preset = list.find((x) => x.id === pick.provider) ?? list[0]!
  const stored = readKey(preset.id)
  const [key, setKey] = useState(stored?.key ?? '')
  const [keep, setKeep] = useState(stored?.kept ?? false)
  const m = p.memory
  const [turns, setTurns] = useState<Turn[]>(m.turns)
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(m.note)
  const [ways, setWays] = useState(m.ways)
  const [request, setRequest] = useState(m.request)
  const [scoped, setScoped] = useState(true)
  const [proposal, setProposal] = useState<Proposal | null>(m.proposal)
  const [usage, setUsage] = useState(m.usage)
  /** What the page keeps for the reader (null: nothing can be kept now; undefined: not read yet). */
  const [kept, setKept] = useState<KeptSettings | null | undefined>(m.kept)
  /** "Remember it for my account": ticked until the reader says otherwise. */
  const [remember, setRemember] = useState(m.remember)
  const [signing, setSigning] = useState(false)
  // the provider shown now: a key that comes after a wait goes to the provider it was asked for, never to another
  const shown = useRef(preset.id)
  shown.current = preset.id
  /** A key that came for `forId`: kept for it, and in the field only while it is still the provider shown. */
  const took = (forId: string, k: string) => {
    takeKey(forId, k, keep)
    if (shown.current === forId) setKey(k)
  }
  /** A refusal from the page: its message, and its links (https only) after it. */
  const refused = (err: unknown) => {
    const { message, links } = err as Error & { links?: unknown }
    setNote(message)
    // https alone: a link is the page's own code, but nothing else belongs behind a note
    const safe = (Array.isArray(links) ? links : []).filter(
      (l): l is { href: string; label: string } =>
        typeof l?.href === 'string' && typeof l.label === 'string' && l.href.startsWith('https://'),
    )
    setWays(safe.length ? { note: message, links: safe.map(({ href, label }) => ({ href, label })) } : undefined)
  }
  // what the page keeps, read as the panel opens: the reader's last choice comes back unless this tab chose
  const settings = p.settings
  /** The repository open as the panel opened: it may have a model and key of its own. */
  const [repository] = useState(() => settings?.repository?.())
  /** What is edited and in force: the reader's default, or the open repository's own. */
  const [scope, setScope] = useState<'default' | 'repo'>(m.scope ?? 'default')
  /** In the repository's scope: it has a key of its own, rather than the reader's key for the provider. */
  const [ownKey, setOwnKey] = useState(m.ownKey ?? false)
  /** Folded to its one line: once set, until the reader opens it or changes something. */
  const [folded, setFolded] = useState(m.folded ?? true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once as the panel opens, with what the tab held then
  useEffect(() => {
    if (!settings) return
    let gone = false
    settings.load(repository?.id).then(
      (k) => {
        if (gone) return
        setKept(k)
        // the open repository's own choice wins, unless the reader chose meanwhile
        const r = repository && k?.repo
        if (r && !touched.current && list.some((x) => x.id === r.provider)) {
          setScope('repo')
          setOwnKey(r.ownKey)
          setPick({ provider: r.provider, model: r.model })
          const own = readKey(r.provider)
          setKey(r.ownKey ? '' : (own?.key ?? ''))
          setKeep(r.ownKey ? false : (own?.kept ?? false))
          return
        }
        const c = k?.choice
        // only while the reader has touched nothing: a choice made meanwhile is theirs
        if (!c || chosenHere || touched.current || !list.some((x) => x.id === c.provider)) return
        setPick(c)
        // the provider's own key, as the select does: never another provider's in the field
        const own = readKey(c.provider)
        setKey(own?.key ?? '')
        setKeep(own?.kept ?? false)
      },
      () => !gone && setKept(null),
    )
    return () => {
      gone = true
    }
  }, [settings])
  /** The reader changed the provider, the model or the key since the panel opened. */
  const touched = useRef(false)
  const inRepo = scope === 'repo' && !!repository
  /** The repository the key is asked for: only when it has one of its own. */
  const keyRepo = inRepo && ownKey ? repository.id : undefined
  const keyKept = keyRepo ? kept?.repo?.provider === preset.id && kept.repo.ownKey : !!kept?.keys.includes(preset.id)
  /** Where the setting in force comes from, said beside it. */
  const source = settings && kept ? (inRepo ? `from ${repository.name}` : 'your default') : undefined
  /** Ready to ask: a model, and a key unless none is needed. */
  const settled = !!p.model || (!!pick.model.trim() && (preset.local || !!key.trim() || keyKept))
  /** The reader changed something: the form stays open while they work in it. */
  const touch = () => {
    touched.current = true
    setFolded(false)
  }
  /** The key that came from the page's keeping: asking with it again keeps nothing new. */
  const fetched = useRef(m.fetched ?? null)
  const [advice, setAdvice] = useState(m.advice)
  const [stores, setStores] = useState(m.stores)
  const [code, setCode] = useState('')
  const [looks, setLooks] = useState(m.looks)
  const stop = useRef<AbortController | null>(null)
  // what the panel draws, kept for the next time it opens
  m.turns = turns
  m.note = note
  m.ways = ways
  m.kept = kept
  m.remember = remember
  m.fetched = fetched.current
  m.scope = scope
  m.ownKey = ownKey
  m.folded = folded
  m.request = request
  m.proposal = proposal
  m.usage = usage
  m.advice = advice
  m.stores = stores
  m.looks = looks

  useEffect(() => {
    try {
      sessionStorage.setItem(PICK, JSON.stringify(pick))
    } catch {}
  }, [pick])
  // closing the panel mid-answer stops it, and says so when it opens again
  useEffect(
    () => () => {
      if (!stop.current) return
      stop.current.abort()
      m.note = 'The answer was stopped: the panel closed.'
    },
    [m],
  )
  // a proposal drawn in the canvas, and the files again once it goes: opening the panel changes nothing drawn
  const preview = useRef(p.onPreview)
  preview.current = p.onPreview
  const drawn = useRef(proposal)
  useEffect(() => {
    if (drawn.current === proposal) return
    drawn.current = proposal
    preview.current(proposal)
  }, [proposal])

  /**
   * Keeps the choice, and a key the reader gave (not the one the page gave back), when they changed: the default's, or
   * the open repository's own.
   */
  const rememberChoice = async (st: ModelSettings, had: KeptSettings, k: string) => {
    const model = pick.model.trim()
    const fresh =
      !preset.local &&
      !!k &&
      !(fetched.current?.provider === preset.id && fetched.current.key === k && fetched.current.repo === keyRepo)
    try {
      if (inRepo) {
        const r = had.repo
        const same = r?.provider === preset.id && r.model === model && r.ownKey === ownKey
        // a key typed here is the repository's own: without one of its own it uses the reader's, kept or not
        if (same && !(ownKey && fresh)) return
        await st.save({ provider: preset.id, model, repo: repository.id, ownKey, ...(ownKey && fresh && { key: k }) })
        if (ownKey && fresh) fetched.current = { provider: preset.id, key: k, repo: repository.id }
        setKept({ ...had, repo: { provider: preset.id, model, ownKey: ownKey && (fresh || !!r?.ownKey) } })
        return
      }
      const same = had.choice?.provider === preset.id && had.choice.model === model
      if (same && !fresh) return
      await st.save({ provider: preset.id, model, ...(fresh && { key: k }) })
      if (fresh) fetched.current = { provider: preset.id, key: k }
      setKept({
        ...had,
        choice: { provider: preset.id, model },
        keys: fresh && !had.keys.includes(preset.id) ? [...had.keys, preset.id] : had.keys,
      })
    } catch (err) {
      // the question goes on: only remembering failed
      refused(err)
    }
  }

  /** Back to the reader's default in this repository: its own choice is forgotten. */
  const backToDefault = () => {
    if (!settings || !repository) return
    settings.remove({ repo: repository.id }).then(() => {
      setScope('default')
      setOwnKey(false)
      setKept((k) => k && { ...k, repo: undefined })
      const c = kept?.choice
      if (c && list.some((x) => x.id === c.provider)) setPick(c)
      setKey(readKey(c?.provider ?? preset.id)?.key ?? '')
      setNote(`${repository.name} uses your default now.`)
    }, refused)
  }

  const box = scoped ? p.selected : null
  /**
   * `drafting`: a follow-up ("Draft this", what the looks read), about what was asked before, and the version keeps
   * the question that led to it. `shown`: the turn as the thread draws it, when not the words sent.
   */
  const send = async (e?: FormEvent, said?: string, drafting = false, shown?: string) => {
    e?.preventDefault()
    const about = drafting ? m.asked.box : box
    const words = (said ?? request).trim()
    if (!words || busy) return
    if (!p.model && !preset.local && !key.trim() && !keyKept) {
      setNote(`${preset.name} needs a key: paste one above.`)
      return
    }
    const to = p.model ? { id: p.model.kind, name: p.model.model } : preset
    // asked each time: the page remembers what the reader said for what it holds now
    if (p.confirmSend && !(await p.confirmSend(to))) return
    let model: ModelProvider
    let remembering: (() => Promise<void>) | undefined
    try {
      if (p.model) model = p.model
      else {
        let k = key.trim()
        let given = true
        // the key kept for the reader comes only now, for the question that needs it
        if (!k && keyKept && settings && !preset.local) {
          given = false
          // asked of the page once per page: then from this page's memory
          k =
            (fetched.current?.provider === preset.id && fetched.current.repo === keyRepo
              ? fetched.current.key
              : (await settings.key(preset.id, keyRepo))?.trim()) ?? ''
          if (!k) {
            setKept(
              keyRepo
                ? { ...kept!, repo: kept!.repo && { ...kept!.repo, ownKey: false } }
                : { ...kept!, keys: kept!.keys.filter((x) => x !== preset.id) },
            )
            setNote(`No ${preset.name} key is kept any more: paste one above.`)
            return
          }
          // in the panel's memory for the next question, never in the tab's storage: the field stays empty, saying
          // where it is kept
          fetched.current = { provider: preset.id, key: k, repo: keyRepo }
          m.fetched = fetched.current
        }
        if (given) takeKey(preset.id, k, keep && !(settings && kept && remember))
        model = providerFor(preset, { key: k || undefined, model: pick.model.trim() || undefined })
        if (settings && kept && remember) {
          const st = settings
          const had = kept
          remembering = () => rememberChoice(st, had, given ? k : '')
        }
      }
    } catch (err) {
      refused(err)
      return
    }
    setNote('')
    // after the note is cleared: a refusal to remember stays in view while the question goes on
    if (remembering) await remembering()
    if (said == null) setRequest('')
    setProposal(null)
    setAdvice(false)
    setBusy(true)
    setTurns((t) => [...t, { n: t.length, role: 'user', text: shown ?? words }])
    setLooks(null)
    if (!drafting) m.rounds = 0
    let wanted: ExploreCall[] = []
    // only an answer that came to its end may lead to looks: a stopped one never does
    let ended = false
    m.asked = { request: drafting ? m.asked.request : words, box: about, model: model.model }
    const files = p.files()
    const assistant = createAssistant({ model, reference: p.reference })
    const control = new AbortController()
    stop.current = control
    let text = ''
    try {
      for await (const ev of assistant.ask({
        request: words,
        project: { entry: files.path, files: files.files },
        ...(about && { selection: { box: about } }),
        ...(stores?.explore.length && { explore: stores.explore }),
        thread: m.thread,
        signal: control.signal,
      }) as AsyncGenerator<AssistEvent>) {
        if (ev.type === 'text') {
          text += ev.text
          setStreaming(text)
        } else if (ev.type === 'repair') {
          text = ''
          setStreaming('')
          setNote(`The answer did not compile; asked again (${ev.attempt} of 2).`)
        } else if (ev.type === 'answer') {
          setTurns((t) => [...t, { n: t.length, role: 'assistant', text: ev.text }])
          setAdvice(true)
        } else if (ev.type === 'questions')
          setTurns((t) => [...t, { n: t.length, role: 'assistant', text: ev.questions.join('\n') }])
        else if (ev.type === 'explore') wanted = ev.calls
        else if (ev.type === 'refused') setNote(`No change: ${ev.error}`)
        else if (ev.type === 'proposal') {
          setAdvice(false)
          m.ops = ev.proposal.operations.map((o) => JSON.stringify(o))
          setProposal(ev.proposal)
        } else if (ev.type === 'done') {
          ended = true
          m.thread = ev.thread
          m.used = ev.usage
          setUsage(
            `${model.model}: ${ev.usage.input} tokens in${ev.usage.cached ? ` (${ev.usage.cached} cached)` : ''}, ${ev.usage.output} out`,
          )
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNote((err as Error).message)
    } finally {
      setStreaming('')
      setBusy(false)
      stop.current = null
    }
    if (!wanted.length || !ended) return
    // an answer that asks to look is no advice to draft
    setAdvice(false)
    if (!p.data || !stores?.explore.length)
      return setNote('The model asks to read your metrics: connect them above, then ask again.')
    if (m.rounds >= LOOKS) return setNote(`The model asked to look ${LOOKS} times: ask again, or say what to use.`)
    if (m.allowed) await look(wanted)
    else setLooks(wanted)
  }

  /** The looks run, read only, and what they read sent back to the model as data. */
  const look = async (calls: readonly ExploreCall[]) => {
    const data = p.data
    if (!data) return
    setLooks(null)
    m.rounds++
    setBusy(true)
    let text: string
    try {
      text = await data.explore(calls)
    } catch (err) {
      // the reader hears it, and the card waits again: a failure is never sent to the model as what was read
      m.rounds--
      setNote(`The looks did not run: ${(err as Error).message}`)
      setLooks([...calls])
      return
    } finally {
      setBusy(false)
    }
    await send(undefined, explored(text), true, `Read from your metrics:\n${text}`)
  }

  const connect = async () => {
    if (!p.data) return
    setNote('')
    try {
      const got = await p.data.connect(p.data.code ? code.trim() : undefined)
      if (!got.explore.length && !got.measure.length)
        return setNote(`${p.data.where} answers, but reads no store: set LOADMAP_PROMETHEUS_URL there.`)
      setStores(got)
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  /** The files drawn with the reader's metrics: every measure read over a recent window. */
  const measure = async (files: { path: string; files: Readonly<Record<string, string>> }) => {
    const pull = p.data?.pull
    if (!pull || !p.onMeasured) return
    const measures = compile(files.files[files.path] ?? '', {
      path: files.path,
      files: files.files,
      functions: p.functions,
    }).measures
    if (!measures.length) return setNote('No measure to read: the definition has none, or does not compile.')
    setNote('Reading your metrics…')
    try {
      const snap = await pull(measures)
      const read = Object.values(snap.measurements).filter((x) => !x.missing).length
      if (!(await p.onMeasured(snap)))
        return setNote(
          `Your metrics were read (${read} of ${measures.length}), but the definition with them does not compile.`,
        )
      setNote(`Drawn with your metrics: ${read} of ${measures.length} measures read.`)
    } catch (err) {
      setNote(`Your metrics were not read: ${(err as Error).message}`)
    }
  }

  const accept = async () => {
    const chosen = proposal
    if (!chosen) return
    setProposal(null)
    // a proposal is a change of the files as they were asked about: never laid over text typed since
    const unchanged = () => {
      const now = p.files().files
      const before = chosen.before.files
      return (
        Object.keys(now).length === Object.keys(before).length && Object.entries(before).every(([k, v]) => now[k] === v)
      )
    }
    if (!unchanged()) return setNote('The text changed since the question: ask again to change it as it is now.')
    const { request: words, box: about, model: by } = m.asked
    try {
      // the reader's own edits first, then the assistant's change: each a version of its own
      await p.keep('you', 'Edited')
      if (!unchanged()) return setNote('The text changed since the question: ask again to change it as it is now.')
      applyFiles(p.host, chosen.project.files)
      await p.keep('assistant', subject(words), {
        request: words,
        ...(about && { selection: about }),
        model: by,
        operations: m.ops,
        notes: chosen.notes,
        ...(m.used && { usage: m.used }),
      })
      setNote('Accepted: one undo step per file, and a version in the Timeline.')
      // a measure the change adds is read at once, when the page can: the diagram shows what it measures
      if (!stores?.measure.length || !p.data?.pull) return
      const of = (f: { entry: string; files: Readonly<Record<string, string>> }) =>
        compile(f.files[f.entry] ?? '', { path: f.entry, files: f.files, functions: p.functions }).measures
      const was = new Set(of(chosen.before).map((x) => `${x.id}|${x.query}`))
      if (of(chosen.project).some((x) => !was.has(`${x.id}|${x.query}`)))
        await measure({ path: chosen.project.entry, files: chosen.project.files })
    } catch (err) {
      setNote(`Not accepted: ${(err as Error).message}`)
    }
  }

  return (
    <div className="lme-ask">
      <style>{ASK_CSS}</style>
      {!p.model && settled && folded && (
        <div className="lme-ask-line">
          <span>
            <b>{preset.name}</b>
            {pick.model.trim() && ` · ${pick.model.trim()}`}
            {source && ` · ${source}`}
          </span>
          <button type="button" className="lm-btn lme-quiet" aria-expanded={false} onClick={() => setFolded(false)}>
            Settings
          </button>
        </div>
      )}
      {!p.model && !(settled && folded) && (
        <div className="lme-ask-model">
          {settings && kept && repository && (
            <fieldset className="lme-ask-scope">
              <legend className="lm-sr">Whose setting</legend>
              <button
                type="button"
                className="lm-btn lme-quiet"
                aria-pressed={!inRepo}
                onClick={() => {
                  if (!inRepo) return
                  // the repository's own stays kept until "Use your default here"
                  touch()
                  setScope('default')
                  const c = kept.choice
                  if (c && list.some((x) => x.id === c.provider)) setPick(c)
                }}
              >
                Your default
              </button>
              <button
                type="button"
                className="lm-btn lme-quiet"
                aria-pressed={inRepo}
                onClick={() => {
                  if (inRepo) return
                  touch()
                  setScope('repo')
                  const r = kept.repo
                  setOwnKey(r?.ownKey ?? false)
                  if (r && list.some((x) => x.id === r.provider)) setPick({ provider: r.provider, model: r.model })
                }}
              >
                {repository.name}
              </button>
            </fieldset>
          )}
          <label>
            <span className="lm-sr">Provider</span>
            <select
              value={preset.id}
              onChange={(e) => {
                const next = list.find((x) => x.id === e.target.value)!
                touch()
                setPick({ provider: next.id, model: next.model ?? '' })
                const k = readKey(next.id)
                setKey(k?.key ?? '')
                setKeep(k?.kept ?? false)
              }}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="lm-sr">Model</span>
            <input
              value={pick.model}
              placeholder="model"
              onChange={(e) => {
                touch()
                setPick({ ...pick, model: e.target.value })
              }}
            />
          </label>
          {!preset.local && inRepo && (
            <fieldset className="lme-ask-key">
              <legend className="lm-sr">Which key</legend>
              <label>
                <input
                  type="radio"
                  name={`${id}own`}
                  checked={!ownKey}
                  onChange={() => {
                    touch()
                    setOwnKey(false)
                    setKey(readKey(preset.id)?.key ?? '')
                  }}
                />{' '}
                Your {preset.name} key
              </label>
              <label>
                <input
                  type="radio"
                  name={`${id}own`}
                  checked={ownKey}
                  onChange={() => {
                    touch()
                    setOwnKey(true)
                    setKey('')
                  }}
                />{' '}
                A different key for this repository
              </label>
            </fieldset>
          )}
          {!preset.local && (
            <div className="lme-ask-key">
              <label htmlFor={`${id}k`} className="lm-sr">
                {preset.name} key
              </label>
              <input
                id={`${id}k`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                placeholder={
                  keyKept ? (keyRepo ? 'Kept for this repository' : 'Kept for your account') : `${preset.name} key`
                }
                onChange={(e) => {
                  touch()
                  setKey(e.target.value)
                }}
              />
              {settings && kept ? (
                <label>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember
                  it for my account
                </label>
              ) : null}
              {!(settings && kept && remember) && (
                <label>
                  <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep for this tab
                </label>
              )}
              <button
                type="button"
                className="lm-btn lme-quiet"
                onClick={() => {
                  forgetKey(preset.id)
                  fetched.current = null
                  setKey('')
                  setKeep(false)
                  if (!settings || !keyKept || !kept) return
                  const forId = preset.id
                  settings.remove({ key: forId }).then(() => {
                    setKept((k) => k && { ...k, keys: k.keys.filter((x) => x !== forId) })
                    setNote(`The ${preset.name} key is forgotten here and in your account.`)
                  }, refused)
                }}
              >
                Forget
              </button>
              {p.signIn?.[preset.id] && (
                <button
                  type="button"
                  className="lm-btn"
                  aria-disabled={signing}
                  onClick={() => {
                    // one sign-in at a time: a second would share its window and answer for the first
                    if (signing) return
                    const forId = preset.id
                    const name = preset.name
                    setSigning(true)
                    void p.signIn![forId]!()
                      .then(
                        (k) => {
                          took(forId, k)
                          setNote(`Signed in: a key from ${name}, kept as this page keeps keys.`)
                        },
                        (err: Error) => setNote(err.message),
                      )
                      .finally(() => setSigning(false))
                  }}
                >
                  {signing ? `Signing in with ${preset.name}…` : `Sign in with ${preset.name}`}
                </button>
              )}
              {settings && kept && (
                <p className="lme-hint">
                  {remember
                    ? `${settings.where[0]!.toUpperCase()}${settings.where.slice(1)} keeps your choice and key, encrypted, for your next visit and your other devices${inRepo ? `, and ${repository.name}'s own` : ''}. Untick to keep a new key in this page only.`
                    : 'A new key stays in this page, or this tab if you tick it.'}
                </p>
              )}
              {settings && kept && (kept.choice || kept.keys.length > 0) && (
                <button
                  type="button"
                  className="lm-btn lme-quiet"
                  onClick={() =>
                    settings.remove('all').then(() => {
                      fetched.current = null
                      m.fetched = null
                      setKept({ keys: [] })
                      setNote('Your account keeps no model or key now.')
                    }, refused)
                  }
                >
                  Remove what your account keeps
                </button>
              )}
            </div>
          )}
          <div className="lme-ask-row">
            {source && <span className="lme-ask-usage">In force: {source}.</span>}
            {inRepo && kept?.repo && (
              <button type="button" className="lm-btn lme-quiet" onClick={backToDefault}>
                Use your default here
              </button>
            )}
            {settled && (
              <button type="button" className="lm-btn lme-quiet" onClick={() => setFolded(true)}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
      {p.data && (
        <div className="lme-ask-row">
          {stores ? (
            <>
              <span>
                Your metrics: {[...new Set([...stores.explore, ...stores.measure])].join(', ')}, through {p.data.where}.
              </span>
              {p.data.pull && p.onMeasured && stores.measure.length > 0 && (
                <button
                  type="button"
                  className="lm-btn lme-quiet"
                  aria-disabled={busy}
                  onClick={() => !busy && void measure(p.files())}
                >
                  Draw with them
                </button>
              )}
            </>
          ) : (
            <>
              <span>Your metrics: not connected.</span>
              {p.data.code && (
                <>
                  <label htmlFor={`${id}c`} className="lm-sr">
                    {p.data.code}
                  </label>
                  <input
                    id={`${id}c`}
                    className="lme-ask-code"
                    value={code}
                    placeholder="Code"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </>
              )}
              <button type="button" className="lm-btn lme-quiet" onClick={() => void connect()}>
                Connect
              </button>
            </>
          )}
        </div>
      )}
      <div className="lme-ask-thread" aria-live="polite">
        {turns.map((t) => (
          <div key={t.n} className="lme-ask-msg" data-role={t.role}>
            {t.text}
          </div>
        ))}
        {streaming && (
          <div className="lme-ask-msg" data-role="assistant">
            {streaming}
          </div>
        )}
      </div>
      {proposal && (
        <ProposalCard
          proposal={proposal}
          shows={p.shows ?? null}
          onBefore={(b) => p.onPreview(proposal, b)}
          onAccept={() => void accept()}
          onReject={() => setProposal(null)}
        />
      )}
      {looks && !busy && (
        <section className="lme-ask-card" aria-label="Looks in your metrics">
          <p>The model asks to read your metrics, read only:</p>
          <ul>
            {looks.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the same look may be asked twice
              <li key={i}>
                <code>
                  {c.tool} {c.arg}
                </code>
                {c.window ? ` over ${c.window}` : ''}
              </li>
            ))}
          </ul>
          <div className="lme-ask-row">
            <button type="button" className="lm-btn lme-primary" onClick={() => void look(looks)}>
              Run
            </button>
            <button
              type="button"
              className="lm-btn"
              onClick={() => {
                m.allowed = true
                void look(looks)
              }}
            >
              Run, and allow for this session
            </button>
            <button
              type="button"
              className="lm-btn lme-quiet"
              onClick={() => {
                setLooks(null)
                setNote('Not read: ask again, or say what to use instead.')
              }}
            >
              Not now
            </button>
          </div>
        </section>
      )}
      {note && (
        <p className="lme-hint">
          {note}
          {ways?.note === note &&
            ways.links.map((l) => (
              <Fragment key={l.href}>
                {' '}
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              </Fragment>
            ))}
        </p>
      )}
      {box && !busy && (
        <fieldset className="lme-ask-row">
          <legend className="lm-sr">Ask about {box}</legend>
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              className="lme-ask-chip"
              onClick={() => void send(undefined, q.ask(box))}
            >
              {q.label}
            </button>
          ))}
        </fieldset>
      )}
      {advice && !busy && !proposal && (
        <div className="lme-ask-row">
          <button type="button" className="lm-btn" onClick={() => void send(undefined, DRAFT, true)}>
            Draft this
          </button>
        </div>
      )}
      <form onSubmit={send}>
        <div className="lme-ask-row">
          {p.selected && (
            <button type="button" className="lme-ask-chip" aria-pressed={scoped} onClick={() => setScoped(!scoped)}>
              {scoped ? `About ${p.selected}` : 'The whole diagram'}
            </button>
          )}
        </div>
        <label htmlFor={`${id}q`} className="lm-sr">
          Ask about the diagram
        </label>
        <textarea
          id={`${id}q`}
          value={request}
          placeholder={box ? `Ask about ${box}…` : 'Ask about this diagram…'}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <div className="lme-ask-row">
          {busy ? (
            <button type="button" className="lm-btn" onClick={() => stop.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="lm-btn lme-primary">
              Ask
            </button>
          )}
          {usage && <span className="lme-ask-usage">{usage}</span>}
        </div>
      </form>
    </div>
  )
}

function ProposalCard({
  proposal,
  shows,
  onBefore,
  onAccept,
  onReject,
}: {
  proposal: Proposal
  /** What the canvas draws, which the pressed button says: it may have left the proposal by other ways. */
  shows: 'before' | 'after' | null
  /** Draws the files as they are (true) or as the proposal leaves them (false). */
  onBefore: (before: boolean) => void
  onAccept: () => void
  onReject: () => void
}) {
  const files = [...proposal.changed, ...proposal.added]
  const [open, setOpen] = useState<string | null>(files.length === 1 ? files[0]! : null)
  const diff = useMemo(
    () => (open ? diffLines(proposal.before.files[open] ?? '', proposal.project.files[open] ?? '') : []),
    [open, proposal],
  )
  return (
    <section className="lme-ask-card" aria-label="Proposal">
      <strong>
        Proposal · {files.length} file{files.length === 1 ? '' : 's'}
        {proposal.removed.length ? ` · ${proposal.removed.length} removed` : ''}
      </strong>
      {proposal.notes.length > 0 && (
        <ul>
          {proposal.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {proposal.moved && <p>{proposal.moved.text}</p>}
      {proposal.moved?.worse.map((w) => (
        <p key={w}>Worse: {w}</p>
      ))}
      {proposal.expectations.map((e) => (
        <p key={e.label}>
          {e.label}: {e.before ? `${e.before} → ` : ''}
          {e.after}
        </p>
      ))}
      {proposal.figures.length > 0 && (
        <ul aria-label="Capacities it writes">
          {proposal.figures.map((f) => (
            <li key={`${f.file}:${f.line}:${f.text}`}>
              {f.text}
              {!f.given && (
                <span className="lme-ask-guess">{f.read ? ' read from your metrics' : " the assistant's guess"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {proposal.warnings.map((w) => (
        <p key={w}>Warning: {w}</p>
      ))}
      {files.map((path) => (
        <div key={path}>
          <button
            type="button"
            className="lme-ask-chip"
            aria-expanded={open === path}
            onClick={() => setOpen(open === path ? null : path)}
          >
            {path}
          </button>
          {open === path && (
            <pre>
              {diff.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a diff's lines are drawn once, in order, never moved
                <span key={i} className={l.kind === '+' ? 'lme-add' : l.kind === '-' ? 'lme-del' : undefined}>
                  {l.kind === '@' ? '…' : `${l.kind}${l.text}`}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
        </div>
      ))}
      <fieldset className="lme-ask-row">
        <legend className="lm-sr">The canvas shows</legend>
        <button type="button" className="lme-ask-chip" aria-pressed={shows === 'before'} onClick={() => onBefore(true)}>
          Before
        </button>
        <button type="button" className="lme-ask-chip" aria-pressed={shows === 'after'} onClick={() => onBefore(false)}>
          After
        </button>
      </fieldset>
      <div className="lme-ask-row">
        <button type="button" className="lm-btn lme-primary" onClick={onAccept}>
          Accept
        </button>
        <button type="button" className="lm-btn" onClick={onReject}>
          Reject
        </button>
      </div>
    </section>
  )
}
