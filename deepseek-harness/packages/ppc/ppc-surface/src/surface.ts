/**
 * The DSH editable surface: the paths a proposing agent may write, and the rules the runtime
 * enforces of the files it writes.
 *
 * The surface is a predicate over relative paths, and it is derived from what DSH's runtime
 * actually loads — not from what a proposer is told it may write. A path the runtime never
 * reads is not editable, and a path the runtime reads but the surface omits is a bug in the
 * surface.
 *
 * The five editable components:
 *
 * | component | path | how DSH reads it |
 * |---|---|---|
 * | c1 persona | `PERSONA.md` | replaced into `system-prompt.config.persona` by the caller |
 * | c2 instructions | `AGENTS.md` | `dsh-agent-instructions` reads the chain root-to-cwd |
 * | c6 skills | `.dsh/skills/<name>/SKILL.md` | `dsh-skill-filesystem` scans the project root |
 * | c7 scripts | `scripts/<name>.py` | no loader; the model runs it through bash |
 * | c8 hooks | `hooks.json` | `dsh-hooks-claude-code` reads `configPath` once at load |
 *
 * Two DSH facts shape this list and are worth stating once:
 *
 * - There is NO file-form subagent. `ctx.subagents.registerProvider()` is code-only, so
 *   `sub_agents/<name>/AGENT.md` has no runtime that would load it. It is not on the surface.
 * - There is no plugin FILE either; a cordis plugin is JavaScript registered through the
 *   loader. The middleware-control component is carried by `hooks.json` instead.
 *
 * @module
 */

/** A DSH skill's directory name: lowercase words joined by single hyphens. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A helper script's file name: snake_case, matching what the surface prompts call `scripts/<name>.py`. */
export const SCRIPT_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*\.py$/

/** The always-on files, in the order the runtime reads them. */
export const ALWAYS_ON = ['PERSONA.md', 'AGENTS.md'] as const

/** The always-on text a proposal may add before it costs the agent's own output budget. */
export const ALWAYS_ON_MAX = 16_000

/** The directory a skill bundle lives in, relative to the project root. */
export const SKILL_DIR = '.dsh/skills'

/** The hooks file, relative to the staged harness root. */
export const HOOKS_FILE = 'hooks.json'

/** The directory a top-level helper script lives in, relative to the staged harness root. */
export const SCRIPT_DIR = 'scripts'

/** The directory a skill's own helper lives in, relative to the skill bundle. */
export const SKILL_SCRIPT_DIR = 'scripts'

/** The lifecycle events `dsh-hooks-claude-code` dispatches. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
] as const

/** One hook lifecycle event. */
export type HookEvent = typeof HOOK_EVENTS[number]

/**
 * The editable surface: which relative paths a proposal may contain, and what the runtime
 * requires of them.
 *
 * Every rule the validator enforces lives here rather than in a caller's options, so a
 * surface value is the complete description of what a proposal may do. Two callers that
 * hold the same surface value cannot disagree about a rule.
 *
 * The value is also the surface's canonical form: `scripts/gen-ppc-surface.ts` publishes it
 * as a manifest that harness2's Python substrate reads, so the two trees cannot describe the
 * same editable surface two different ways.
 */
export interface Surface {
  /** The surface's name, as a substrate names it. */
  readonly name: string
  /** The always-on files, in read order. */
  readonly alwaysOn: readonly string[]
  /** The character cap on the concatenated always-on text. */
  readonly alwaysOnMax: number
  /** Why the always-on cap exists, in the words a proposer is shown. */
  readonly alwaysOnCapReason: string
  /** The directory skills live in, relative to the project root. */
  readonly skillDir: string
  /** What a skill's frontmatter `name` may disagree with. */
  readonly skillNameRule: 'must_match' | 'overrides_dir'
  /** The directory a top-level helper script lives in. */
  readonly scriptDir: string
  /** The directory a skill's own helper lives in, relative to the skill bundle. */
  readonly skillScriptDir: string
  /** The always-on file that receives an auto-generated trigger line. */
  readonly autotriggerFile: string
  /** The template of one auto-generated trigger line. */
  readonly triggerLine: string
  /** The template of the hint a proposer is shown for an untriggered skill. */
  readonly triggerHint: string
  /** The plugin file directory, or undefined where the framework has no plugin file. */
  readonly pluginDir: string | undefined
  /**
   * The file-form subagent directory, or undefined where the framework has no file-form
   * subagent. DSH registers subagents in code, so a `sub_agents/<name>/AGENT.md` has no
   * runtime that would load it: it is not on the surface.
   */
  readonly subagentDir: string | undefined
  /** Whether a file-form subagent needs a `mode: subagent` frontmatter field. */
  readonly subagentRequiresMode: boolean
  /** Whether a skill's own helper is compiled before it runs. */
  readonly compileSkillScripts: boolean
  /** The hooks file, relative to the staged harness root. */
  readonly hooksFile: string
  /** The lifecycle events the hook bridge dispatches. */
  readonly hookEvents: readonly string[]
  /** Whether a proposal with empty always-on text is rejected. */
  readonly rejectEmptyAlwaysOn: boolean
  /** The seed files a staged harness carries, path to body. */
  readonly stubs: readonly (readonly [string, string])[]
}

