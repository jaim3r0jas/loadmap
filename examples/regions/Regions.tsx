import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { regions } from './model'
import { view as regionsView } from './view'

/** `zoom`: the reader pans and zooms the board, and flies in to a region; `headroom={false}` leaves out the chart. */
export function Regions({
  theme,
  ref,
  view = regionsView,
  zoom,
  headroom,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  view?: typeof regionsView
  zoom?: boolean
  headroom?: boolean
}) {
  return (
    <Loadmap
      ref={ref}
      model={regions}
      view={view}
      speed={10}
      transition={0.8}
      // the overview first: each region one box, opened with a click
      closed={['eu', 'us']}
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      assumptions={[
        '1× is the busiest hour of an ordinary week, in both regions at once.',
        'A region that is lost sends every order to the other one, at once.',
      ]}
    />
  )
}
