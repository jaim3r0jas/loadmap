import { compile, type Definition, type HostFunctions } from '@loadmap/dsl'
import { Canvas } from '@loadmap/react'
import { type ReactNode, Suspense } from 'react'
import { type Author, History, type Trace } from './history'
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
}

const Timeline = later(() => import('./Timeline'), 'The history did not load: reload the page.')

export class Studio {
  history: History | null = null
  /** Counts the history's changes, for the panels to draw again. */
  version = 0

  constructor(
    private host: () => StudioHost,
    private key?: string,
  ) {}

  /** The history read back from the tab, or started from the files. */
  async open(): Promise<this> {
    this.history = await History.open(this.host().files(), this.key)
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

  /** A version drawn in the canvas: compiled here, not in the editor's first load. */
  show = (id: string | null) => {
    const h = this.history
    const c = id && h ? h.commits.get(id) : undefined
    if (!c || !h) return this.host().show(null)
    const files = h.filesOf(c)
    const r = compile(files[c.entry] ?? '', { path: c.entry, files, functions: this.host().functions })
    this.host().show(r.definition ? c.id : null, r.definition)
  }

  /** The panels for the canvas, in its slot's order. */
  panels(o: { history: boolean; shown: string | null }): ReactNode[] {
    const host = this.host()
    return [
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
