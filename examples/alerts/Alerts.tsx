import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { alerts } from './model'
import { view as alertsView } from './view'

/** `zoom`: the reader pans and zooms the board; `headroom={false}` leaves out the chart. */
export function Alerts({
  theme,
  ref,
  view = alertsView,
  zoom,
  headroom,
}: {
  theme?: Theme
  ref?: Ref<LoadmapHandle>
  view?: typeof alertsView
  zoom?: boolean
  headroom?: boolean
}) {
  return (
    <Loadmap
      ref={ref}
      model={alerts}
      view={view}
      speed={10}
      transition={1}
      fullScreen={['verdict', 'live', 'limits', 'controls', 'headroom']}
      fullScreenMode="panels"
      theme={theme}
      zoom={zoom}
      headroom={headroom}
      assumptions={[
        'Load scales linearly with users; 1× is the busiest five minutes of an ordinary week.',
        'Alerts come first at every hop: their own topic, their own pods, served before positions.',
      ]}
    />
  )
}
