import { Loadmap, type LoadmapHandle, type LoadmapPanel, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { checkout } from './model'
import { view } from './view'

/**
 * The docs' home page draws it filling its frame (`fill`) with no panels (`panels`): the diagram, the load and the
 * verdict alone. `zoom` is kept for the pages that pass it: a loadmap always pans and zooms now.
 */
export function Checkout({
  theme,
  ref,
  zoom,
  headroom,
  compare,
  fill,
  panels,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  zoom?: boolean
  headroom?: boolean
  compare?: boolean
  fill?: boolean
  panels?: readonly LoadmapPanel[]
}) {
  return (
    <Loadmap
      ref={ref}
      model={checkout}
      view={view}
      speed={10}
      chrome="least"
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      compare={compare}
      fill={fill}
      panels={panels}
      assumptions={['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.']}
    />
  )
}
