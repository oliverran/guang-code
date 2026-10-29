/**
 * The per-domain experience library: what earlier tasks in this domain produced.
 *
 * ```text
 * <root>/<domain>/
 *   INDEX.md                        the index a proposer browses first
 *   harnesses/<taskId>/harness/     the full adopted harness tree
 *   harnesses/<taskId>/EXPERIENCE.md why it was adopted, and the lesson
 * ```
 *
 * A domain's directory only ever holds same-domain entries, so retrieval is by
 * construction: a lesson cannot fire in a domain it was not learned in.
 *
 * The store is a plain filesystem library over a caller-owned root. It registers no
 * service, mounts no plugin, and holds no state between calls beyond what is on disk —
 * the index is regenerated from what is there, so an index that disagrees with the
 * directory is a stale index rather than a second source of truth.
 *
 * @module
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { alwaysOnText, readTree, writeTree, type HarnessTree, type Surface } from '@deepseek-ai/dsh-ppc-surface'

import { hasExperience, parseExperience, renderExperience, type Experience } from './experience.ts'

/** The directory name one domain maps to. Never a path: a domain is a name. */
export const UNKNOWN_DOMAIN = 'unknown'

/**
 * One directory name for a domain.
 *
 * Only the separators and the whitespace around them collapse, so a domain without one
 * maps to itself, and a domain that names a path cannot escape the library root.
 * @param domain - the domain name as the caller named it.
 * @returns the directory name, or `unknown` when the name is blank.
 */
export function domainDir(domain: string): string {
  return domain.replace(/\s*[/\\]\s*/g, '__').trim() || UNKNOWN_DOMAIN
}

/**
 * A directory-safe form of a task id.
 *
 * A task id is caller-chosen and may contain separators; the entry directory is one name.
 * @param taskId - the task id as the caller named it.
 * @returns the directory name for the entry.
 */
export function slug(taskId: string): string {
  return taskId.replace(/[/\\]/g, '__').trim() || 'untitled'
}

/** How one library is configured. */
export interface LibraryOptions {
  /** The directory the library's domains live under. */
  readonly root: string
  /** The domain this library holds. */
  readonly domain: string
  /** The surface the stored harnesses are written against. */
  readonly surface: Surface
}

/** One stored entry: a task's adopted harness and its lesson. */
export interface LibraryEntry {
  /** The task id the entry was stored under. */
  readonly taskId: string
  /** The directory name the entry lives under. */
  readonly slug: string
  /** The adopted harness tree, relative path to content. */
  readonly harness: HarnessTree
  /** The lesson the round contributed, when the entry carries one. */
  readonly experience?: Experience
  /** Why the harness was adopted. */
  readonly why: string
  /** The label of the adopted candidate. */
  readonly label: string
  /** The run the adoption came from. */
  readonly runId: string
}

/** What one admission attempt produced. */
export interface LibraryWrite {
  /** The directory the entry was written to. */
  readonly dir: string
  /** The entry that was stored. */
  readonly entry: LibraryEntry
  /** The index that was regenerated. */
  readonly index: string
}

/**
 * One domain's library: read before each task, appended after.
 *
 * The class holds no state of its own beyond the root, the domain, and the surface. Every
 * read goes to disk, so two processes writing the same library see each other's entries
 * the next time they read.
 */
export class Library {
  /** The directory the library's domains live under. */
  readonly root: string
  /** The domain this library holds. */
  readonly domain: string
  /** The surface the stored harnesses are written against. */
  readonly surface: Surface

  /**
   * Create a library handle.
   * @param options - the root, the domain, and the surface.
   */
  constructor(options: LibraryOptions) {
    this.root = options.root
    this.domain = options.domain
    this.surface = options.surface
  }

  /** The domain's directory. */
  get dir(): string {
    return join(this.root, domainDir(this.domain))
  }

  /** The domain's index file. */
  get index(): string {
    return join(this.dir, 'INDEX.md')
  }

  /**
   * The directory one task's entry lives in.
   * @param taskId - the task id as the caller named it.
   * @returns the entry directory.
   */
  entryDir(taskId: string): string {
    return join(this.dir, 'harnesses', slug(taskId))
  }

  /**
   * Whether the domain holds an index.
   * @returns whether an index file exists.
   */
  async exists(): Promise<boolean> {
    return readFile(this.index, 'utf8').then(() => true).catch(() => false)
  }

  /**
   * The task ids the domain holds, sorted.
   * @returns the entry directory names, sorted.
   */
  async entries(): Promise<string[]> {
    const dir = join(this.dir, 'harnesses')
    const found = await readdir(dir, { withFileTypes: true })
      .then(items => items.filter(item => item.isDirectory()).map(item => item.name))
      .catch(() => [])
    return found.sort()
  }

  /**
   * The harness one task's entry stored.
   * @param taskId - the task id as the caller named it.
   * @returns the stored harness tree.
   */
  async treeOf(taskId: string): Promise<HarnessTree> {
    const { tree } = await readTree(this.surface, join(this.entryDir(taskId), 'harness'))
    return tree
  }

  /**
   * The lesson one task's entry stored.
   * @param taskId - the task id as the caller named it.
   * @returns the stored lesson, or undefined when the entry carries none.
   */
  async experienceOf(taskId: string): Promise<Experience | undefined> {
    const body = await readFile(join(this.entryDir(taskId), 'EXPERIENCE.md'), 'utf8').catch(() => '')
    const parsed = parseExperience(body)
    return hasExperience(parsed) ? parsed : undefined
  }

