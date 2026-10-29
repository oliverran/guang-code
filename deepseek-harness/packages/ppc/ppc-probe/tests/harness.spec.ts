import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'

import { probeCwd, probeWorkspace, stageHarness } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-probe-'))
}

const HARNESS = {
  'PERSONA.md': 'You are precise.',
  'AGENTS.md': 'You are a coding agent.',
  '.dsh/skills/review/SKILL.md': '---\nname: review\ndescription: when reviewing\n---\n\nreview it\n',
}

describe('stageHarness', () => {
  it('writes the proposal where DSH reads it', async () => {
    const root = await scratch()
    const staged = await stageHarness(DSH_SURFACE, HARNESS, join(root, 'inv1'))

    expect(staged.root).toBe(join(root, 'inv1'))
    expect(staged.files).toEqual([
      '.dsh/skills/review/SKILL.md',
      'AGENTS.md',
      'PERSONA.md',
    ])
    expect(await readFile(join(staged.root, 'AGENTS.md'), 'utf8')).toBe('You are a coding agent.')
    expect(await readFile(join(staged.root, '.dsh', 'skills', 'review', 'SKILL.md'), 'utf8'))
      .toContain('name: review')
  })

  it('returns the persona separately, because DSH reads it as a prompt section', async () => {
    // `PERSONA.md` is not opened at runtime: it becomes the deployment persona, which is a
    // prompt section. A probe that only staged the file would run the deployment's identity
    // and measure nothing.
    const root = await scratch()
    const staged = await stageHarness(DSH_SURFACE, HARNESS, join(root, 'inv1'))

    expect(staged.persona).toBe('You are precise.')
  })

  it('reports an empty persona rather than failing', async () => {
    const root = await scratch()
    const staged = await stageHarness(DSH_SURFACE, { 'AGENTS.md': 'rules' }, join(root, 'inv1'))

    expect(staged.persona).toBe('')
  })

  it('replaces whatever was in the directory', async () => {
    const root = await scratch()
    const target = join(root, 'inv1')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'stale.md'), 'left over')
    await stageHarness(DSH_SURFACE, HARNESS, target)

    expect(await readdir(target)).toEqual([
      '.dsh',
      'AGENTS.md',
      'PERSONA.md',
    ])
  })

  it('leaves a file that is off the editable surface unwritten', async () => {
    const root = await scratch()
    const staged = await stageHarness(DSH_SURFACE, { ...HARNESS, 'stray.md': 'off surface' }, join(root, 'inv1'))

    expect(staged.files).not.toContain('stray.md')
    expect(await readdir(staged.root)).not.toContain('stray.md')
  })
})

describe('probeWorkspace', () => {
  it('runs the probe in the directory the harness was staged into', async () => {
    // The instruction loader and the skill provider both resolve against the session cwd,
    // so the staged directory IS the probe's workspace: splitting them would let the probe
    // read a different `AGENTS.md` than the one it was staged with.
    expect(probeWorkspace('/work/inv1')).toBe('/work/inv1')
  })
})

describe('probeCwd', () => {
  it('is the staged directory itself', async () => {
    expect(probeCwd('/work/inv1')).toBe('/work/inv1')
  })
})
