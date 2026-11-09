// The page an embed frames (ClickUp's /embed, any iframe): a shared link's definition filling the frame, nothing else.
// The query picks how it shows (?mode=focus|panels&panels=verdict,controls&theme=auto|light|dark&play=1); the fragment
// is the editor's share link, which never reaches the server. The text is untrusted: it compiles with the language's
// limits, and its formulas never reach eval.
import { compile, type Definition, decodeShare, formatDiagnostic, loadCatalogFor, sharedValues } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
import { LOADMAP_PANELS, Loadmap, type LoadmapHandle, type LoadmapPanel } from '@loadmap/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

const query = new URLSearchParams(location.search)
const editor = () => `${new URL('../editor/', location.href).href}${location.hash}`

/** What the query asks for: a known value or nothing, so a mistyped option shows the default. */
const pick = <T extends string>(name: string, from: readonly T[]) => {
  const v = query.get(name)
  return from.find((x) => x === v)
}

const resized = (f: () => void) => {
  addEventListener('resize', f)
  return () => removeEventListener('resize', f)
}

function Embed({ def, values }: { def: Definition; values: Record<string, string> }) {
  const ref = useRef<LoadmapHandle>(null)
  // a frame wider than tall keeps the diagram running across, smaller, rather than down a box it would pan in; a
  // block resized in the doc changes it
  const portrait = useSyncExternalStore(resized, () => innerHeight > innerWidth)
  const page = pageOptions(def.options)
  const listed = query
    .get('panels')
    ?.split(',')
    .filter((p): p is LoadmapPanel => (LOADMAP_PANELS as readonly string[]).includes(p))
  // the story plays once, the first time half the frame is in view: a doc scrolled past it plays nothing
  useEffect(() => {
    const root = document.querySelector('.lm')
    if (query.get('play') !== '1' || !def.model.story.length || !root) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(
      async ([e]) => {
        if (!e?.isIntersecting) return
        io.disconnect()
        await ref.current?.ready()
        ref.current?.playStory()
      },
      { threshold: 0.5 },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [def])
  return (
    <Loadmap
      ref={ref}
      model={def.model}
      view={def.view}
      {...page}
      fill
      // the doc around the frame keeps its wheel: Ctrl or ⌘ with it, a pinch or the buttons zoom
      zoom
      // an embed shows the diagram first, whatever the model's own full screen does: a frame is small for panels
      fullScreenMode={pick('mode', ['focus', 'panels'] as const) ?? 'focus'}
      fullScreen={listed?.length ? listed : page.fullScreen}
      theme={pick('theme', ['auto', 'light', 'dark'] as const) ?? 'auto'}
      initial={sharedValues(def.model, values)}
      narrowBelow={portrait ? undefined : 0}
      title={
        <>
          {def.model.title}
          <a className="embed-open" href={editor()} target="_blank" rel="noopener">
            Open ↗
          </a>
        </>
      }
    />
  )
}

/** A plain message where the link holds nothing to draw: the reason, and where to go. */
function Problem({ title, detail, fix }: { title: string; detail?: string; fix: string }) {
  return (
    <div className="embed-problem" role="alert">
      <b>{title}</b>
      {detail && <code>{detail}</code>}
      <a href={editor()} target="_blank" rel="noopener">
        {fix}
      </a>
    </div>
  )
}

async function main(el: HTMLElement) {
  const root = createRoot(el)
  const shared = await decodeShare(location.hash)
  if ('error' in shared) {
    const detail = location.hash ? `${shared.error.charAt(0).toUpperCase()}${shared.error.slice(1)}.` : undefined
    root.render(<Problem title="This link holds no loadmap model." detail={detail} fix="Make one in the editor" />)
    return
  }
  await loadCatalogFor(shared.source)
  const r = compile(shared.source)
  if (!r.ok || !r.definition) {
    const first = r.diagnostics.find((d) => d.severity === 'error') ?? r.diagnostics[0]
    const detail = first && formatDiagnostic(first, shared.source, 'embed.loadmap').split('\n')[0]
    root.render(<Problem title="This model doesn't compile." detail={detail} fix="Open it in the editor to fix it" />)
    return
  }
  root.render(<Embed def={r.definition} values={shared.values} />)
}

const el = document.getElementById('embed')
if (el) main(el)
