import type { Snapshot } from '@loadmap/core/measure'
import { type CompileResult, compile, type Definition, type HostFunctions } from '@loadmap/dsl'
import type { Proposal } from '@loadmap/dsl/assist'
import { Canvas } from '@loadmap/react'
import { type ReactNode, Suspense } from 'react'
import { type AskMemory, askMemory } from './AskMemory'
import { type Author, History, type Trace } from './history'
import type { EditorAssist } from './LoadmapEditor'
import { later } from './Menu'
import type { FileHost } from './reshape'

/**
 * What the editor offers beyond the text and the diagram, loaded once a page asks for it: the history of the files
 * and its Timeline panel. All of it is here, in a chunk of its own: the editor's first load holds only the hook that
 * loads it and the panels' places in the canvas.
 */

export interface StudioHost {
  fileHost: FileHost
  /** The files as they are now. */
  files(): { path: string; files: Readonly<Record<string, string>> }
  /** Draws a definition in the canvas instead of the files (an older version), or the files again (null). */
  show(id: string | null, def?: Definition): void
  /** Something the panels show changed: draw again. */
  changed(): void
  functions?: HostFunctions
  /** Every file replaced, the model too: a restore across a rename of the model. No version of its own. */
  replace(f: { path: string; files: Readonly<Record<string, string>> }): void
  /** The editor's own element: what the proposal's marks are put on, never another editor's boxes. */
  root(): HTMLElement | null
}

const Timeline = later(() => import('./Timeline'), 'The history did not load: reload the page.')

/** What a proposal draws, worked out once: its definition, and the boxes it adds and changes, by id. */
interface Draft {
  def?: Definition
  added: ReadonlySet<string>
  changed: ReadonlySet<string>
}

/** A statement without its comments and with its spaces collapsed: a comment changed is no change. */
function bare(text: string): string {
  let out = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"' && text[i - 1] !== '\\') quoted = !quoted
    if (c === '#' && !quoted) {
      const end = text.indexOf('\n', i)
      if (end < 0) break
      i = end - 1
      continue
    }
    out += c
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Each box's statement as written, and its component's figures at the defaults: a box changes when either does, so
 * a library, a variant or a published figure that moves it counts, and a comment does not.
 */
function boxes(r: CompileResult, files: Readonly<Record<string, string>>, entry: string): Map<string, string> {
  const out = new Map<string, string>()
  const ev = r.definition?.model.evaluate()
  for (const s of r.symbols) {
    if (s.kind !== 'node') continue
    const text = bare((files[s.file ?? entry] ?? '').slice(s.decl.from, s.decl.to))
    const id = ev?.stages[s.id]?.component ?? s.id
    const c = ev?.components[id]
    out.set(s.id, `${text}|${c?.demand}|${c?.capacity?.value}|${c?.target}`)
  }
  return out
}

function drafted(p: Proposal, functions: HostFunctions | undefined): Draft {
  const { entry, files } = p.project
  const r = compile(files[entry] ?? '', { path: entry, files, functions })
  if (!r.definition) return { added: new Set(), changed: new Set() }
  const was = compile(p.before.files[p.before.entry] ?? '', { path: p.before.entry, files: p.before.files, functions })
  const a = boxes(was, p.before.files, p.before.entry)
  const b = boxes(r, p.project.files, p.project.entry)
  // files that did not compile may hold fewer boxes than they draw: none is called new against them
  const whole = !was.diagnostics.some((d) => d.severity === 'error')
  return {
    def: r.definition,
    added: new Set(whole ? [...b.keys()].filter((id) => !a.has(id)) : []),
    changed: new Set([...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id))),
  }
}

const AskPanel = later(() => import('./AskPanel'), 'The Ask panel did not load: reload the page.')

export class Studio {
  history: History | null = null
  /** Counts the history's changes, for the panels to draw again. */
  version = 0
  /** The Ask panel's conversation, kept while its tab is closed. */
  ask: AskMemory = askMemory()

  constructor(
    private host: () => StudioHost,
    private key?: string,
    private keeps = true,
  ) {}

  /** The history read back from the tab, or started from the files, when the page asked for one. */
  async open(): Promise<this> {
    if (this.keeps) this.history = await History.open(this.host().files(), this.key)
    this.touch()
    return this
  }

  /** The history changed: kept in the tab, and drawn again. */
  touch = () => {
    this.version++
    this.history?.keep(this.key)
    this.host().changed()
  }

  /** The files as they are now, a version: none when they are the newest one's. */
  keep = async (author: Author, message: string, trace?: Trace) => {
    const f = this.host().files()
    if (await this.history?.commit(f.files, f.path, author, message, trace)) this.touch()
  }

