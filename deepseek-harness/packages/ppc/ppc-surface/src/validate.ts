/**
 * Validation of a proposed harness tree against the DSH runtime's own rules.
 *
 * Every rule here is a rule DSH enforces at load time, restated so a proposal can be checked
 * BEFORE it is rolled out. The runtime's failure modes are the reason:
 *
 * - A skill whose frontmatter lacks `name` or `description` is dropped with a warning. A
 *   harness that ships one is a harness that does nothing, and the rollout that "proves" it
 *   changed nothing proves only that.
 * - A skill the always-on text never names is never opened. It costs context and buys nothing.
 * - A skill that invokes a helper the proposal did not ship fails at the moment it is invoked.
 * - A hooks file DSH cannot parse registers no hooks at all, and says so only in a log.
 *
 * Validation runs before any rollout, so a rejected proposal costs a model turn and not an
 * experiment.
 *
 * @module
 */

import { isSkillName, type Surface } from './surface.ts'

/** A proposed harness: relative path to file content. */
export type HarnessTree = Readonly<Record<string, string>>

/** One problem with a proposed tree. */
export interface SurfaceProblem {
  /** The path the problem is about, or an empty string when it is about the tree as a whole. */
  readonly path: string
  /** What is wrong, phrased so the proposer can act on it. */
  readonly message: string
}

/** What a validated tree contains. */
export interface SurfaceCensus {
  /** The skill names the tree ships. */
  readonly skills: readonly string[]
  /** The always-on text's length in characters. */
  readonly alwaysOnChars: number
}

/**
 * The always-on text of a tree: the always-on files, in read order.
 * @param surface - the surface the tree is written against.
 * @param tree - the proposed harness.
 * @returns the concatenated always-on text.
 */
export function alwaysOnText(surface: Surface, tree: HarnessTree): string {
  return surface.alwaysOn
    .map(file => tree[file] ?? '')
    .filter(text => text.length > 0)
    .join('\n\n')
}

/**
 * The skill names a tree ships, taken from the directories that hold a `SKILL.md`.
 * @param surface - the surface the tree is written against.
 * @param tree - the proposed harness.
 * @returns the sorted skill names.
 */
export function skillNames(surface: Surface, tree: HarnessTree): string[] {
  const prefix = `${surface.skillDir}/`
  const names = new Set<string>()
  for (const rel of Object.keys(tree)) {
    if (!rel.startsWith(prefix)) continue
    const parts = rel.slice(prefix.length).split('/')
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue
    if (isSkillName(/* v8 ignore next -- length 2 guarantees parts[0] */ parts[0] ?? '')) names.add(parts[0] as string)
  }
  return [...names].sort()
}

/**
 * The frontmatter of a skill file, as the raw text that precedes its body.
 * @param source - the whole `SKILL.md` content.
 * @returns the frontmatter text, or an empty string when the file has none.
 */
export function frontmatterOf(source: string): string {
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') return ''
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closing < 0) return ''
  return lines.slice(0, closing + 1).join('\n')
}

/**
 * A frontmatter field's value, read the way a YAML reader would read a scalar.
 * @param frontmatter - the frontmatter text.
 * @param field - the field name.
 * @returns the field's trimmed value, or undefined when the field is absent or empty.
 */
