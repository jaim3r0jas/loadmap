import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { checkout } from './model'
import { view } from './view'

/** `zoom`: the reader pans and zooms the board; `headroom={false}` leaves out the chart (the docs' landing page). */
export function Checkout({
  theme,
  ref,
  zoom,
  headroom,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  zoom?: boolean
  headroom?: boolean
}) {
  return (
    <Loadmap
      ref={ref}
      model={checkout}
      view={view}
      speed={10}
      fullScreenMode="focus"
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      assumptions={['Load scales linearly with users; 1× is the 5-minute peak of an ordinary day.']}
    />
  )
}
