/**
 * The propose stage of the Propose–Probe–Compose loop: fresh editor sessions that rewrite a
 * staged harness copy in place.
 * @module @deepseek-ai/dsh-ppc-propose
 */

export {
  DIMENSION_PROMPTS,
  extractNotes,
  isKeepBase,
  type Proposal,
  type ProposalDimension,
} from './types.ts'

export {
  EDITOR_TOOLS,
  editorTurnReason,
  runEditor,
  stagedHarnessDir,
  workspacePath,
  type EditorOptions,
} from './editor.ts'
