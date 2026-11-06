import type { FullScreenMode } from '@loadmap/react'
import { useId, useRef, useState } from 'react'

/** What an embed shows: the diagram (focus) or the panels too, its theme, and whether it plays the story. */
export interface EmbedOptions {
  mode: FullScreenMode
  theme: 'auto' | 'light' | 'dark'
  /** Plays the story once, when the frame comes into view. */
  play: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * "Copy embed link": a menu beside "Share link" that copies a link to a page framing this definition, or the
 * `<iframe>` that frames it, with the options the page reads. The link carries the whole definition, as a share link
 * does: anyone who can open the page it is pasted in can read it.
 */
export function Embed({
  link,
  hash,
  title,
  story,
  short,
  onNote,
}: {
  link: (hash: string, o: EmbedOptions) => string
  hash: () => Promise<string>
  title: string
  /** The definition has a story to play. */
  story: boolean
  /** A narrow bar: the button says "Embed". */
  short?: boolean
  onNote: (note: string) => void
}) {
  // the diagram first, whatever the definition's full screen does: a frame in a doc is small for the panels
  const [mode, setMode] = useState<FullScreenMode>('focus')
  const [theme, setTheme] = useState<EmbedOptions['theme']>('auto')
  const [play, setPlay] = useState(false)
  // the last link made, shown where the clipboard refuses it
  const [made, setMade] = useState('')
  const menu = useRef<HTMLDetailsElement>(null)
  const id = useId()
  const copy = async (what: 'link' | 'iframe') => {
    const url = link(await hash(), { mode, theme, play: story && play })
    const text =
      what === 'link'
        ? url
        : `<iframe src="${esc(url)}" title="${esc(title)}" width="100%" height="480" style="border: 0" loading="lazy" allow="fullscreen"></iframe>`
    setMade(text)
    try {
      await navigator.clipboard.writeText(text)
      onNote(what === 'link' ? 'Embed link copied' : 'Embed code copied')
    } catch {
      onNote('Copy it from the box')
    }
  }
  const choice = <T extends string>(name: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <fieldset className="lme-choice">
      <legend>{name}</legend>
      {options.map(([v, label]) => (
        <label key={v}>
          <input type="radio" name={`${id}-${name}`} checked={value === v} onChange={() => set(v)} />
          {label}
        </label>
      ))}
    </fieldset>
  )
  return (
    <details
      className="lme-embed"
      ref={menu}
      // it opens under the button, toward the side with the room: the button often ends the bar
      onToggle={(e) => {
        const d = e.currentTarget
        const pop = d.querySelector<HTMLElement>('.lme-pop')
        if (!d.open || !pop) return
        pop.removeAttribute('data-end')
        if (pop.getBoundingClientRect().right > document.documentElement.clientWidth) pop.setAttribute('data-end', '')
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !menu.current?.open) return
        menu.current.open = false
        menu.current.querySelector('summary')?.focus()
      }}
    >
      <summary className="lm-btn">{short ? 'Embed' : 'Copy embed link'}</summary>
      <div className="lme-pop">
        <b>Embed in ClickUp or any page</b>
        {choice('Show', mode, setMode, [
          ['focus', 'Diagram'],
          ['panels', 'With panels'],
        ])}
        {choice('Theme', theme, setTheme, [
          ['auto', 'Auto'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ])}
        {story && (
          <label>
            <input type="checkbox" checked={play} onChange={(e) => setPlay(e.target.checked)} /> Play the story when it
            comes into view
          </label>
        )}
        <span className="lme-row">
          <button type="button" className="lm-btn" onClick={() => copy('link')}>
            Copy link
          </button>
          <button type="button" className="lm-btn" onClick={() => copy('iframe')}>
            Copy &lt;iframe&gt;
          </button>
        </span>
        {made && (
          <input className="lme-made" readOnly value={made} aria-label="Embed" onFocus={(e) => e.target.select()} />
        )}
        <small>
          In ClickUp: type /embed and paste the link. The model travels in the link: anyone who can open the page it is
          pasted in can read it.
        </small>
      </div>
    </details>
  )
}
