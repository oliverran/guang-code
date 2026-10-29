/**
 * Evidence capture for recursive agent harnessing.
 *
 * Turns finished sessions into a directory tree a proposer reads, plus the pointer text that
 * describes it. No plugin surface: the writer is a plain function over values, so a caller that
 * already has a `Session` needs nothing mounted.
 *
 * @module @deepseek-ai/dsh-ppc-evidence
 */

export type {
  EvidenceContents,
  EvidenceMission,
  EvidenceRollout,
} from './types.ts'
export { EVIDENCE_BOUNDARY } from './types.ts'

export type { RenderBudget } from './render.ts'
export { clip, finalMessage, renderTrajectory, turnReason } from './render.ts'

export { withDeadline } from './deadline.ts'

export {
  READER_TOOLS,
  runReader,
  type ReaderOptions,
  type ReaderResult,
} from './reader.ts'

export type { EvidenceCandidate, EvidenceInput, EvidenceTree } from './tree.ts'
export {
  buildEvidence,
  delivered,
  missionFor,
  readRollout,
  summarise,
  trajectoryFile,
} from './tree.ts'
