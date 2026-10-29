import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE, readTree, removeTree, writeTree } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-surface-'))
}

describe('readTree', () => {
  it('reads the files on the surface', async () => {
    const root = await scratch()
    await writeFile(join(root, 'AGENTS.md'), 'rules')
    await mkdir(join(root, '.dsh', 'skills', 'review'), { recursive: true })
    await writeFile(join(root, '.dsh', 'skills', 'review', 'SKILL.md'), 'skill body')

    const { tree, rejected } = await readTree(DSH_SURFACE, root)
    expect(tree['AGENTS.md']).toBe('rules')
    expect(tree['.dsh/skills/review/SKILL.md']).toBe('skill body')
    expect(rejected).toEqual([])
  })

  it('reports a file that is off the surface instead of carrying it', async () => {
    const root = await scratch()
    await writeFile(join(root, 'AGENTS.md'), 'rules')
    await writeFile(join(root, 'sub_agents', 'reviewer', 'AGENT.md'), 'x').catch(() => undefined)
    await mkdir(join(root, 'sub_agents', 'reviewer'), { recursive: true })
    await writeFile(join(root, 'sub_agents', 'reviewer', 'AGENT.md'), 'x')

    const { tree, rejected } = await readTree(DSH_SURFACE, root)
    expect(Object.keys(tree)).toEqual(['AGENTS.md'])
    expect(rejected).toEqual(['sub_agents/reviewer/AGENT.md'])
  })

  it('returns an empty tree for a directory that does not exist', async () => {
    const { tree, rejected } = await readTree(DSH_SURFACE, join(await scratch(), 'nope'))
    expect(tree).toEqual({})
    expect(rejected).toEqual([])
  })

  it('skips an entry that is neither a file nor a directory', async () => {
    const root = await scratch()
    await writeFile(join(root, 'AGENTS.md'), 'rules')
    await symlink(join(root, 'AGENTS.md'), join(root, 'AGENTS.link'))

    const { tree, rejected } = await readTree(DSH_SURFACE, root)
    expect(Object.keys(tree)).toEqual(['AGENTS.md'])
    expect(rejected).toEqual([])
  })

  it('reports a file it cannot read instead of failing the whole read', async () => {
    const root = await scratch()
    const path = join(root, 'AGENTS.md')
    await writeFile(path, 'rules')
    await chmod(path, 0o000)
    try {
      const { tree, rejected } = await readTree(DSH_SURFACE, root)
      // A root-like environment can still read a mode-000 file.
      if (rejected.length === 0) return
      expect(tree).toEqual({})
      expect(rejected).toEqual(['AGENTS.md'])
    } finally {
      await chmod(path, 0o600)
    }
  })
})

describe('writeTree', () => {
  it('writes the tree it is given', async () => {
    const root = await scratch()
    const written = await writeTree(DSH_SURFACE, {
      'AGENTS.md': 'rules',
      '.dsh/skills/review/SKILL.md': 'skill body',
    }, root)
    expect(written).toEqual(['.dsh/skills/review/SKILL.md', 'AGENTS.md'])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('rules')
    expect(await readFile(join(root, '.dsh', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('skill body')
  })

  it('refuses to write a path that is off the surface', async () => {
    const root = await scratch()
    const written = await writeTree(DSH_SURFACE, { 'sub_agents/x/AGENT.md': 'x' }, root)
    expect(written).toEqual([])
  })

  it('round-trips through read', async () => {
    const root = await scratch()
    const tree = { 'AGENTS.md': 'rules', 'hooks.json': '{"hooks":{}}' }
    await writeTree(DSH_SURFACE, tree, root)
    const { tree: read } = await readTree(DSH_SURFACE, root)
    expect(read).toEqual(tree)
  })
})

describe('removeTree', () => {
  it('removes a directory and tolerates a missing one', async () => {
    const root = await scratch()
    await writeFile(join(root, 'a.md'), 'x')
    await removeTree(root)
    await expect(removeTree(root)).resolves.toBeUndefined()
  })
})
