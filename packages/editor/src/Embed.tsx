import type { FullScreenMode } from '@loadmap/react'
import { type Ref, Suspense, useImperativeHandle, useRef, useState } from 'react'
import { later, place } from './Menu'

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
  onNote: (note: string) => void
}

export interface EmbedHandle {
  /** Opens the options under what asked for them. */
  show(anchor: Element): void
}

const Panel = later(() => import('./EmbedPanel'), 'The embed’s options did not load: reload the page.')

/**
 * "Embed in a page…": the options for a link to a page framing this definition, or the `<iframe>` that frames it, in
 * a popover under Share. The link carries the whole definition, as a share link does: anyone who can open the page it
 * is pasted in can read it. Its options load when it first opens.
 */
export function Embed({ ref, ...props }: EmbedProps & { ref: Ref<EmbedHandle> }) {
  const pop = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  useImperativeHandle(ref, () => ({
    show(anchor) {
      const p = pop.current
      if (!p) return
      setDrawn(true)
      p.showPopover()
      place(p, anchor)
      // opened again: its options are there already, the keyboard goes to the first (the first time, they take it)
      p.querySelector('input')?.focus()
    },
  }))
  return (
    <div ref={pop} popover="auto" role="dialog" aria-label="Embed in a page" className="lme-pop">
      {drawn && (
        <Suspense fallback={null}>
          <Panel {...props} />
        </Suspense>
      )}
    </div>
  )
}