  /** The history as a git bundle, saved by the browser: `git clone <file>` reads it. */
  download = async () => {
    const h = this.history
    if (!h) return
    // a browser without the compression git's objects need says so, rather than nothing happening
    if (typeof CompressionStream === 'undefined' || !globalThis.crypto?.subtle)
      throw new Error('this browser cannot write a git bundle (it lacks CompressionStream or crypto.subtle).')
    const { bundle } = await import('./bundle')
    const bytes = await bundle(h)
    const name =
      h.head.entry
        .split('/')
        .pop()!
        .replace(/\.loadmap$/, '') || 'model'
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.bundle`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** A version drawn in the canvas: compiled here, not in the editor's first load. */
  show = (id: string | null) => {
    const h = this.history
    const c = id && h ? h.commits.get(id) : undefined
    if (!c || !h) return this.host().show(null)
    const files = h.filesOf(c)
    const r = compile(files[c.entry] ?? '', { path: c.entry, files, functions: this.host().functions })
    this.host().show(r.definition ? c.id : null, r.definition)
  }

  /** A proposal drawn in the canvas until it is accepted or dropped; null (or `before`) draws the files again. */
  preview = (p: Proposal | null, before = false) => {
    this.unmark()
    if (!p || before) return this.host().show(null)
    const d = this.drafts.get(p) ?? drafted(p, this.host().functions)
    this.drafts.set(p, d)
    this.host().show(d.def ? 'proposal' : null, d.def)
    if (d.def) this.mark(d)
  }

  /** Each proposal's drawing, once: Before and After switch between them without compiling again. */
  private drafts = new WeakMap<Proposal, Draft>()
  private watch: MutationObserver | null = null

  /** The boxes a proposal adds and changes, marked in this editor's canvas for as long as it is drawn. */
  private mark(d: Draft) {
    const root = this.host().root()
    if (!root || (!d.added.size && !d.changed.size)) return
    const put = () => {
      for (const el of root.querySelectorAll('.lme-preview [data-node]')) {
        const id = el.getAttribute('data-node') ?? ''
        const v = d.added.has(id) ? 'added' : d.changed.has(id) ? 'changed' : null
        if (v && el.getAttribute('data-proposed') !== v) el.setAttribute('data-proposed', v)
        else if (!v && el.hasAttribute('data-proposed')) el.removeAttribute('data-proposed')
      }
    }
    put()
    // a new box is drawn after its layout, and a box drawn again when the scene changes: marked each time
    this.watch = new MutationObserver(put)
    this.watch.observe(root, { childList: true, subtree: true })
  }

  /** No marks: the canvas draws something other than the proposal. */
  unmark = () => {
    this.watch?.disconnect()
    this.watch = null
    for (const el of this.host().root()?.querySelectorAll('[data-proposed]') ?? []) el.removeAttribute('data-proposed')
  }

  /**
   * The files drawn with measured data, until the reader goes back or edits: the text stays as written, the snapshot
   * only fills its measures. `@loadmap/core/measure` loads with the first snapshot, never before.
   */
  measured = async (snap: Snapshot | null) => {
    if (!snap) return this.host().show(null)
    const { fromSnapshot } = await import('@loadmap/core/measure')
    const f = this.host().files()
    const r = compile(f.files[f.path] ?? '', {
      path: f.path,
      files: f.files,
      functions: this.host().functions,
      snapshot: fromSnapshot(snap),
    })
    // the snapshot's own time, as it says it (UTC): never this machine's clock or locale
    const utc = /T(\d\d:\d\d)(:\d\d(\.\d+)?)?Z$/.exec(snap.fetched)?.[1]
    this.measuredAt = utc ? `${utc} UTC` : snap.fetched
    this.host().show(r.definition ? 'measured' : null, r.definition)
  }

  /** When the snapshot drawn was read. */
  private measuredAt = ''

  /** The note over the canvas while a version or a proposal is drawn, with the way back to the files. */
  note(id: string): ReactNode {
    return (
      <p className="lme-stale">
        {id === 'proposal'
          ? 'Showing the proposal.'
          : id === 'measured'
            ? `Drawn with your metrics, read at ${this.measuredAt}.`
            : 'Showing an older version.'}{' '}
        <button type="button" className="lm-btn lme-quiet" onClick={() => this.host().show(null)}>
          Back to now
        </button>
      </p>
    )
  }

  /** The panels for the canvas, in its slot's order. */
  panels(o: { history: boolean; assist?: EditorAssist; selected: string | null; shown: string | null }): ReactNode[] {
    const host = this.host()
    return [
      o.assist && (
        <Canvas.Panel key="ask" id="ask" title="Ask">
          <Suspense fallback={null}>
            <AskPanel
              host={host.fileHost}
              files={host.files}
              keep={this.keep}
              onPreview={this.preview}
              shows={o.shown === 'proposal' ? 'after' : o.shown === null ? 'before' : null}
              reference={o.assist.reference}
              providers={o.assist.providers}
              confirmSend={o.assist.confirmSend}
              model={o.assist.model}
              memory={this.ask}
              data={o.assist.data}
              onMeasured={this.measured}
              selected={o.selected}
            />
          </Suspense>
        </Canvas.Panel>
      ),
      o.history && (
        <Canvas.Panel key="timeline" id="timeline" title="Timeline">
          {this.history ? (
            <Suspense fallback={null}>
              <Timeline
                history={this.history}
                host={host.fileHost}
                files={host.files}
                version={this.version}
                shown={o.shown}
                onShow={this.show}
                onChanged={this.touch}
                onReplace={host.replace}
                onExport={this.download}
              />
            </Suspense>
          ) : (
            <p className="lme-hint">The history is loading.</p>
          )}
        </Canvas.Panel>
      ),
    ]
  }
}
