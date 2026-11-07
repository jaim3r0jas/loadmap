import type { FullScreenMode } from '@loadmap/react'
import { useEffect, useId, useRef, useState } from 'react'
import type { EmbedOptions, EmbedProps } from './Embed'

/** The menu's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-embed { display: grid; gap: 8px; font-size: .85rem; }
.lme-embed label { display: flex; gap: 6px; align-items: center; }
.lme-choice { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 0; border: 0; }
.lme-choice legend { float: left; margin-right: 8px; color: var(--lm-muted); }
.lme-pop-row { display: flex; gap: 8px; flex-wrap: wrap; }
.lme-pop-row > .lm-btn { flex: 1; }
.lme-made { font: .75rem var(--lm-mono); color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 4px; padding: 4px 6px; min-width: 0; }
.lme-embed small { color: var(--lm-muted); line-height: 1.4; }
`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The embed's options and buttons: loaded the first time they open, so the editor's first load lacks them. */
export default function EmbedPanel({ link, hash, title, story, onNote }: EmbedProps) {
  // the diagram first, whatever the definition's full screen does: a frame in a doc is small for the panels
  const [mode, setMode] = useState<FullScreenMode>('focus')
  const [theme, setTheme] = useState<EmbedOptions['theme']>('auto')
  const [play, setPlay] = useState(false)
  // the last link made, shown where the clipboard refuses it
  const [made, setMade] = useState('')
  const pop = useRef<HTMLDivElement>(null)
  const id = useId()
  // it opens from a menu that has closed: the keyboard goes to its first choice
  useEffect(() => pop.current?.querySelector('input')?.focus(), [])
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
    <div className="lme-embed" ref={pop}>
      <style>{CSS}</style>
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
      <span className="lme-pop-row">
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
  )
}
