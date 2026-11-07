/**
 * Watches a board's dots canvas. The function it returns says whether the canvas has a pixel for each of the screen's
 * (its size × the pixel ratio, to the pixel: any other size and the browser stretches the dots and blurs them), and
 * whether the last dot it painted at its present size is round on the screen, as large across as down.
 */
export function watchDots(canvas: HTMLCanvasElement): () => { pixels: boolean; round: boolean } {
  const ctx = canvas.getContext('2d')!
  const arc = ctx.arc
  let last: { t: DOMMatrix; width: number; height: number } | null = null
  ctx.arc = (...a: Parameters<CanvasRenderingContext2D['arc']>) => {
    last = { t: ctx.getTransform(), width: canvas.width, height: canvas.height }
    arc.apply(ctx, a)
  }
  return () => {
    const r = canvas.getBoundingClientRect()
    const dpr = devicePixelRatio
    const pixels = Math.abs(canvas.width - r.width * dpr) <= 1 && Math.abs(canvas.height - r.height * dpr) <= 1
    // a dot painted before the canvas took its size says nothing of it
    const l = last as typeof last
    const m = l && l.width === canvas.width && l.height === canvas.height ? l.t : null
    // the dot's scale on the screen, each way: its transform, then the canvas stretched to its box
    const round =
      !!m &&
      m.b === 0 &&
      m.c === 0 &&
      Math.abs((m.a * r.width * canvas.height) / (m.d * r.height * canvas.width) - 1) < 0.01
    return { pixels, round }
  }
}
