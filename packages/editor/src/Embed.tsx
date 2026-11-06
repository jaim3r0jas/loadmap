import type { FullScreenMode } from '@loadmap/react'
import { lazy, Suspense, useRef, useState } from 'react'

/** What an embed shows: the diagram (focus) or the panels too, its theme, and whether it plays the story. */
export interface EmbedOptions {
  mode: FullScreenMode
  theme: 'auto' | 'light' | 'dark'
  /** Plays the story once, when the frame comes into view. */
  play: boolean
}

export interface EmbedProps {
  link: (hash: string, o: EmbedOptions) => string
  hash: () => Promise<string>
  title: string
  /** The definition has a story to play. */
  story: boolean
  /** A narrow bar: the button says "Embed". */
  short?: boolean
  onNote: (note: string) => void
}

const Panel = lazy(() => import('./EmbedPanel'))

/**
 * "Copy embed link": a menu beside "Share link" that copies a link to a page framing this definition, or the
 * `<iframe>` that frames it, with the options the page reads. The link carries the whole definition, as a share link
 * does: anyone who can open the page it is pasted in can read it. Its options load when it first opens.
 */
export function Embed({ short, ...props }: EmbedProps) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [opened, setOpened] = useState(false)
  return (
    <details
      className="lme-embed"
      ref={menu}
      onToggle={(e) => {
        const d = e.currentTarget
        if (!d.open) return
        setOpened(true)
        const pop = d.querySelector<HTMLElement>('.lme-pop')
        if (pop) import('./EmbedPanel').then((m) => m.place(pop))
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !menu.current?.open) return
        menu.current.open = false
        menu.current.querySelector('summary')?.focus()
      }}
    >
      <summary className="lm-btn">{short ? 'Embed' : 'Copy embed link'}</summary>
      {opened && (
        <Suspense fallback={null}>
          <Panel {...props} />
        </Suspense>
      )}
    </details>
  )
}
