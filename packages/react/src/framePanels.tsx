import type { ReactNode } from 'react'
import { Legend } from './Diagram'
import type { FramePanel } from './frame'
import { Assumptions, Controls, Limits, Meters, Verdict } from './panels'
import { Compare, HeadroomChart } from './scenarios'
import type { LoadmapController } from './useLoadmap'

/**
 * What a frame's panel holds, whole: put together with the first panel a reader opens.
 */
export function FramePanelBody({
  lm,
  id,
  assumptions,
  compare = true,
}: {
  lm: LoadmapController
  id: FramePanel
  assumptions?: readonly ReactNode[]
  compare?: boolean
}) {
  switch (id) {
    case 'limits':
      return (
        <>
          <Verdict lm={lm} />
          <Limits lm={lm} />
        </>
      )
    case 'controls':
      return <Controls lm={lm} load={false} />
    case 'headroom':
      return (
        <>
          <HeadroomChart lm={lm} />
          {compare && lm.model.scenarios.length > 1 && <Compare lm={lm} />}
        </>
      )
    case 'live':
      return (
        <>
          <Meters lm={lm} />
          {/* whole here: the bar shows what fits its one row */}
          <Legend lm={lm} />
        </>
      )
    case 'assumptions':
      return <Assumptions lm={lm} extra={assumptions ? [...assumptions] : []} />
  }
}
