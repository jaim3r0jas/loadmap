import { download, exportPng, exportSvg, expose, recordPoster, recordVideo, type ScriptStep } from '@loadmap/export'
import type { LoadmapHandle } from '@loadmap/react'
import { useEffect } from 'react'

/** Records the shown board: buttons on the page, and `expose` for `loadmap record`. */
export function useRecorder(name: string, get: () => LoadmapHandle | null | undefined) {
  useEffect(() => {
    // a stand-in that always reaches the current board: the editor's changes with every version
    const live = new Proxy({} as LoadmapHandle, {
      get: (_, k) => {
        const h = get() as Record<PropertyKey, unknown> | null | undefined
        const v = h?.[k]
        return typeof v === 'function' ? v.bind(h) : v
      },
    })
    const off = [expose(live), expose(live, name)]
    return () => {
      for (const f of off) f()
    }
  }, [name, get])
  const png = async () => {
    const h = get()
    if (h) download(await exportPng(h), `${name}.png`)
  }
  const poster = async () => {
    const h = get()
    if (h) download(await recordPoster(h), `${name}-poster.png`)
  }
  const svg = async () => {
    const h = get()
    if (h) download(new Blob([await exportSvg(h, { caption: true })], { type: 'image/svg+xml' }), `${name}.svg`)
  }
  // the story when there is one; otherwise the load rises, then the second scenario takes over: a captioned 6 s
  const record = async (format: 'webm' | 'gif') => {
    const h = get()
    if (!h) return
    if (h.engine.model.story.length)
      return download(await recordVideo(h, { story: true, format, caption: true }), `${name}.${format}`)
    const next = h.engine.model.scenarios[1]?.label
    const script: ScriptStep[] = [
      { at: 0, set: { load: 5 } },
      { at: 2, set: { load: 30 } },
      ...(next ? [{ at: 4, scenario: next }] : []),
    ]
    download(await recordVideo(h, { seconds: 6, format, script, caption: true }), `${name}.${format}`)
  }
  return { png, poster, svg, record }
}
