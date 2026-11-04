// Media that stands alone: a caption around the board, the board as SVG, and a poster with the limits.
import { type CrossingRange, compare, parseAsOf } from '@loadmap/core'
import { fmt, monthOf, multiple, multiples, pct } from '@loadmap/core/format'
import type { LoadmapHandle } from '@loadmap/react'

/** A title line above the board and the verdict below it, so a frame says what it shows without the page. */
export interface Caption {
  /** Default: the model's title. */
  title?: string
  /** Said below the board instead of the verdict: a story step's text. */
  text?: string
  /** Before the scenario and the load: "2 of 3". */
  step?: string
}

export const captionOf = (c: boolean | Caption | undefined): Caption | null => (c === true ? {} : c ? c : null)

/** The caption's bands for a frame this wide: fixed heights (three verdict lines), so a video keeps its size. */
export function bands(width: number) {
  const u = Math.max(1, width / 900)
  return { u, top: Math.round(44 * u), bottom: Math.round(84 * u) }
}

/** The theme as the page computed it: canvas and serialised SVG cannot read CSS variables. */
export function tokens(el: Element) {
  const cs = getComputedStyle(el)
  const t = (k: string, fallback: string) => cs.getPropertyValue(`--lm-${k}`).trim() || fallback
  return {
    font: cs.fontFamily || 'sans-serif',
    mono: t('mono', 'monospace'),
    bg: t('bg', '#eef2f5'),
    surface: t('surface', '#ffffff'),
    fg: t('fg', '#17212b'),
    muted: t('muted', '#5d6d7c'),
    line: t('line', '#c6d0da'),
    ok: t('ok', '#2a7f5a'),
    warn: t('warn', '#b86e00'),
    drop: t('drop', '#b7392e'),
    series: [1, 2, 3, 4].map((i) => t(`s${i}`, '#5d6d7c')),
  }
}
type Tokens = ReturnType<typeof tokens>

const tierColor = (k: Tokens, tier: string) => (tier === 'over' ? k.drop : tier === 'warn' ? k.warn : k.ok)

/** What the caption says: the title, the scenario and load, and the verdict. */
export function captionText(handle: LoadmapHandle, c: Caption) {
  const { model, ev } = handle.engine
  const scenario = model.scenarioOf(ev.values)
  return {
    title: c.title ?? model.title ?? '',
    where: [c.step, scenario?.label, `${fmt(ev.values.load)}× today`].filter(Boolean).join(' · '),
    verdict: c.text ?? ev.verdict.text,
    tier: ev.verdict.tier,
  }
}

/** Lines of at most `width`, broken at spaces; past `max` lines the last ends in "…". */
export function wrap(measure: (s: string) => number, text: string, width: number, max = Infinity): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (!line || measure(next) <= width) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= max) return lines
  const keep = lines.slice(0, max)
  let last = keep[max - 1]!
  while (last && measure(`${last}…`) > width) last = last.slice(0, -1)
  keep[max - 1] = `${last.trimEnd()}…`
  return keep
}

