import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import type { Ref } from 'react'
import { alerts } from './model'
import { view } from './view'

export function Alerts({ theme, ref }: { theme?: Theme; ref?: Ref<LoadmapHandle> }) {
  return (
    <Loadmap
      ref={ref}
      model={alerts}
      view={view}
      speed={10}
      fullScreen={['verdict', 'live', 'limits', 'controls', 'headroom']}
      fullScreenMode="panels"
      theme={theme}
      assumptions={[
        'Load scales linearly with users; 1× is the busiest five minutes of an ordinary week.',
        'Alerts come first at every hop: their own topic, their own pods, served before positions.',
      ]}
    />
  )
}
