import {
  type AssistEvent,
  createAssistant,
  diffLines,
  type ModelProvider,
  PROVIDERS,
  type Proposal,
  type ProviderPreset,
  providerFor,
} from '@loadmap/dsl/assist'
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
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
}

export const ASK_CSS = `
.lme-ask { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; font-size: .84rem; min-width: 0; }
.lme-ask > *, .lme-ask-card > *, .lme-ask-thread > * { min-width: 0; max-width: 100%; }
.lme-ask form { display: grid; gap: 6px; }
.lme-ask-model { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.lme-ask-model select, .lme-ask-model input, .lme-ask textarea { min-width: 0; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 4px 7px; }
.lme-ask-key { grid-column: 1 / -1; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lme-ask-key input[type="password"] { flex: 1; }
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
  const [request, setRequest] = useState(m.request)
  const [scoped, setScoped] = useState(true)
  const [proposal, setProposal] = useState<Proposal | null>(m.proposal)
  const [usage, setUsage] = useState(m.usage)
  const [advice, setAdvice] = useState(m.advice)
  const stop = useRef<AbortController | null>(null)
  // what the panel draws, kept for the next time it opens
  m.turns = turns
  m.note = note
  m.request = request
  m.proposal = proposal
  m.usage = usage
  m.advice = advice

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

  const box = scoped ? p.selected : null
  /** `drafting`: "Draft this", about what the advice was about, and the version keeps the question that led to it. */
  const send = async (e?: FormEvent, said?: string, drafting = false) => {
    e?.preventDefault()
    const about = drafting ? m.asked.box : box
    const words = (said ?? request).trim()
    if (!words || busy) return
    if (!p.model && !preset.local && !key.trim()) {
      setNote(`${preset.name} needs a key: paste one above.`)
      return
    }
    const to = p.model ? { id: p.model.kind, name: p.model.model } : preset
    // asked each time: the page remembers what the reader said for what it holds now
    if (p.confirmSend && !(await p.confirmSend(to))) return
    let model: ModelProvider
    try {
      if (p.model) model = p.model
      else {
        takeKey(preset.id, key, keep)
        model = providerFor(preset, { key: key.trim() || undefined, model: pick.model.trim() || undefined })
      }
    } catch (err) {
      setNote((err as Error).message)
      return
    }
    setNote('')
    if (said == null) setRequest('')
    setProposal(null)
    setAdvice(false)
    setBusy(true)
    setTurns((t) => [...t, { n: t.length, role: 'user', text: words }])
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
        else if (ev.type === 'explore') {
          setNote('The model asks to read your metrics: this page has no connection to them.')
        } else if (ev.type === 'refused') setNote(`No change: ${ev.error}`)
        else if (ev.type === 'proposal') {
          setAdvice(false)
          m.ops = ev.proposal.operations.map((o) => JSON.stringify(o))
          setProposal(ev.proposal)
        } else if (ev.type === 'done') {
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
    } catch (err) {
      setNote(`Not accepted: ${(err as Error).message}`)
    }
  }

  return (
    <div className="lme-ask">
      <style>{ASK_CSS}</style>
      {!p.model && (
        <div className="lme-ask-model">
          <label>
            <span className="lm-sr">Provider</span>
            <select
              value={preset.id}
              onChange={(e) => {
                const next = list.find((x) => x.id === e.target.value)!
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
              onChange={(e) => setPick({ ...pick, model: e.target.value })}
            />
          </label>
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
                placeholder={`${preset.name} key`}
                onChange={(e) => setKey(e.target.value)}
              />
              <label>
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep for this tab
              </label>
              <button
                type="button"
                className="lm-btn lme-quiet"
                onClick={() => {
                  forgetKey(preset.id)
                  setKey('')
                  setKeep(false)
                }}
              >
                Forget
              </button>
            </div>
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
      {note && <p className="lme-hint">{note}</p>}
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
