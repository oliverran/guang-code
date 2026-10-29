/**
 * The compose stage of the Propose–Probe–Compose loop: an anonymous selector that picks
 * one candidate output.
 * @module @deepseek-ai/dsh-ppc-compose
 */

export {
  anonId,
  buildPool,
  entryFor,
  type PoolEntry,
} from './anonymity.ts'

export {
  writePool,
  type DroppedCandidate,
  type PoolCandidate,
  type PoolOptions,
  type SelectionPool,
} from './pool.ts'

export {
  namedChoice,
  parseChoice,
  type ParsedChoice,
} from './choice.ts'

export {
  SELECT_BOUNDARY,
  selectMission,
} from './prompt.ts'

export {
  runSelector,
  SELECTOR_TOOLS,
  type SelectorOptions,
  type SelectorResult,
} from './selector.ts'

export {
  compose,
  type ComposeOptions,
  type ComposeResult,
} from './compose.ts'
