import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DSH_SURFACE } from '@deepseek-ai/dsh-ppc-surface'
import { describe, expect, it } from 'vitest'

import { Library, domainDir, field, inventory, slug, type Experience } from '../src/index.ts'

const LESSON: Experience = {
  cue: 'when a tool times out on a large file',
  lesson: 'read the file in chunks, in the helper script',
  evidence: 'the base rollout burned its budget on one read',
  confidence: 'medium — one rollout',
}

const HARNESS = {
  'PERSONA.md': 'You are a careful assistant.',
  'AGENTS.md': 'Answer the question.',
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-library-'))
}

async function library(root: string, domain = 'finance'): Promise<Library> {
  return new Library({ root, domain, surface: DSH_SURFACE })
}

describe('domainDir', () => {
  it('maps a domain without a separator to itself', () => {
    expect(domainDir('finance')).toBe('finance')
  })

  it('collapses a separator so a domain can never name a path', () => {
    expect(domainDir('a/b')).toBe('a__b')
    expect(domainDir('a\\b')).toBe('a__b')
  })

  it('names a blank domain', () => {
    expect(domainDir('  ')).toBe('unknown')
  })
})

describe('slug', () => {
  it('keeps a task id that is already one name', () => {
    expect(slug('task-7')).toBe('task-7')
  })

  it('collapses a separator so a task id can never name a path', () => {
    expect(slug('a/b')).toBe('a__b')
  })

  it('names a blank task id', () => {
    expect(slug('  ')).toBe('untitled')
  })
})

describe('inventory', () => {
  it('counts the components the runtime reads', () => {
    const census = inventory(DSH_SURFACE, {
      'PERSONA.md': 'p',
      'AGENTS.md': 'a',
      '.dsh/skills/s/SKILL.md': 's',
      'scripts/x.py': 'x',
      'hooks.json': '{}',
    })

    expect(census).toContain('1 skill')
    expect(census).toContain('1 script')
    expect(census).toContain('hooks')
    expect(census).toContain('always-on chars')
  })

  it('says so when the harness carries only always-on text', () => {
    expect(inventory(DSH_SURFACE, HARNESS)).toContain('always-on edits only')
  })

  it('counts more than one of a component in the plural', () => {
    const census = inventory(DSH_SURFACE, {
      '.dsh/skills/a/SKILL.md': 'a',
      '.dsh/skills/b/SKILL.md': 'b',
      'scripts/x.py': 'x',
      'scripts/y.py': 'y',
    })

    expect(census).toContain('2 skills')
    expect(census).toContain('2 scripts')
  })
})

describe('Library.add', () => {
  it('stores the harness tree and the lesson', async () => {
    const lib = await library(await scratch())
    const result = await lib.add('task-7', HARNESS, {
      why: 'the edited harness completed the deliverable',
      label: 'inv1',
      runId: 'run-3',
      experience: LESSON,
    })

    expect('rejected' in result).toBe(false)
    const tree = await lib.treeOf('task-7')
    expect(tree['AGENTS.md']).toBe('Answer the question.')
    expect(await lib.experienceOf('task-7')).toEqual(LESSON)
  })

  it('records the adoption, the run, and the why', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, {
      why: 'the edited harness completed the deliverable',
      label: 'inv1',
      runId: 'run-3',
      experience: LESSON,
    })

    const record = await readFile(join(lib.entryDir('task-7'), 'EXPERIENCE.md'), 'utf8')
    expect(record).toContain('- adopted: `inv1`  (run `run-3`)')
    expect(record).toContain('## Why this was chosen')
    expect(record).toContain('the edited harness completed the deliverable')
    expect(record).toContain('## Transferable lesson')
  })

  it('records an adoption with no run and no why', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })

    const record = await readFile(join(lib.entryDir('task-7'), 'EXPERIENCE.md'), 'utf8')
    expect(record).toContain('- adopted: ``')
    expect(record).not.toContain('## Why this was chosen')
  })

  it('writes nothing when the lesson is missing a required field', async () => {
    // The gate is the anti-hallucination core: a lesson with no evidence is a guess, and
    // a guess stored in the library is read by every later task as a domain fact.
    const lib = await library(await scratch())
    const result = await lib.add('task-7', HARNESS, {
      experience: { cue: 'a shape', lesson: 'an operation' },
    })

    expect('rejected' in result).toBe(true)
    expect(await lib.entries()).toEqual([])
    expect(await lib.exists()).toBe(false)
  })

  it('writes nothing when there is no lesson at all', async () => {
    const lib = await library(await scratch())
    const result = await lib.add('task-7', HARNESS)

    expect('rejected' in result).toBe(true)
    expect(await lib.entries()).toEqual([])
  })

  it('replaces an entry stored under the same task id', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })
    await lib.add('task-7', { 'AGENTS.md': 'Answer differently.' }, { experience: LESSON })

    const tree = await lib.treeOf('task-7')
    expect(tree['AGENTS.md']).toBe('Answer differently.')
    expect(await lib.entries()).toEqual(['task-7'])
  })
})