/** The DSH surface. */
export const DSH_SURFACE: Surface = {
  name: 'dsh',
  alwaysOn: ALWAYS_ON,
  alwaysOnMax: ALWAYS_ON_MAX,
  alwaysOnCapReason: 'PERSONA.md becomes system-prompt.config.persona and AGENTS.md is injected by dsh-agent-instructions into every turn; both compete with the agent\'s own output budget, and agent-instructions truncates its chain at maxBytes (65536 by default)',
  skillDir: SKILL_DIR,
  skillNameRule: 'must_match',
  scriptDir: SCRIPT_DIR,
  skillScriptDir: SKILL_SCRIPT_DIR,
  autotriggerFile: 'AGENTS.md',
  triggerLine: '- When {desc}, load the `{name}` skill.\n',
  triggerHint: 'Fix it by adding a trigger line naming `{name}` to PERSONA.md or AGENTS.md, e.g. "When <the situation this skill handles>, load the `{name}` skill."',
  pluginDir: undefined,
  subagentDir: undefined,
  subagentRequiresMode: false,
  compileSkillScripts: false,
  hooksFile: HOOKS_FILE,
  hookEvents: HOOK_EVENTS,
  rejectEmptyAlwaysOn: true,
  stubs: [
    [
      'scripts/README.md',
      '<!-- c7: deterministic helpers, run as `python3 scripts/<name>.py`. Add one by emitting scripts/<name>.py. -->\n',
    ],
    [
      'hooks.README.md',
      '<!-- c8: dsh lifecycle hooks -- the only lever that acts INSIDE the tool loop, so the model cannot skip it. Add ONE file, hooks.json, Claude-Code hook schema: {"hooks": {"PostToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "..."}]}]}}. A PostToolUse command that exits 2, or prints {"decision":"block","reason":"..."}, feeds the reason back to the model. Events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop. -->\n',
    ],
    [
      '.dsh/skills/README.md',
      '<!-- c6: reusable workflows. Add one as .dsh/skills/<name>/SKILL.md with YAML frontmatter: BOTH `name:` (matching the directory) and `description:` are REQUIRED -- dsh-skill-filesystem drops the file with a warning otherwise. Only name+description reach the catalog; the body loads on demand via the `skill` tool. -->\n',
    ],
    [
      'sub_agents/README.md',
      '<!-- c5: DSH registers subagents in code (ctx.subagents.registerProvider), so a file here is NOT loaded by any runtime. Kept so the component stays visible in the tree and in the proposal surface. -->\n',
    ],
  ],
}

/**
 * Normalise a relative path, rejecting an escape before it is joined to a directory.
 * @param rel - the path as a proposal named it.
 * @returns the normalised path, without a leading `./` and without a trailing `/`.
 * @throws when the path is absolute or contains a `..` segment.
 */
export function normalizeRel(rel: string): string {
  const normalized = rel.trim().replaceAll('\\', '/')
  if (normalized.startsWith('/')) throw new Error(`path escapes the harness: ${JSON.stringify(rel)}`)
  if (normalized.split('/').includes('..')) {
    throw new Error(`path escapes the harness: ${JSON.stringify(rel)}`)
  }
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Whether a path is on the editable surface. A predicate: it never throws.
 * @param surface - the surface to test against.
 * @param rel - the path as a proposal named it.
 * @returns whether the path may be written.
 */
export function isAllowed(surface: Surface, rel: string): boolean {
  let normalized: string
  try {
    normalized = normalizeRel(rel)
  } catch {
    return false
  }
  if (normalized.length === 0) return false
  if (surface.alwaysOn.includes(normalized)) return true
  if (normalized === surface.hooksFile) return true
  if (isSkillPath(surface, normalized)) return true
  if (isSkillScriptPath(surface, normalized)) return true
  return isScriptPath(surface, normalized)
}

/**
 * Whether a path names a skill bundle's `SKILL.md`.
 * @param surface - the surface to test against.
 * @param rel - the path as a proposal named it.
 * @returns whether the path is a skill's entry file.
 */
export function isSkillPath(surface: Surface, rel: string): boolean {
  const prefix = `${surface.skillDir}/`
  if (!rel.startsWith(prefix)) return false
  const rest = rel.slice(prefix.length)
  const parts = rest.split('/')
  return parts.length === 2 && parts[1] === 'SKILL.md' && isSkillName(/* v8 ignore next -- parts[0] exists when length is 2 */ parts[0] ?? '')
}

/**
 * Whether a path names a helper carried with a skill.
 * @param surface - the surface to test against.
 * @param rel - the path as a proposal named it.
 * @returns whether the path is a skill's own helper script.
 */
export function isSkillScriptPath(surface: Surface, rel: string): boolean {
  const prefix = `${surface.skillDir}/`
  if (!rel.startsWith(prefix)) return false
  const parts = rel.slice(prefix.length).split('/')
  // <name>/scripts/<file>: the helper must travel with its skill.
  return parts.length === 3
    && parts[1] === surface.skillScriptDir
    && isScriptName(/* v8 ignore next -- parts[2] exists when length is 3 */ parts[2] ?? '')
}

/**
 * Whether a path names a top-level helper script.
 * @param surface - the surface to test against.
 * @param rel - the path as a proposal named it.
 * @returns whether the path is a top-level `scripts/<name>.py`.
 */
export function isScriptPath(surface: Surface, rel: string): boolean {
  const parts = rel.split('/')
  return parts.length === 2 && parts[0] === surface.scriptDir && isScriptName(/* v8 ignore next -- parts[1] exists when length is 2 */ parts[1] ?? '')
}

/**
 * Whether a string is a valid DSH skill name.
 *
 * DSH drops a skill whose frontmatter `name` fails this rule, with a warning and no error —
 * so a proposal that breaks it produces a harness that silently does nothing.
 * @param name - the candidate name.
 * @returns whether the name is usable.
 */
export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/**
 * Whether a string is a valid helper script file name.
 * @param name - the candidate file name.
 * @returns whether the name is usable.
 */
export function isScriptName(name: string): boolean {
  return SCRIPT_NAME.test(name)
}
