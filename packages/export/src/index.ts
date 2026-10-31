import type { Values } from '@loadmap/core'
import type { LoadmapHandle } from '@loadmap/react'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
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
  /** A fixed frame size: the board is scaled to fit and centred. A video keeps its first frame's size. */
  size?: { width: number; height: number }
}

export interface RecordOptions extends FrameOptions {
  seconds: number
  /** Default 30 for video, 15 for GIF. A GIF takes at most 50: its frame delays are whole hundredths. */
  fps?: number
  format?: 'webm' | 'mp4' | 'gif'
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
  const w = o.size?.width ?? even(b.scene.width * (o.scale ?? 2))
  const h = o.size?.height ?? even(b.scene.height * (o.scale ?? 2))
  const scale = Math.min(w / b.scene.width, h / b.scene.height)
  const dw = b.scene.width * scale
  const dh = b.scene.height * scale
  const c = into ?? document.createElement('canvas')
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = getComputedStyle(b.svg).getPropertyValue('--lm-surface').trim() || '#fff'
  ctx.fillRect(0, 0, w, h)
  const img = await rasterise(b.svg, Math.round(dw), Math.round(dh))
  ctx.translate((w - dw) / 2, (h - dh) / 2)
  ctx.drawImage(img, 0, 0, dw, dh)
  handle.engine.paintParticles(ctx, scale)
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
 * A video or GIF of a scenario, made frame by frame on a fixed clock: the live animation is paused, the sim advances
 * exactly 1/fps per frame, and each frame is encoded at its own timestamp. Nothing depends on how fast the machine
 * is, so the same options give the same frames. The values the script changed are put back afterwards.
 */
export async function recordVideo(handle: LoadmapHandle, o: RecordOptions): Promise<Blob> {
  const format = o.format ?? 'webm'
  const fps = o.fps ?? (format === 'gif' ? 15 : 30)
  if (!(fps > 0) || !(o.seconds > 0)) throw new Error('loadmap: seconds and fps must be positive')
  if (format === 'gif' && fps > 50) throw new Error('loadmap: a GIF plays at most 50 frames a second')
  const script = [...(o.script ?? [])].sort((a, b) => a.at - b.at)
  await handle.ready()
  const before = handle.values()
  handle.pause()
  try {
    for (const s of script.filter((s) => s.at <= 0)) handle.setValues(s.set)
    await warmUp(handle, o.seed ?? 1, o.warmup ?? 2, fps)

    const canvas = document.createElement('canvas')
    // a GIF reads every frame back: ask for a canvas kept in memory before anything draws on it
    if (format === 'gif') canvas.getContext('2d', { willReadFrequently: true })
    await composeFrame(handle, { scale: o.scale ?? 1 }, canvas)
    const sink = format === 'gif' ? gifSink(canvas, fps) : await videoSink(canvas, format, fps)

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
      await composeFrame(handle, { size: { width: canvas.width, height: canvas.height } }, canvas)
      await o.onFrame?.(i, canvas)
      await sink.add(t)
    }
    return await sink.finish()
  } finally {
    handle.setValues(before)
    handle.resume()
  }
}

/** A PNG of the board after `set` and a warm-up on a fixed clock: the same options give the same picture. */
export async function recordStill(
  handle: LoadmapHandle,
  o: FrameOptions & { set?: Partial<Values<any>>; seed?: number; warmup?: number } = {},
): Promise<Blob> {
  await handle.ready()
  const before = handle.values()
  handle.pause()
  try {
    if (o.set) handle.setValues(o.set)
    await warmUp(handle, o.seed ?? 1, o.warmup ?? 4, 30)
    return await exportPng(handle, o)
  } finally {
    handle.setValues(before)
    handle.resume()
  }
}

declare global {
  var __loadmap: Record<string, PageRecorder> | undefined
}

/** What `expose` puts on the page for `loadmap record`: results come back base64-encoded. */
export interface PageRecorder {
  record(o: RecordOptions): Promise<string>
  still(o: Parameters<typeof recordStill>[1]): Promise<string>
}

/**
 * Lets `loadmap record` drive this loadmap: puts a recorder on `globalThis.__loadmap[name]`.
 * Returns a function that takes it off again.
 */
export function expose(handle: LoadmapHandle, name = 'default'): () => void {
  const recorder: PageRecorder = {
    record: async (o) => base64(await recordVideo(handle, o)),
    still: async (o) => base64(await recordStill(handle, o)),
  }
  globalThis.__loadmap ??= {}
  globalThis.__loadmap[name] = recorder
  return () => {
    if (globalThis.__loadmap?.[name] === recorder) delete globalThis.__loadmap[name]
  }
}

async function warmUp(handle: LoadmapHandle, seed: number, seconds: number, fps: number) {
  await handle.ready()
  handle.reset(seed)
  for (let i = 0, n = Math.round(seconds * fps); i < n; i++) handle.step(1 / fps)
}

interface Sink {
  add(t: number): Promise<void>
  finish(): Promise<Blob>
}

async function videoSink(canvas: HTMLCanvasElement, format: 'webm' | 'mp4', fps: number): Promise<Sink> {
  const codec = await pickCodec(format, canvas.width, canvas.height)
  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()
  return {
    add: (t) => source.add(t, 1 / fps),
    finish: async () => {
      source.close()
      await output.finalize()
      const buf = (output.target as BufferTarget).buffer!
      return new Blob([buf], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
    },
  }
}

/** A GIF with a palette per frame, so flow colours stay true; pure JavaScript, so its bytes are reproducible. */
function gifSink(canvas: HTMLCanvasElement, fps: number): Sink {
  const gif = GIFEncoder()
  const ctx = canvas.getContext('2d')!
  // delays are whole hundredths: frame i lasts from round(100 i / fps) to round(100 (i + 1) / fps), so the GIF's
  // length matches the seconds asked for
  const cs = (i: number) => Math.round((100 * i) / fps)
  let i = 0
  return {
    add: async () => {
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const palette = quantize(data, 256)
      const delay = 10 * (cs(i + 1) - cs(i))
      i++
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 })
    },
    finish: async () => {
      gif.finish()
      return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' })
    },
  }
}

async function base64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
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
