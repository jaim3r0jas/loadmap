import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { search } from './model'
import { view as searchView } from './view'

/** `zoom`: the reader pans and zooms the board; `headroom={false}` leaves out the chart. */
export function Search({
  theme,
  ref,
  view = searchView,
  zoom,
  headroom,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  view?: typeof searchView
  zoom?: boolean
  headroom?: boolean
}) {
  return (
    <Loadmap
      ref={ref}
      model={search}
      view={view}
      speed={10}
      transition={0.8}
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      assumptions={[
        '1× is the busiest hour of an ordinary week.',
        'A client retries a search the limiter turns away, at once.',
      ]}
    />
  )
}