/** Draws the caption's bands onto a frame of `w` × `h`. */
export function drawCaption(ctx: CanvasRenderingContext2D, handle: LoadmapHandle, c: Caption, w: number, h: number) {
  const k = tokens(handle.board()!.svg)
  const { u, top, bottom } = bands(w)
  const t = captionText(handle, c)
  const pad = 14 * u
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = k.line
  ctx.fillRect(0, top - u, w, u)
  ctx.fillRect(0, h - bottom, w, u)
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${13 * u}px ${k.font}`
  ctx.fillStyle = k.muted
  ctx.textAlign = 'right'
  ctx.fillText(t.where, w - pad, top / 2)
  const whereW = ctx.measureText(t.where).width
  ctx.font = `600 ${16 * u}px ${k.font}`
  ctx.fillStyle = k.fg
  ctx.textAlign = 'left'
  ctx.fillText(t.title, pad, top / 2, Math.max(0, w - 3 * pad - whereW))
  ctx.fillStyle = tierColor(k, t.tier)
  ctx.fillRect(pad, h - bottom + 12 * u, 4 * u, bottom - 24 * u)
  ctx.font = `400 ${14 * u}px ${k.font}`
  ctx.fillStyle = k.fg
  ctx.textBaseline = 'top'
  const lines = wrap((s) => ctx.measureText(s).width, t.verdict, w - 2 * pad - 14 * u, 3)
  lines.forEach((l, i) => {
    ctx.fillText(l, pad + 14 * u, h - bottom + (14 + i * 20) * u)
  })
  ctx.restore()
}

const PAINT = ['fill', 'stroke', 'color'] as const

/**
 * A copy of the board's SVG that needs no page: every colour that comes from a theme token is written in as the value
 * the page computed, and the font, size and namespace are set on the root.
 */
export function standalone(svg: SVGSVGElement, w: number, h: number): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...svg.querySelectorAll('*')]
  const dst = [copy, ...copy.querySelectorAll('*')]
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const out = dst[i] as SVGElement
    for (const p of PAINT) {
      const a = out.getAttribute(p)
      if (a && (a.includes('var(') || a === 'currentColor')) out.setAttribute(p, cs.getPropertyValue(p))
    }
    if (out.style?.color) out.style.color = cs.color
    // what the page adds for readers has no place in a file
    for (const a of ['tabindex', 'aria-describedby', 'class']) out.removeAttribute(a)
  })
  const root = getComputedStyle(svg)
  copy.setAttribute('font-family', root.fontFamily)
  copy.setAttribute('color', root.color)
  copy.setAttribute('width', String(w))
  copy.setAttribute('height', String(h))
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return copy
}

const NS = 'http://www.w3.org/2000/svg'
function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  if (text != null) e.textContent = text
  return e
}

/**
 * The board as an SVG file: the structure as drawn, the dots where they are now, and with `caption` the title line
 * and the verdict. Text goes in as text nodes, never as markup, so a label cannot break the file.
 */
export async function exportSvg(handle: LoadmapHandle, o: { caption?: boolean | Caption } = {}): Promise<string> {
  await handle.ready()
  const b = handle.board()!
  const { width: sw, height: sh } = b.scene
  const board = standalone(b.svg, sw, sh)
  const dots = el('g', {})
  for (const d of handle.engine.dots())
    dots.appendChild(
      el(
        'circle',
        d.ring
          ? {
              cx: d.x.toFixed(2),
              cy: d.y.toFixed(2),
              r: d.r - d.ring / 2,
              fill: 'none',
              stroke: d.color,
              'stroke-width': d.ring,
              ...(d.alpha < 1 ? { 'stroke-opacity': d.alpha.toFixed(3) } : {}),
            }
          : {
              cx: d.x.toFixed(2),
              cy: d.y.toFixed(2),
              r: d.r,
              fill: d.color,
              ...(d.alpha < 1 ? { 'fill-opacity': d.alpha.toFixed(3) } : {}),
            },
      ),
    )
  board.appendChild(dots)
  const cap = captionOf(o.caption)
  if (!cap) return new XMLSerializer().serializeToString(board)

  const k = tokens(b.svg)
  const { top, bottom } = bands(sw)
  const h = sh + top + bottom
  const t = captionText(handle, cap)
  const out = el('svg', { xmlns: NS, width: sw, height: h, viewBox: `0 0 ${sw} ${h}`, 'font-family': k.font })
  out.appendChild(el('rect', { width: sw, height: h, fill: k.surface }))
  out.appendChild(el('text', { x: 14, y: top / 2 + 5, 'font-size': 16, 'font-weight': 600, fill: k.fg }, t.title))
  out.appendChild(
    el('text', { x: sw - 14, y: top / 2 + 5, 'font-size': 13, 'text-anchor': 'end', fill: k.muted }, t.where),
  )
  out.appendChild(el('rect', { x: 0, y: top - 1, width: sw, height: 1, fill: k.line }))
  board.setAttribute('y', String(top))
  out.appendChild(board)
  out.appendChild(el('rect', { x: 0, y: top + sh, width: sw, height: 1, fill: k.line }))
  out.appendChild(el('rect', { x: 14, y: top + sh + 12, width: 4, height: bottom - 24, fill: tierColor(k, t.tier) }))
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = `400 14px ${k.font}`
  wrap((s) => ctx.measureText(s).width, t.verdict, sw - 42, 3).forEach((line, i) => {
    out.appendChild(el('text', { x: 28, y: top + sh + 28 + i * 20, 'font-size': 14, fill: k.fg }, line))
  })
  return new XMLSerializer().serializeToString(out)
}

/**
 * One picture that answers the question on its own: the title, the scenario and load, the board, the verdict, where
 * each component runs out (with dates, given growth), the scenarios compared, and which capacities are estimates.
 * `scale` is pixels per CSS pixel (default 2).
 */
/** The poster's width and the board's place in it, in CSS pixels: one source for the board image and the drawing. */
export function posterLayout(scene: { width: number; height: number }) {
  const W = Math.max(720, Math.min(1400, scene.width + 48))
  const pad = 24
  const inner = W - 2 * pad
  return { W, pad, inner, boardH: (scene.height * inner) / scene.width }
}

export async function drawPoster(
  handle: LoadmapHandle,
  image: CanvasImageSource,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const b = handle.board()!
  const { model, ev } = handle.engine
  const k = tokens(b.svg)
  const { W, pad, inner, boardH } = posterLayout(b.scene)
  const date = (x: number | null) => {
    const d = model.dateAt(x)
    return d ? ` (${monthOf(d, true)})` : ''
  }
  // a range with the date of its pessimistic edge: when it may already happen
  const at = (r: CrossingRange | null, x: number | null) =>
    r ? `${multiples(r, model.searchMax, true)}${date(r.low)}` : `${multiple(x, model.searchMax)}${date(x)}`
  const t = captionText(handle, {})
  const g = model.growth
  const sub = [t.where, g && `load grows ${fmt(g.rate * 100)} % a ${g.per} from ${monthOf(parseAsOf(g.asOf)!)}`]
    .filter(Boolean)
    .join(' · ')
  const rows = model.scenarios.length > 1 ? compare(model, ev.values.load) : null
  const estimates = ev.assumptions.flatMap((a) =>
    a.kind === 'capacity' && a.capacity.provenance === 'estimated' ? [a.name] : [],
  )

  const measure = document.createElement('canvas').getContext('2d')!
  const font = (weight: number, size: number, mono = false) => `${weight} ${size}px ${mono ? k.mono : k.font}`
  const lines = (text: string, f: string, width: number) => {
    measure.font = f
    return wrap((s) => measure.measureText(s).width, text, width)
  }
  const verdict = lines(t.verdict, font(400, 15), inner - 20)
  const hint = ev.measure ? lines(ev.measure.text, font(400, 13), inner - 20) : []
  const compared = rows ? lines(rows.text, font(400, 14), inner) : []

  // every block as [height, draw]: laid out once to size the canvas, then drawn
  const blocks: [number, (ctx: CanvasRenderingContext2D, y: number) => void][] = []
  const text = (
    ctx: CanvasRenderingContext2D,
    s: string,
    x: number,
    y: number,
    f: string,
    color: string,
    align: CanvasTextAlign = 'left',
  ) => {
    ctx.font = f
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
  }
  const heading = (s: string) =>
    blocks.push([30, (ctx, y) => text(ctx, s.toUpperCase(), pad, y + 20, font(600, 11), k.muted)])

  blocks.push([34, (ctx, y) => text(ctx, t.title, pad, y + 26, font(600, 22), k.fg)])
  blocks.push([26, (ctx, y) => text(ctx, sub, pad, y + 16, font(400, 13), k.muted)])
  blocks.push([
    boardH + 16,
    (ctx, y) => {
      ctx.fillStyle = k.line
      ctx.fillRect(pad - 1, y + 7, inner + 2, boardH + 2)
      ctx.drawImage(image, pad, y + 8, inner, boardH)
    },
  ])
  blocks.push([
    verdict.length * 22 + 20,
    (ctx, y) => {
      ctx.fillStyle = tierColor(k, t.tier)
      ctx.fillRect(pad, y + 6, 4, verdict.length * 22 + 8)
      verdict.forEach((l, i) => {
        text(ctx, l, pad + 16, y + 24 + i * 22, font(400, 15), k.fg)
      })
    },
  ])
  if (hint.length)
    blocks.push([
      hint.length * 18 + 6,
      (ctx, y) => {
        hint.forEach((l, i) => {
          text(ctx, l, pad + 16, y + 14 + i * 18, font(400, 13), k.muted)
        })
      },
    ])
  heading('Where it runs out, in order')
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  blocks.push([
    16,
    (ctx, y) => {
      const th = model.thresholds
      text(ctx, '0', pad, y + 10, font(400, 11, true), k.muted)
      text(
        ctx,
        `${pct(th.target)} target`,
        pad + (inner * th.target) / top,
        y + 10,
        font(400, 11, true),
        k.muted,
        'center',
      )
      text(ctx, pct(th.full), pad + (inner * th.full) / top, y + 10, font(400, 11, true), k.muted, 'center')
      text(ctx, pct(top), W - pad, y + 10, font(400, 11, true), k.muted, 'right')
    },
  ])
  for (const c of ev.ranked)
    blocks.push([
      46,
      (ctx, y) => {
        const first = c === ev.firstLimit ? ' · first limit' : ''
        text(ctx, `${c.name}${first}`, pad, y + 16, font(600, 14), k.fg)
        const right =
          c.util == null
            ? 'switched off'
            : `${pct(c.util)} now · ${pct(model.thresholds.target)} at ${at(c.targetRange, c.target)} · ${pct(model.thresholds.full)} at ${at(c.fullRange, c.full)}`
        text(ctx, right, W - pad, y + 16, font(400, 12, true), k.muted, 'right')
        ctx.fillStyle = k.bg
        ctx.fillRect(pad, y + 24, inner, 10)
        ctx.fillStyle = c.state === 'over' ? k.drop : c.state === 'warn' ? k.warn : k.ok
        ctx.fillRect(pad, y + 24, (inner * Math.min(top, c.util ?? 0)) / top, 10)
        ctx.fillStyle = k.fg
        for (const th of [model.thresholds.target, model.thresholds.full])
          ctx.fillRect(pad + (inner * th) / top, y + 22, 1, 14)
      },
    ])
  if (rows) {
    heading('Scenarios compared')
    blocks.push([
      compared.length * 20 + 6,
      (ctx, y) => {
        compared.forEach((l, i) => {
          text(ctx, l, pad, y + 15 + i * 20, font(400, 14), k.fg)
        })
      },
    ])
    rows.rows.forEach((r, i) => {
      blocks.push([
        26,
        (ctx, y) => {
          ctx.fillStyle = k.series[i] ?? k.muted
          ctx.beginPath()
          ctx.arc(pad + 5, y + 13, 5, 0, Math.PI * 2)
          ctx.fill()
          text(ctx, r.label, pad + 18, y + 18, font(600, 14), k.fg)
          const what = `first limit ${r.firstLimit?.name ?? '—'} · ${pct(model.thresholds.target)} at ${at(r.targetRange, r.target)} · runs out at ${at(r.fullRange, r.full)}`
          text(ctx, what, W - pad, y + 18, font(400, 12, true), k.muted, 'right')
        },
      ])
    })
  }
  if (estimates.length)
    blocks.push([
      30,
      (ctx, y) => text(ctx, `Estimated capacities: ${estimates.join(', ')}.`, pad, y + 22, font(400, 12), k.muted),
    ])

  const H = Math.ceil(blocks.reduce((a, [h]) => a + h, 0) + 2 * pad)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(H * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = k.surface
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'
  let y = pad
  for (const [h, draw] of blocks) {
    draw(ctx, y)
    y += h
  }
  return canvas
}
