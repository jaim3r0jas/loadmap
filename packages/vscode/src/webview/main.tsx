import { workerElk } from '@loadmap/react'
// the worker bundled with ELK, as a file of its own next to this one
import elkWorker from '@loadmap/react/elk.worker.js?worker&url'
import { createRoot } from 'react-dom/client'
import type { PreviewState } from '../protocol'
import { type Host, Preview } from './Preview'
import { followTheme } from './theme'

declare function acquireVsCodeApi(): Host & { getState(): PreviewState | undefined }

/**
 * ELK in a worker: a webview cannot start one from its own resource URL (another origin), so the script comes over as
 * a blob, which the CSP allows (worker-src blob:). Without it the layout runs on the main thread, slower to start.
 */
async function elk() {
  try {
    const script = await fetch(elkWorker).then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
    const url = URL.createObjectURL(script)
    return workerElk(() => new Worker(url, { name: 'loadmap-elk' }))
  } catch {
    return undefined
  }
}

followTheme()
const host = acquireVsCodeApi()
createRoot(document.getElementById('root')!).render(<Preview host={host} elk={await elk()} />)