export function frontmatterField(frontmatter: string, field: string): string | undefined {
  const pattern = new RegExp(`^${field}:[ \\t]*(.*)$`, 'm')
  for (const line of frontmatter.split('\n')) {
    if (line.trim() === '---') continue
    const match = pattern.exec(line)
    if (match === null) continue
    /* v8 ignore next -- a matched capture group is always a string */
    const value = (match[1] ?? '').trim().replace(/^['"]|['"]$/g, '')
    return value.length > 0 ? value : undefined
  }
  return undefined
}

/**
 * The scripts a skill or an always-on file invokes.
 *
 * Both the `python3 <path>` form and the bare `<path>` form are read, because an always-on
 * file may name a helper in prose while a skill names it in a command.
 * @param source - the text to scan.
 * @returns the referenced script paths, in the order they appear.
 */
export function scriptReferences(source: string): string[] {
  const referenced: string[] = []
  // The path may carry a skill-directory prefix (`.dsh/skills/<name>/scripts/<file>`), so
  // every leading segment is captured, not just one.
  const pattern = /(?:python3?\s+)?((?:[\w.-]+\/)*scripts\/[\w.-]+\.py)/g
  for (const match of source.matchAll(pattern)) {
    const path = match[1]
    if (path !== undefined && !referenced.includes(path)) referenced.push(path)
  }
  return referenced
}

/**
 * Check a hooks file against the schema `dsh-hooks-claude-code` dispatches.
 *
 * A malformed hooks file never fires rather than erroring, so the shape is enforced where the
 * proposer can still see it.
 * @param source - the `hooks.json` content.
 * @param events - the lifecycle events the runtime dispatches.
 * @returns one problem per defect; an empty array means the file is usable.
 */
export function checkHooks(source: string, events: readonly string[]): SurfaceProblem[] {
  const problems: SurfaceProblem[] = []
  let document: unknown
  try {
    document = JSON.parse(source)
  } catch (error) {
    return [{ path: 'hooks.json', message: `hooks.json is not valid JSON: ${String(error)}` }]
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return [{ path: 'hooks.json', message: 'hooks.json must be a JSON object' }]
  }
  const record = document as Record<string, unknown>
  // DSH accepts either a settings file with a top-level `hooks` object, or a bare event map.
  const hooks = (typeof record.hooks === 'object' && record.hooks !== null && !Array.isArray(record.hooks))
    ? record.hooks as Record<string, unknown>
    : record
  if (Object.keys(hooks).length === 0) {
    return [{ path: 'hooks.json', message: 'hooks.json needs a top-level {"hooks": {"<Event>": [...]}} object' }]
  }
  for (const [event, entries] of Object.entries(hooks)) {
    if (!events.includes(event)) {
      problems.push({
        path: 'hooks.json',
        message: `hooks.json: unknown event ${JSON.stringify(event)}; the framework dispatches ${[...events].sort().join(', ')} (PascalCase)`,
      })
      continue
    }
    if (!Array.isArray(entries)) {
      problems.push({ path: 'hooks.json', message: `hooks.json: ${event} must map to a LIST of matcher entries` })
      continue
    }
    entries.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        problems.push({ path: 'hooks.json', message: `hooks.json: ${event}[${index}] needs a \`hooks\` list` })
        return
      }
      const list = (entry as Record<string, unknown>).hooks
      if (!Array.isArray(list)) {
        problems.push({ path: 'hooks.json', message: `hooks.json: ${event}[${index}] needs a \`hooks\` list` })
        return
      }
      for (const hook of list) {
        if (typeof hook !== 'object' || hook === null) {
          problems.push({ path: 'hooks.json', message: `hooks.json: ${event}[${index}] hook must be an object` })
          continue
        }
        const typed = hook as Record<string, unknown>
        if (typed.type !== 'command') {
          problems.push({
            path: 'hooks.json',
            message: `hooks.json: ${event}[${index}] hook type must be "command" — async/prompt/agent hooks are skipped as "not supported yet"`,
          })
          continue
        }
        if (typeof typed.command !== 'string' || typed.command.trim().length === 0) {
          problems.push({ path: 'hooks.json', message: `hooks.json: ${event}[${index}] has an empty \`command\`` })
        }
      }
    })
  }
  return problems
}

/**
 * Validate a proposed harness tree.
 *
 * @param surface - the surface the tree is written against; it carries every rule applied.
 * @param tree - the proposed harness: relative path to content.
 * @returns every problem found, and a census of what the tree contains.
 */
