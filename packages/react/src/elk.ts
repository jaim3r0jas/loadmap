import { type ElkEngine, localElk } from '@loadmap/layout'

type Graph = Parameters<ElkEngine['layout']>[0]

let shared: ElkEngine | null = null

/**
 * One ELK worker for every loadmap on the page, started on the first layout. When the worker cannot start or load
 * (no Worker, a CSP without worker-src, a dev server that pre-bundled this package away from the worker file), every
 * layout runs on the main thread instead: slower to start, the same result.
 */
export function pageElk(): ElkEngine {
  shared ??= workerElk(
    () => new Worker(new URL('./elk.worker.js', import.meta.url), { type: 'module', name: 'loadmap-elk' }),
  )
  return shared
}

/** ELK in the worker `make` starts, falling back to the main thread. */
export function workerElk(make: () => Worker): ElkEngine {
  let worker: Worker | null = null
  let broken = typeof Worker === 'undefined'
  let next = 0
  const pending = new Map<number, { graph: Graph; resolve: (g: Graph) => void; reject: (e: Error) => void }>()

  const fallBack = () => {
    broken = true
    worker?.terminate()
    worker = null
    for (const [id, p] of pending) {
      pending.delete(id)
      localElk()
        .then((elk) => elk.layout(p.graph))
        .then(p.resolve, p.reject)
    }
  }

  const start = (): Worker | null => {
    if (worker || broken) return worker
    try {
      worker = make()
    } catch {
      fallBack()
      return null
    }
    worker.onmessage = ({ data }: MessageEvent<{ id: number; graph?: Graph; error?: string }>) => {
      const p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      if (data.error != null) p.reject(new Error(data.error))
      else p.resolve(data.graph!)
    }
    // the script failed to load or to run: no answer will come
    worker.onerror = (e) => {
      e.preventDefault()
      fallBack()
    }
    return worker
  }

  return {
    layout(graph) {
      const w = start()
      if (!w) return localElk().then((elk) => elk.layout(graph))
      return new Promise((resolve, reject) => {
        const id = next++
        pending.set(id, { graph, resolve, reject })
        w.postMessage({ id, graph })
      })
    },
  }
}
