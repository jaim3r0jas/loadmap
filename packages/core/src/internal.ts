// For loadmap's own packages (the dsl): no promise of stability between versions

export { blame, flowOf, propOf } from './blame'

/** The losses a stage can have, which a lost box may take (`rejected`, `dropped`, `timedOut`). */
export { lossesIn, waysOf } from './losses'
/** "3 brokers", "acks all": a catalog condition as the editor and hover show it. */
export { conditionText } from './published'
