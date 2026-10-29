/**
 * The DSH editable surface: which paths a proposal may write, and what the runtime requires
 * of the files it writes.
 * @module @deepseek-ai/dsh-ppc-surface
 */

export {
  ALWAYS_ON,
  ALWAYS_ON_MAX,
  DSH_SURFACE,
  HOOK_EVENTS,
  HOOKS_FILE,
  SCRIPT_DIR,
  SCRIPT_NAME,
  SKILL_DIR,
  SKILL_NAME,
  SKILL_SCRIPT_DIR,
  isAllowed,
  isScriptName,
  isScriptPath,
  isSkillName,
  isSkillPath,
  isSkillScriptPath,
  normalizeRel,
  type HookEvent,
  type Surface,
} from './surface.ts'

export {
  alwaysOnText,
  autotrigger,
  checkHooks,
  frontmatterField,
  frontmatterOf,
  scriptReferences,
  skillNames,
  validate,
  type HarnessTree,
  type SurfaceCensus,
  type SurfaceProblem,
} from './validate.ts'

export {
  readTree,
  removeTree,
  writeTree,
  type ReadTree,
} from './tree.ts'

export {
  proposeMission,
  surfacePrompt,
} from './prompt.ts'

export { diffTree } from './diff.ts'
