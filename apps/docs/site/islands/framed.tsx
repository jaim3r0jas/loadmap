// An embed, live: checkout's .loadmap in a share link, framed as another page would frame it, with the HTML that
// does it. The link is made here, from the example's text, so it never goes stale.
import { encodeShare } from '@loadmap/dsl'
import { checkoutSource } from '@loadmap/example-checkout'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function Framed({ root }: { root: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    // absolute, as the reader would paste it into another page
    encodeShare(checkoutSource).then((hash) => setSrc(new URL(`${root}embed/#${hash}`, location.href).href))
  }, [root])
  if (!src) return null
  const html = `<iframe src="${src}" title="Checkout pipeline" width="100%" height="440" style="border: 0" loading="lazy" allow="fullscreen"></iframe>`
  return (
    <>
      <iframe src={src} title="Checkout pipeline" width="100%" height="440" style={{ border: 0 }} allow="fullscreen" />
      <details>
        <summary>The HTML</summary>
        <pre className="code">
          <code>{html}</code>
        </pre>
      </details>
    </>
  )
}

export function mount(el: HTMLElement) {
  createRoot(el).render(<Framed root={el.dataset.root ?? '../'} />)
}