  /**
   * Store one adopted harness plus why it was adopted.
   *
   * The lesson is the gate: an entry whose lesson is missing a required field is not
   * written at all, and the caller is told why. A library that holds a half-lesson would
   * hand a guess to every later task in the domain.
   * @param taskId - the task id to store the entry under.
   * @param harness - the adopted harness tree.
   * @param details - why it was adopted, its label, its run, and the lesson.
   * @returns what was written, or the reason the lesson did not qualify.
   */
  async add(
    taskId: string,
    harness: HarnessTree,
    details: {
      readonly why?: string
      readonly label?: string
      readonly runId?: string
      readonly experience?: Partial<Experience>
    } = {},
  ): Promise<LibraryWrite | { readonly rejected: string }> {
    if (!hasExperience(details.experience)) {
      return { rejected: 'the experience is missing a required field' }
    }
    const experience = details.experience
    const dir = this.entryDir(taskId)
    await rm(join(dir, 'harness'), { recursive: true, force: true })
    await mkdir(join(dir, 'harness'), { recursive: true })
    await writeTree(this.surface, harness, join(dir, 'harness'))

    const lines = [
      `# ${taskId}`,
      '',
      `- adopted: \`${details.label ?? ''}\`` + (details.runId === undefined || details.runId === '' ? '' : `  (run \`${details.runId}\`)`),
      `- components: ${inventory(this.surface, harness)}`,
      '',
    ]
    const why = details.why?.trim() ?? ''
    if (why.length > 0) lines.push('## Why this was chosen', why, '')
    lines.push('## Transferable lesson', renderExperience(experience), '')
    await writeFile(join(dir, 'EXPERIENCE.md'), lines.join('\n'), 'utf8')

    const index = await this.rebuildIndex()
    return {
      dir,
      index,
      entry: {
        taskId,
        slug: slug(taskId),
        harness,
        experience,
        why,
        label: details.label ?? '',
        runId: details.runId ?? '',
      },
    }
  }

  /**
   * Drop the entries for these tasks and rebuild the index.
   *
   * An unknown task is ignored: forgetting something that was never stored is not an
   * error, and a caller that lists tasks to drop should not have to know which of them
   * were already gone.
   * @param taskIds - the task ids to drop.
   * @returns the task ids that were actually dropped.
   */
  async forget(taskIds: readonly string[]): Promise<string[]> {
    const dropped: string[] = []
    for (const taskId of taskIds) {
      const dir = this.entryDir(taskId)
      const present = await readdir(dir).then(() => true).catch(() => false)
      if (!present) continue
      await rm(dir, { recursive: true, force: true })
      dropped.push(taskId)
    }
    if (dropped.length > 0) await this.rebuildIndex()
    return dropped
  }

  /**
   * Regenerate the index from what is on disk.
   *
   * The index is derived, never authored: a reader that trusts it and a reader that reads
   * the entries must see the same library.
   * @returns the index path.
   */
  async rebuildIndex(): Promise<string> {
    const names = await this.entries()
    const rows = [
      `# Library — ${this.domain}`,
      '',
      'Each entry is an earlier task in THIS domain whose harness was chosen, stored with its FULL component tree and why it was picked. Browse this index, then open the entries that look relevant to the matter in front of you.',
      '',
    ]
    if (names.length === 0) {
      rows.push('_(empty — this is the first task in this domain)_')
    }
    for (const name of names) {
      const dir = join(this.dir, 'harnesses', name)
      const tree = await this.treeOf(name)
      rows.push(
        `## \`harnesses/${name}/\``,
        `- harness: \`harnesses/${name}/harness/\` — ${inventory(this.surface, tree)}`,
        `- why:     \`harnesses/${name}/EXPERIENCE.md\``,
      )
      const cue = await field(join(dir, 'EXPERIENCE.md'), 'cue')
      if (cue.length > 0) rows.push(`- cue:     ${cue}`)
      rows.push('')
    }
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.index, rows.join('\n'), 'utf8')
    return this.index
  }
}

/**
 * A one-line census of the components a harness actually carries.
 *
 * The census is what a reader scans before opening an entry, so it counts what the
 * runtime reads and not what the tree happens to contain.
 * @param surface - the surface the harness is written against.
 * @param tree - the harness to census.
 * @returns the one-line census.
 */
export function inventory(surface: Surface, tree: HarnessTree): string {
  let skills = 0
  let scripts = 0
  let hooks = 0
  for (const rel of Object.keys(tree)) {
    if (rel.startsWith(`${surface.skillDir}/`) && rel.endsWith('SKILL.md')) skills += 1
    else if (rel.startsWith(`${surface.scriptDir}/`)) scripts += 1
    else if (rel === surface.hooksFile) hooks += 1
  }
  const bits: string[] = []
  if (skills > 0) bits.push(`${skills} skill${skills === 1 ? '' : 's'}`)
  if (scripts > 0) bits.push(`${scripts} script${scripts === 1 ? '' : 's'}`)
  if (hooks > 0) bits.push('hooks')
  const on = alwaysOnText(surface, tree).length
  const parts = bits.length > 0 ? bits.join(', ') : 'always-on edits only'
  return `${parts}; ${on.toLocaleString('en-US')} always-on chars`
}

/**
 * Read one field out of a stored record.
 * @param path - the record's path.
 * @param name - the field's name.
 * @returns the field's value, or an empty string when the record has no such field.
 */
export async function field(path: string, name: string): Promise<string> {
  const body = await readFile(path, 'utf8').catch(() => '')
  const prefix = `- **${name}**:`
  for (const line of body.split('\n')) {
    if (!line.startsWith(prefix)) continue
    return line.slice(prefix.length).trim()
  }
  return ''
}
