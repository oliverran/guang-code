/**
 * Reading a proposed harness off disk, and writing one back.
 *
 * A proposal is a directory of files, and only the files on the editable surface count. A
 * file the proposer wrote that the runtime never reads is not part of the harness, so it is
 * reported and discarded rather than silently carried into the next stage.
 *
 * @module
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'

import { isAllowed, normalizeRel, type Surface } from './surface.ts'

/** A harness tree: relative path to file content. */
export type HarnessTree = Readonly<Record<string, string>>

/** What one read of a proposal directory found. */
export interface ReadTree {
  /** The files on the editable surface, relative path to content. */
  readonly tree: Record<string, string>
  /** The files that exist on disk but are off the surface, sorted. */
  readonly rejected: readonly string[]
}

/**
 * Read a proposal directory into a harness tree.
 *
 * A file that cannot be read is reported as rejected rather than failing the read: one
 * unreadable file must not cost the whole proposal.
 * @param surface - the surface the tree is written against.
 * @param root - the directory to read.
 * @returns the tree, and the paths that were off the surface.
 */
export async function readTree(surface: Surface, root: string): Promise<ReadTree> {
  const tree: Record<string, string> = {}
  const rejected: string[] = []
  await collect(surface, root, root, tree, rejected)
  return { tree, rejected: rejected.sort() }
}

async function collect(
  surface: Surface,
  root: string,
  dir: string,
  tree: Record<string, string>,
  rejected: string[],
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collect(surface, root, absolute, tree, rejected)
      continue
    }
    if (!entry.isFile()) continue
    const rel = absolute.slice(root.length + 1)
    if (!isAllowed(surface, rel)) {
      rejected.push(rel)
      continue
    }
    try {
      tree[normalizeRel(rel)] = await readFile(absolute, 'utf8')
    } catch {
      rejected.push(rel)
    }
  }
}

/**
 * Write a harness tree into a directory, replacing what is there.
 *
 * Files outside the editable surface are left alone: the directory is the proposer's
 * workspace, and the evidence tree beside it is not the proposer's to delete.
 * @param surface - the surface the tree is written against.
 * @param tree - the harness to write.
 * @param root - the directory to write into.
 * @returns the paths written, sorted.
 */
export async function writeTree(surface: Surface, tree: HarnessTree, root: string): Promise<string[]> {
  const written: string[] = []
  for (const [rel, content] of Object.entries(tree)) {
    const normalized = normalizeRel(rel)
    if (!isAllowed(surface, normalized)) continue
    const target = join(root, ...normalized.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    written.push(normalized)
  }
  return written.sort()
}

/**
 * Remove a directory and everything under it.
 * @param root - the directory to remove; a missing directory is not an error.
 */
export async function removeTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}
