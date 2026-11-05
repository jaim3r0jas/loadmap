/**
 * Playwright, loaded only to record: `check`, `fmt` and `--help` run without it, so a CI step that never draws does
 * not install a browser driver. Missing, it says how to add it.
 */
export async function playwright(load = () => import('playwright')) {
  try {
    return await load()
  } catch (err) {
    const e = err as { code?: string; message?: string }
    // Node's ESM and CommonJS codes; the name quoted either way
    if (
      (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') &&
      /['"]playwright['"]/.test(e.message ?? '')
    )
      throw new Error('loadmap record needs Playwright: npm i -D playwright, then npx playwright install chromium')
    throw err
  }
}

export type Chromium = Awaited<ReturnType<typeof playwright>>['chromium']