describe('Library index', () => {
  it('names the entries and their cues', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { why: 'it completed the deliverable', label: 'inv1', experience: LESSON })

    const index = await readFile(lib.index, 'utf8')
    expect(index).toContain('# Library — finance')
    expect(index).toContain('harnesses/task-7/')
    expect(index).toContain(LESSON.cue)
  })

  it('says so when the domain is empty', async () => {
    const lib = await library(await scratch())
    await lib.rebuildIndex()

    const index = await readFile(lib.index, 'utf8')
    expect(index).toContain('_(empty — this is the first task in this domain)_')
  })

  it('is regenerated from what is on disk', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })
    // A stale index must not survive: the index is derived, never authored.
    await writeFile(lib.index, 'stale', 'utf8')
    await lib.rebuildIndex()

    expect(await readFile(lib.index, 'utf8')).toContain('harnesses/task-7/')
  })

  it('omits the cue line for an entry whose record carries none', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })
    // A record with no cue is still a record; the index says what it holds rather than
    // inventing a cue line for it.
    await writeFile(join(lib.entryDir('task-7'), 'EXPERIENCE.md'), '# task-7\n', 'utf8')
    await lib.rebuildIndex()

    expect(await readFile(lib.index, 'utf8')).not.toContain('- cue:')
  })
})

describe('Library.forget', () => {
  it('drops the entries it names and rebuilds the index', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })
    await lib.add('task-8', HARNESS, { experience: LESSON })

    const dropped = await lib.forget(['task-7'])
    expect(dropped).toEqual(['task-7'])
    expect(await lib.entries()).toEqual(['task-8'])
    expect(await readFile(lib.index, 'utf8')).not.toContain('harnesses/task-7/')
  })

  it('ignores a task it never stored', async () => {
    const lib = await library(await scratch())
    expect(await lib.forget(['never-there'])).toEqual([])
  })
})

describe('field', () => {
  it('reads one field out of a stored record', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })

    const path = join(lib.entryDir('task-7'), 'EXPERIENCE.md')
    expect(await field(path, 'cue')).toBe(LESSON.cue)
    expect(await field(path, 'lesson')).toBe(LESSON.lesson)
  })

  it('returns nothing for a field the record does not carry', async () => {
    const root = await scratch()
    const path = join(root, 'nothing.md')
    await mkdir(root, { recursive: true })
    await writeFile(path, '# nothing\n', 'utf8')
    expect(await field(path, 'cue')).toBe('')
  })

  it('returns nothing for a record that is not there', async () => {
    expect(await field(join(await scratch(), 'missing.md'), 'cue')).toBe('')
  })
})

describe('Library entries', () => {
  it('reports that the domain has no index before one is written', async () => {
    const lib = await library(await scratch())
    expect(await lib.exists()).toBe(false)
  })

  it('reports that the domain has an index once one is written', async () => {
    const lib = await library(await scratch())
    await lib.add('task-7', HARNESS, { experience: LESSON })
    expect(await lib.exists()).toBe(true)
  })

  it('finds no lesson for an entry that holds none', async () => {
    const lib = await library(await scratch())
    expect(await lib.experienceOf('never-stored')).toBeUndefined()
  })

  it('finds no harness for an entry that holds none', async () => {
    const lib = await library(await scratch())
    expect(await lib.treeOf('never-stored')).toEqual({})
  })
})

describe('Library storage layout', () => {
  it('keeps one domain in one directory', async () => {
    const root = await scratch()
    const lib = await library(root, 'finance')
    await lib.add('task-7', HARNESS, { experience: LESSON })

    const entries = await readdir(join(root, 'finance', 'harnesses', 'task-7'))
    expect(entries.sort()).toEqual(['EXPERIENCE.md', 'harness'])
  })

  it('keeps two domains apart', async () => {
    const root = await scratch()
    await (await library(root, 'finance')).add('task-7', HARNESS, { experience: LESSON })
    await (await library(root, 'legal')).add('task-7', HARNESS, { experience: LESSON })

    expect(await (await library(root, 'finance')).entries()).toEqual(['task-7'])
    expect(await (await library(root, 'legal')).entries()).toEqual(['task-7'])
    expect(await (await library(root, 'legal')).experienceOf('task-7')).toEqual(LESSON)
  })
})
