// ELK off the main thread, so a page stays responsive while a layout is computed. Plain JavaScript: the same file
// serves the workspace and dist, where `new URL('./elk.worker.js', import.meta.url)` finds it next to the module.
import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

// set after the import: elk.bundled installs its own handler when it loads in a worker
self.onmessage = async ({ data: { id, graph } }) => {
  try {
    self.postMessage({ id, graph: await elk.layout(graph) })
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) })
  }
}
