/**
 * Materialising a proposed harness into a directory DSH can actually run.
 *
 * A proposal is a tree of relative paths to content. Running it means putting those
 * files where DSH's loaders look for them, and the loaders look in three different
 * places:
 *
 * - `PERSONA.md` is not read from disk at all. It becomes the deployment persona, which
 *   is a prompt section, so a probe registers it as one.
 * - `AGENTS.md` is read from the workspace, walking from the project root down to the
 *   session's working directory.
 * - `.dsh/skills/<name>/SKILL.md` is read from the project root, which the skill
 *   provider finds by walking up from the session's working directory to the nearest
 *   directory containing `.git`.
 *
 * That last one is the trap: a staged harness in a temporary directory has no `.git`
 * above it, so the provider's project root IS the staged directory — which is what we
 * want — but only because nothing above it claims the walk. A staged harness under a
 * real repository would silently inherit that repository's skills, so the staging
 * directory is the session's working directory and the provider is told about it
 * explicitly.
 *
 * @module
 */

import { join } from 'node:path'

import { mkdir, rm } from 'node:fs/promises'

import { writeTree, type HarnessTree, type Surface } from '@deepseek-ai/dsh-ppc-surface'

/** What one materialised harness looks like on disk. */
export interface StagedHarness {
  /** The directory the harness was written into. */
  readonly root: string
  /** The persona text, which is a prompt section rather than a file DSH reads. */
  readonly persona: string
  /** The files written, relative to the harness root. */
  readonly files: readonly string[]
}

/**
 * Write a proposed harness into a directory a probe can run from.
 *
 * The always-on files are written where DSH reads them, and the persona is also
 * returned separately: `PERSONA.md` becomes a prompt section, so a probe must register
 * it as one rather than expect the file to be read.
 * @param surface - the surface the tree is written against.
 * @param tree - the proposed harness.
 * @param root - the directory to write into; it is replaced.
 * @returns where the harness landed and what its persona says.
 */
export async function stageHarness(
  surface: Surface,
  tree: HarnessTree,
  root: string,
): Promise<StagedHarness> {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const files = await writeTree(surface, tree, root)
  // The persona is a prompt section, not a file DSH reads. It is still written, so the
  // staged directory is a complete picture of the proposal, but the probe registers the
  // text itself.
  const persona = tree['PERSONA.md'] ?? ''
  return { root, persona, files }
}

/**
 * The workspace a probe runs in: the staged harness plus the task's own material.
 *
 * A probe is a real run of the agent against the task, so it needs somewhere to work.
 * The staged harness is the agent's identity and instructions; the working directory is
 * where the agent's file operations land. Keeping them in ONE directory is what makes
 * the probe honest: the agent's `read`/`write` of `AGENTS.md` and its reads of the task
 * material happen in the same tree the harness was staged into.
 * @param root - the staged harness directory.
 * @returns the directory to run the probe in.
 */
export function probeWorkspace(root: string): string {
  return root
}

/**
 * The path a probe's session records as its working directory.
 *
 * The session cwd is what the instruction loader and the skill provider resolve
 * against, so it is the staged harness directory itself.
 * @param root - the staged harness directory.
 * @returns the session working directory.
 */
export function probeCwd(root: string): string {
  return join(root)
}
