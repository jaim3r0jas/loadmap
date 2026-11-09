import { compile } from '@loadmap/dsl'
import { changedBoxes, type Drawn } from '@loadmap/dsl/internal'
import type { LoadmapHandle } from '@loadmap/react'
import { LoadmapSource, type LoadmapSourceProps } from '@loadmap/react/source'
import { useEffect, useRef, useState } from 'react'
import type { Edit, FromPreview, ParamValue, PreviewState, ToPreview } from '../protocol'

/** What the webview gets from VS Code (`acquireVsCodeApi()`), or a test in its place. */
export interface Host {
  postMessage(m: FromPreview): void
  getState(): PreviewState | undefined
  setState(s: PreviewState): void
}

type Values = Record<string, ParamValue>

/** Milliseconds the text rests (after the extension's own pause) before tracking shows what changed, and the mark. */
const REST = 350
const MARK = 1600

/**
 * The open `.loadmap` drawn live, as the docs' embed draws a link: filling the panel, zoomable, with the definition's
 * own options (its `fullScreenMode` too: the diagram first, or the panels). While the text has an error, its problems
 * above the last version that compiled. The values (the load, a scenario, the controls) stay across edits, each file
 * keeps its own while the preview follows another, and the file shown keeps them across a reload. Tracking live
 * changes, once an edit is drawn and the text rests, it brings the boxes the edit changed into view and marks them.
 */
export function Preview({ host, elk }: { host: Host; elk?: LoadmapSourceProps['elk'] }) {
  const [doc, setDoc] = useState<Omit<PreviewState, 'values'> | undefined>(() => host.getState())
  const [selected, setSelected] = useState<string | null>(null)
  const ref = useRef<LoadmapHandle>(null)
  const current = useRef(doc)
  current.current = doc
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  // tracking: whether it is on, what the board drew before the edits not followed yet, where they changed the text
  // (from the extension, never guessed here), the version they reach, the last one followed, and when the text came
  const tracking = useRef(false)
  const before = useRef<Drawn | null>(null)
  const edits = useRef<Edit[]>([])
  const version = useRef(0)
  const followed = useRef(0)
  const came = useRef(0)
  // the boxes marked last, and when the mark goes: a new mark takes over from it
  const marked = useRef<{ els: Element[]; timer: number }>({ els: [], timer: 0 })
  const [unmark] = useState(() => () => {
    clearTimeout(marked.current.timer)
    for (const el of marked.current.els) el.removeAttribute('data-changed')
  })
  useEffect(() => unmark, [unmark])
  // the values of each file the preview has shown, for when it comes back to one
  const [memory] = useState(() => {
    const s = host.getState()
    return new Map<string, Values>(s?.values ? [[s.uri, s.values]] : [])
  })

  useEffect(() => {
    /** The values that differ from the model's defaults: what a share link carries. */
    const changed = () => {
      const h = ref.current
      const out: Values = {}
      if (!h) return out
      const defaults = h.engine.model.defaults() as Values
      for (const [k, v] of Object.entries(h.values() as Values)) if (defaults[k] !== v) out[k] = v
      return out
    }
    /** A file's values: the board's, or the ones remembered while none is drawn (a text that has never compiled). */
    const valuesOf = (uri: string) => (ref.current ? changed() : (memory.get(uri) ?? {}))
    // what a reload brings back: kept as each text arrives, and as the tab hides with the values set since
    const keep = () => {
      if (current.current) host.setState({ ...current.current, values: valuesOf(current.current.uri) })
    }
    const receive = ({ data: m }: MessageEvent<ToPreview>) => {
      if (m.type === 'source') {
        const was = current.current
        const e = ref.current?.engine
        if (!tracking.current || m.edits === null || was?.uri !== m.uri) {
          before.current = null
          edits.current = []
          // each document counts its own versions
          if (m.edits === null || was?.uri !== m.uri) followed.current = 0
        } else {
          if (!before.current && e?.scene) before.current = { scene: e.scene, ev: e.ev }
          edits.current = m.edits.filter((x) => x.version > followed.current)
        }
        version.current = m.version
        came.current = performance.now()
        if (was && was.uri !== m.uri) memory.set(was.uri, valuesOf(was.uri))
        const next = { uri: m.uri, source: m.source, name: m.name }
        current.current = next
        setDoc(next)
        host.setState({ ...next, values: was?.uri === m.uri ? valuesOf(m.uri) : (memory.get(m.uri) ?? {}) })
      } else if (m.type === 'track') {
        tracking.current = m.on
        before.current = null
        edits.current = []
      } else if (m.type === 'select') setSelected(m.id)
      else if (m.type === 'state?') {
        const svg = ref.current?.board()?.svg
        const boxes = [...(svg?.querySelectorAll<SVGElement>('[data-node]') ?? [])].map((b) => b.dataset.node!)
        host.postMessage({ type: 'state', request: m.request, values: changed(), boxes, selected: selectedRef.current })
      }
    }
    addEventListener('message', receive)
    addEventListener('pagehide', keep)
    document.addEventListener('visibilitychange', keep)
    host.postMessage({ type: 'ready' })
    return () => {
      removeEventListener('message', receive)
      removeEventListener('pagehide', keep)
      document.removeEventListener('visibilitychange', keep)
    }
  }, [host, memory])

  // tracking: once a new version is drawn, its move done and the text at rest a moment, the board shows what it
  // changed. A version that comes meanwhile takes over, from the same drawing before
  // biome-ignore lint/correctness/useExhaustiveDependencies: each text that comes; the rest is read through refs
  useEffect(() => {
    const was = before.current
    const h = ref.current
    if (!was || !h || !doc) return
    let live = true
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      try {
        await h.ready()
      } catch {
        return
      }
      const e = h.engine
      while (live && (e.frame !== e.scene || performance.now() - came.current < REST)) await wait(100)
      // a text with an error draws nothing new: its edits wait for the version that does
      if (!live || !e.scene || e.scene === was.scene || !tracking.current || before.current !== was) return
      const ids = changedBoxes(
        was,
        { scene: e.scene, ev: e.ev },
        doc.source,
        edits.current,
        compile(doc.source).symbols,
      )
      before.current = null
      edits.current = []
      followed.current = version.current
      host.postMessage({ type: 'tracked', uri: doc.uri, version: version.current, boxes: ids })
      h.show(ids)
      unmark()
      const els = [...(h.board()?.svg.querySelectorAll('[data-node]') ?? [])].filter((el) =>
        ids.includes(el.getAttribute('data-node')!),
      )
      // read between, so a box still marked glows again from the start
      for (const el of els) el.getBoundingClientRect()
      for (const el of els) el.setAttribute('data-changed', '')
      marked.current = { els, timer: window.setTimeout(unmark, MARK) }
    })()
    return () => {
      live = false
    }
  }, [doc])

  if (!doc) return <p className="lmv-empty">Open a .loadmap file to see its diagram here.</p>
  return (
    <LoadmapSource
      // each file on a board of its own, from its own values
      key={doc.uri}
      ref={ref}
      source={doc.source}
      name={doc.name}
      fill
      zoom
      theme="inherit"
      initial={memory.get(doc.uri)}
      selected={selected}
      onNodeClick={(id) => host.postMessage({ type: 'reveal', id })}
      elk={elk}
    />
  )
}
