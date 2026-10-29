/**
 * The per-domain experience library for recursive agent harnessing: the harnesses earlier
 * tasks in a domain adopted, the lessons they contributed, and lexical retrieval over them.
 * @module @deepseek-ai/dsh-ppc-library
 */

export {
  REQUIRED_FIELDS,
  hasExperience,
  missingFields,
  parseExperience,
  renderExperience,
  type Experience,
  type RequiredField,
} from './experience.ts'

export {
  DISTIL_BOUNDARY,
  NO_ENTRY,
  declined,
  distilMission,
  type DistilOptions,
} from './distil.ts'

export {
  DISTILLER_TOOLS,
  runDistiller,
  type DistillerOptions,
  type DistillerResult,
} from './distiller.ts'

export {
  Library,
  UNKNOWN_DOMAIN,
  domainDir,
  field,
  inventory,
  slug,
  type LibraryEntry,
  type LibraryOptions,
  type LibraryWrite,
} from './library.ts'

export {
  DEFAULT_MIN_SCORE,
  DEFAULT_TOP_N,
  jaccard,
  renderLessons,
  retrieve,
  sharedTokens,
  tokenize,
  type Match,
  type Retrievable,
  type RetrieveOptions,
} from './retrieve.ts'
