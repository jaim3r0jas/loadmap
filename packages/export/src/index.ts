import type { Values } from '@loadmap/core'
import type { LoadmapHandle } from '@loadmap/react'
import {
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny'

export interface ScriptStep {
  /** Seconds into the recording. */
  at: number
  set: Partial<Values<any>>
}

export interface FrameOptions {
  /** Pixels per scene unit. Default 2 for stills, 1 for video. */
  scale?: number
}

export interface RecordOptions extends FrameOptions {
  seconds: number
  fps?: number
  format?: 'webm' | 'mp4'
  /** Value changes during the recording, e.g. the load rising from 1× to 40×. */
  script?: readonly ScriptStep[]
  /** The sim starts over with this seed, so two recordings match frame for frame. Default 1. */
  seed?: number
  /** Seconds of sim run before the first frame, so queues and dots are already flowing. Default 2. */
  warmup?: number
  /** Called with every composed frame, e.g. to hash it. */
  onFrame?: (index: number, frame: HTMLCanvasElement) => void | Promise<void>
}

/** The board as one image: the SVG rasterised with its theme colours resolved, the dots painted on top. */
export async function composeFrame(
  handle: LoadmapHandle,
  o: FrameOptions = {},
  into?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  await handle.ready()
  const b = handle.board()!
  const scale = o.scale ?? 2
  const w = even(b.scene.width * scale)
  const h = even(b.scene.height * scale)
  const c = into ?? document.createElement('canvas')
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = getComputedStyle(b.svg).getPropertyValue('--lm-surface').trim() || '#fff'
  ctx.fillRect(0, 0, w, h)
  const img = await rasterise(b.svg, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  handle.engine.paintParticles(ctx, w / b.scene.width)
  return c
}

/** A PNG of the board as it is now. */
export async function exportPng(handle: LoadmapHandle, o: FrameOptions = {}): Promise<Blob> {
  const c = await composeFrame(handle, o)
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('loadmap: PNG failed'))), 'image/png'),
  )
}

/**
 * A video of a scenario, made frame by frame on a fixed clock: the live animation is paused, the sim advances
 * exactly 1/fps per frame, and each frame is encoded at its own timestamp. Nothing depends on how fast the machine
 * is, so the same options give the same frames.
 */
export async function recordVideo(handle: LoadmapHandle, o: RecordOptions): Promise<Blob> {
  const fps = o.fps ?? 30
  const format = o.format ?? 'webm'
  const script = [...(o.script ?? [])].sort((a, b) => a.at - b.at)
  await handle.ready()
  handle.pause()
  try {
    for (const s of script.filter((s) => s.at <= 0)) handle.setValues(s.set)
    await handle.ready()
    handle.reset(o.seed ?? 1)
    const warm = Math.round((o.warmup ?? 2) * fps)
    for (let i = 0; i < warm; i++) handle.step(1 / fps)

    const canvas = document.createElement('canvas')
    await composeFrame(handle, { scale: o.scale ?? 1 }, canvas)
    const codec = await pickCodec(format, canvas.width, canvas.height)
    const output = new Output({
      format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 })
    output.addVideoTrack(source, { frameRate: fps })
    await output.start()

    const frames = Math.round(o.seconds * fps)
    let next = script.findIndex((s) => s.at > 0)
    for (let i = 0; i < frames; i++) {
      const t = i / fps
      while (next >= 0 && next < script.length && script[next]!.at <= t) {
        handle.setValues(script[next]!.set)
        next++
      }
      // a value that changes the layout needs the new scene first
      await handle.ready()
      handle.step(1 / fps)
      await composeFrame(handle, { scale: o.scale ?? 1 }, canvas)
      await o.onFrame?.(i, canvas)
      await source.add(t, 1 / fps)
    }
    source.close()
    await output.finalize()
    const buf = (output.target as BufferTarget).buffer!
    return new Blob([buf], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
  } finally {
    handle.resume()
  }
}

/** Saves a blob through the browser's download. */
export function download(blob: Blob, name: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2)

async function pickCodec(format: 'webm' | 'mp4', width: number, height: number) {
  const options = format === 'mp4' ? (['avc', 'vp9', 'av1'] as const) : (['vp9', 'vp8', 'av1'] as const)
  for (const c of options) if (await canEncodeVideo(c, { width, height })) return c
  throw new Error(`loadmap: this browser cannot encode ${format} video`)
}

const PAINT = ['fill', 'stroke', 'color'] as const

/**
 * An SVG drawn as an image cannot see the page's CSS, so every colour that comes from a theme token is written into
 * the copy as the value the page computed.
 */
async function rasterise(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
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
    if ((out as SVGElement).style?.color) out.style.color = cs.color
  })
  const root = getComputedStyle(svg)
  copy.setAttribute('font-family', root.fontFamily)
  copy.setAttribute('color', root.color)
  copy.setAttribute('width', String(w))
  copy.setAttribute('height', String(h))
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
