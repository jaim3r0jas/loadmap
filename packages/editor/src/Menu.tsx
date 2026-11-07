import {
  type ComponentType,
  type KeyboardEvent,
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  type ToggleEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/** One thing a page adds to a menu of the bar: its name, what it does, and a line under the name. */
export interface BarItem {
  label: string
  onSelect: () => void
  hint?: string
}

/** Items under a heading: "Examples" in New, "Image" in Export. */
export interface BarSection {
  label: string
  items: readonly BarItem[]
}

/** A 16 px line icon in the text's colour. */
export function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg className={`lme-svg ${className}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const ICON = {
  down: 'M4 6l4 4 4-4',
  undo: 'M5.5 3.5l-3 3 3 3M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7',
  link: 'M6.5 9.5a2.8 2.8 0 0 0 4 0l2.3-2.3a2.8 2.8 0 0 0-4-4l-1.1 1.1M9.5 6.5a2.8 2.8 0 0 0-4 0L3.2 8.8a2.8 2.8 0 0 0 4 4l1.1-1.1',
  more: 'M2.6 8a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0M7.1 8a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0M11.6 8a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0',
} as const

/**
 * Puts a popover under what opened it, toward the side with the room; above it when it fits better there (an editor
 * low on a page); no taller than the window leaves.
 */
export function place(pop: HTMLElement, anchor: Element) {
  const a = anchor.getBoundingClientRect()
  const room = document.documentElement.clientWidth - 8
  pop.style.left = `${Math.max(8, a.left + pop.offsetWidth > room ? a.right - pop.offsetWidth : a.left)}px`
  pop.style.maxHeight = ''
  const h = pop.offsetHeight
  const below = innerHeight - a.bottom - 14
  const up = h > below && a.top - 14 > below
  const fit = up ? a.top - 14 : below
  pop.style.maxHeight = `${fit}px`
  pop.style.top = `${up ? a.top - 6 - Math.min(h, fit) : a.bottom + 6}px`
}

/**
 * A part loaded when first needed. Offline, or with its chunk gone after a new version of the site, `note` shows in
 * its place (nothing without one), rather than the error taking the editor and the reader's text with it.
 */
export function later<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, note?: string) {
  return lazy(() =>
    load().catch(() => ({ default: () => (note ? <p className="lme-hint">{note}</p> : null) as ReactNode })),
  )
}

const itemsOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('[role^="menuitem"]')]

/**
 * A button and the menu it opens, in the browser's top layer: a click outside or Escape closes it and gives the
 * keyboard back to the button. Its items are drawn only once it first opens. Enter, Space or ↓ open it on the first
 * item, ↑ on the last; inside, the arrows, Home, End and a letter move, Tab closes it and goes on.
 */
export function Menu({
  label,
  icon,
  className = '',
  title,
  children,
}: {
  /** The button's text, or with `icon` its name. */
  label: string
  icon?: ReactNode
  className?: string
  title?: string
  children: () => ReactNode
}) {
  const id = useId()
  const pop = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const last = useRef(false)
  useLayoutEffect(() => {
    const p = pop.current
    const b = button.current
    if (!open || !p || !b) return
    // placed again as its items come and grow it; a scroll of the page moves its button, and a narrow column can hide
    // it, so it closes
    const ro = new ResizeObserver(() => (b.checkVisibility() ? place(p, b) : p.hidePopover()))
    ro.observe(p)
    ro.observe(b)
    const scroll = (e: Event) => !p.contains(e.target as Node) && p.hidePopover()
    addEventListener('scroll', scroll, true)
    const stop = () => {
      ro.disconnect()
      removeEventListener('scroll', scroll, true)
    }
    // items that load later (the templates, behind a `data-wait` fallback) take the focus when they come
    const first = () => {
      if (p.querySelector('[data-wait]')) return false
      const all = itemsOf(p)
      const to = last.current ? all[all.length - 1] : all[0]
      if (!to) return false
      to.focus()
      last.current = false
      return true
    }
    if (first()) return stop
    const mo = new MutationObserver(() => first() && mo.disconnect())
    mo.observe(p, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      stop()
    }
  }, [open])
  const opener = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    last.current = e.key === 'ArrowUp'
    if (!open) pop.current?.showPopover()
  }
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = itemsOf(e.currentTarget)
    const at = all.indexOf(document.activeElement as HTMLElement)
    const n = all.length
    let to = -1
    if (e.key === 'ArrowDown') to = (at + 1) % n
    else if (e.key === 'ArrowUp') to = (at - 1 + n) % n
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = n - 1
    else if (e.key === 'Tab') e.currentTarget.hidePopover()
    else if (e.key.length === 1 && e.key !== ' ') {
      const k = e.key.toLowerCase()
      for (let i = 1; i <= n && to < 0; i++)
        if (all[(at + i) % n]?.textContent?.trim().toLowerCase().startsWith(k)) to = (at + i) % n
    }
    if (to < 0) return
    e.preventDefault()
    all[to]?.focus()
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`lm-btn ${className}`}
        aria-label={icon ? label : undefined}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onKeyDown={opener}
      >
        {icon ?? label}
        {!icon && <Icon d={ICON.down} className="lme-chev" />}
      </button>
      <div
        ref={pop}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className="lme-menu"
        onToggle={(e: ToggleEvent<HTMLDivElement>) => {
          const now = e.newState === 'open'
          if (now) setDrawn(true)
          setOpen(now)
        }}
        onKeyDown={keys}
        // a pick closes it, after the item has acted
        onClick={(e) => {
          const p = e.currentTarget
          if ((e.target as Element).closest('[role^="menuitem"]') && p.matches(':popover-open')) p.hidePopover()
        }}
      >
        {drawn && <Suspense fallback={<span data-wait />}>{children()}</Suspense>}
      </div>
    </>
  )
}

/**
 * One choice in a menu, or a row in the phone's sheet (`sheet`). With `checked` it is one of a set (the theme). The
 * hint is a second line, said after the name.
 */
export function MenuItem({
  children,
  hint,
  checked,
  sheet,
  onSelect,
}: {
  children: ReactNode
  hint?: string
  checked?: boolean
  sheet?: boolean
  onSelect: () => void
}) {
  const id = useId()
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: with `checked` its role is menuitemradio, which has it
    <button
      type="button"
      className="lme-item"
      role={sheet ? undefined : checked == null ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      // the name alone, the hint said after it
      aria-labelledby={hint ? `${id}n` : undefined}
      aria-describedby={hint ? `${id}h` : undefined}
      tabIndex={sheet ? undefined : -1}
      onClick={onSelect}
    >
      <span id={`${id}n`}>{children}</span>
      {hint && <small id={`${id}h`}>{hint}</small>}
    </button>
  )
}

/** Items under a heading, in a menu or in the sheet. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of menu items, which a <fieldset> is not
    <div role="group" aria-label={label}>
      <div className="lme-mh" aria-hidden="true">
        {label}
      </div>
      {children}
    </div>
  )
}

/** A page's items, in a menu or as rows of the sheet. */
export const barItems = (list: readonly BarItem[] | undefined, sheet?: boolean) =>
  list?.map((i) => (
    <MenuItem key={i.label} hint={i.hint} sheet={sheet} onSelect={i.onSelect}>
      {i.label}
    </MenuItem>
  ))

/** A page's sections as groups of items, in a menu or the sheet. */
export const sections = (list: readonly BarSection[] | undefined, sheet?: boolean) =>
  list?.map((s) => (
    <MenuGroup key={s.label} label={s.label}>
      {barItems(s.items, sheet)}
    </MenuGroup>
  ))

const toolsOf = (bar: Element) =>
  [...bar.querySelectorAll<HTMLElement>('button, a[href]')].filter(
    (t) => !t.closest('[popover], dialog') && t.getClientRects().length > 0,
  )

/**
 * A toolbar's one stop for Tab: the arrows, Home and End move between its controls, and Tab comes back to the last
 * one used, or the first one shown. `shape` names the controls it holds: when it changes, or the bar's width hides
 * some (a narrow column folds them into a menu), the stop is set again.
 */
export function useToolbar(bar: RefObject<HTMLElement | null>, shape: string) {
  const current = useRef<HTMLElement | null>(null)
  const stop = () => {
    const el = bar.current
    if (!el) return
    const all = toolsOf(el)
    const keep = all.find((t) => t === current.current) ?? all[0]
    for (const t of el.querySelectorAll<HTMLElement>('button, a[href]'))
      if (!t.closest('[popover], dialog')) t.tabIndex = t === keep ? 0 : -1
    // the control used last went (a narrow column folded it) with the keyboard on it: the keyboard goes to the stop
    const lost = current.current && !all.includes(current.current)
    if (lost && keep && (document.activeElement === current.current || document.activeElement === document.body)) {
      current.current = keep
      keep.focus()
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the controls change with the shape, not with every render
  useLayoutEffect(stop, [bar, shape])
  // biome-ignore lint/correctness/useExhaustiveDependencies: made once; it reads the bar as it is
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const ro = new ResizeObserver(stop)
    ro.observe(el)
    const focus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      const all = toolsOf(el)
      if (!all.includes(t)) return
      current.current = t
      for (const x of all) x.tabIndex = x === t ? 0 : -1
    }
    const key = (e: globalThis.KeyboardEvent) => {
      const all = toolsOf(el)
      const at = all.indexOf(e.target as HTMLElement)
      if (at < 0) return
      const n = all.length
      const to =
        e.key === 'ArrowRight'
          ? (at + 1) % n
          : e.key === 'ArrowLeft'
            ? (at - 1 + n) % n
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? n - 1
                : -1
      if (to < 0) return
      e.preventDefault()
      all[to]?.focus()
    }
    el.addEventListener('focusin', focus)
    el.addEventListener('keydown', key)
    return () => {
      ro.disconnect()
      el.removeEventListener('focusin', focus)
      el.removeEventListener('keydown', key)
    }
  }, [bar])
}