export function validate(
  surface: Surface,
  tree: HarnessTree,
): { readonly problems: readonly SurfaceProblem[]; readonly census: SurfaceCensus } {
  const problems: SurfaceProblem[] = []
  const body = alwaysOnText(surface, tree)

  if (body.length > surface.alwaysOnMax) {
    problems.push({
      path: '',
      message: `always-on content is ${body.length} chars, over the ${surface.alwaysOnMax} cap; ${surface.alwaysOnCapReason}`,
    })
  }
  if (surface.rejectEmptyAlwaysOn && body.trim().length === 0) {
    problems.push({
      path: surface.alwaysOn[0] ?? '',
      message: `${surface.alwaysOn[0]} is empty — without it the harness carries no standing instruction at all`,
    })
  }

  const skills = skillNames(surface, tree)
  for (const name of skills) {
    const rel = `${surface.skillDir}/${name}/SKILL.md`
    /* v8 ignore next -- rel is rebuilt from a skillNames key, so tree[rel] exists */
    const source = tree[rel] ?? ''
    const frontmatter = frontmatterOf(source)
    if (frontmatter.length === 0) {
      problems.push({
        path: rel,
        message: `${rel} needs YAML frontmatter; a file without it is dropped at load`,
      })
      continue
    }
    const declared = frontmatterField(frontmatter, 'name')
    const description = frontmatterField(frontmatter, 'description')
    if (declared === undefined) {
      problems.push({
        path: rel,
        message: `${rel} needs \`name:\` in its frontmatter, or it is dropped at load`,
      })
    } else if (declared !== name) {
      problems.push({
        path: rel,
        message: `${rel} declares \`name: ${declared}\`, which overrides the directory name at load, so every trigger line naming \`${name}\` stops matching; make it \`name: ${name}\``,
      })
    }
    if (description === undefined) {
      problems.push({
        path: rel,
        message: `${rel} needs a \`description:\` in its frontmatter, or it is dropped at load`,
      })
    }
    if (!body.includes(name)) {
      problems.push({
        path: rel,
        message: `skill \`${name}\` is never named in the always-on text, so the agent will not know to invoke it — an untriggered skill is dead weight. ${surface.triggerHint.replace('{name}', name)}`,
      })
    }
  }

  const shipped = new Set(Object.keys(tree))
  for (const [rel, source] of Object.entries(tree)) {
    const isSkill = rel.endsWith('/SKILL.md') && rel.startsWith(`${surface.skillDir}/`)
    const isAlwaysOn = surface.alwaysOn.includes(rel)
    if (!isSkill && !isAlwaysOn) continue
    for (const reference of scriptReferences(source)) {
      if (shipped.has(reference)) continue
      problems.push({
        path: rel,
        message: `${rel} invokes \`${reference}\` but that file is not in the harness; a skill's own helper must travel with it at ${surface.skillDir}/<skill>/${surface.skillScriptDir}/<file>.py`,
      })
    }
  }

  const hooks = tree[surface.hooksFile]
  if (hooks !== undefined) problems.push(...checkHooks(hooks, surface.hookEvents))

  return { problems, census: { skills, alwaysOnChars: body.length } }
}

/**
 * Give every skill a trigger line in the always-on text; return the names repaired.
 *
 * A skill the agent is never told to load is never loaded, so this is the difference between
 * a harness that works and one that does nothing.
 * @param surface - the surface the tree is written against.
 * @param tree - the proposed harness, mutated in place.
 * @returns the skill names that gained a trigger line.
 */
export function autotrigger(surface: Surface, tree: Record<string, string>): string[] {
  const body = alwaysOnText(surface, tree)
  const fixed: string[] = []
  for (const name of skillNames(surface, tree)) {
    if (body.includes(name)) continue
    /* v8 ignore next -- rel is rebuilt from a skillNames key, so tree[rel] exists */
    const source = tree[`${surface.skillDir}/${name}/SKILL.md`] ?? ''
    const description = frontmatterField(frontmatterOf(source), 'description') ?? `the ${name} workflow applies`
    const line = surface.triggerLine.replace('{desc}', description).replace('{name}', name)
    const current = tree[surface.autotriggerFile] ?? ''
    if (alwaysOnText(surface, tree).length + line.length + 2 > surface.alwaysOnMax) continue
    tree[surface.autotriggerFile] = current.trim().length > 0 ? `${current.trimEnd()}\n${line}` : line
    fixed.push(name)
  }
  return fixed
}
