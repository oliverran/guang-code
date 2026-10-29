import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { writePool } from '../src/index.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-ppc-compose-'))
}

const CANDIDATES = [
  { label: 'base', produced: 'the first answer', delivered: true },
  { label: 'inv1', produced: 'the second answer', delivered: true },
]

describe('writePool', () => {
  it('writes one file per candidate, named by its anonymous id', async () => {
    const root = join(await scratch(), 'pool')
    const pool = await writePool({
      root,
      task: 'do the thing',
      candidates: CANDIDATES,
      seed: 'seed',
    })

    const files = (await readdir(join(root, 'candidates'))).sort()
    expect(files).toEqual(['A.md', 'B.md'])
    expect(pool.ids).toEqual(['A', 'B'])
  })

  it('writes the task verbatim', async () => {
    const root = join(await scratch(), 'pool')
    await writePool({
      root,
      task: 'the exact task text',
      candidates: CANDIDATES,
      seed: 'seed',
    })

    expect(await readFile(join(root, 'task.md'), 'utf8')).toBe('the exact task text')
  })

  it('keeps the candidate labels out of the pool', async () => {
    // A label names the candidate's ROLE — base, inv1, dom1 — and a role says which
    // harness produced the output. A pool that carried them would not be anonymous.
    const root = join(await scratch(), 'pool')
    await writePool({
      root,
      task: 'do the thing',
      candidates: [
        { label: 'base', produced: 'the first answer', delivered: true },
        { label: 'inv1', produced: 'the second answer', delivered: true },
      ],
      seed: 'seed',
    })

    const files = await readdir(join(root, 'candidates'))
    expect(files.every(file => !file.includes('base') && !file.includes('inv1'))).toBe(true)
    for (const file of files) {
      const body = await readFile(join(root, 'candidates', file), 'utf8')
      expect(body).not.toContain('inv1')
      expect(body).not.toContain('base')
    }
  })

  it('drops a candidate that produced nothing, and says so', async () => {
    const root = join(await scratch(), 'pool')
    const pool = await writePool({
      root,
      task: 'do the thing',
      candidates: [
        { label: 'base', produced: 'the base answer', delivered: true },
        { label: 'dead', produced: '', delivered: false },
      ],
      seed: 'seed',
    })

    expect(pool.entries.map(entry => entry.label)).toEqual(['base'])
    expect(pool.dropped).toEqual([{ label: 'dead', reason: 'the run did not deliver a completed turn' }])
  })

  it('drops a delivered candidate whose output is blank', async () => {
    const root = join(await scratch(), 'pool')
    const pool = await writePool({
      root,
      task: 'do the thing',
      candidates: [{ label: 'blank', produced: '   \n  ', delivered: true }],
      seed: 'seed',
    })

    expect(pool.entries).toHaveLength(0)
    expect(pool.dropped).toEqual([{ label: 'blank', reason: 'the run produced no output' }])
  })

  it('writes the source material when the caller has one', async () => {
    const root = join(await scratch(), 'pool')
    const pool = await writePool({
      root,
      task: 'do the thing',
      candidates: CANDIDATES,
      source: { 'data.csv': 'a,b\n1,2\n' },
      seed: 'seed',
    })

    expect(await readFile(join(root, 'source', 'data.csv'), 'utf8')).toBe('a,b\n1,2\n')
    expect(pool.layout).toContain('source/')
  })

  it('names only what exists in the layout', async () => {
    const root = join(await scratch(), 'pool')
    const pool = await writePool({
      root,
      task: 'do the thing',
      candidates: CANDIDATES,
      seed: 'seed',
    })

    expect(pool.layout).toContain('task.md')
    expect(pool.layout).toContain('candidates/<id>.md')
    expect(pool.layout).not.toContain('source/')
  })

  it('keeps the whole output, untrimmed', async () => {
    // A truncated candidate is a different candidate: the selector judges what it can
    // see, and what it cannot see it cannot judge.
    const root = join(await scratch(), 'pool')
    const body = 'line\n'.repeat(500)
    await writePool({
      root,
      task: 'do the thing',
      candidates: [{ label: 'base', produced: body, delivered: true }],
      seed: 'seed',
    })

    const written = await readFile(join(root, 'candidates', 'A.md'), 'utf8')
    expect(written).toContain(body)
  })

  it('replaces the directory it writes into', async () => {
    const root = join(await scratch(), 'pool')
    await writePool({
      root,
      task: 'do the thing',
      candidates: CANDIDATES,
      seed: 'seed',
    })
    const second = await writePool({
      root,
      task: 'do the thing again',
      candidates: [{ label: 'base', produced: 'only one now', delivered: true }],
      seed: 'seed',
    })

    expect(second.entries).toHaveLength(1)
    expect((await readdir(join(root, 'candidates'))).sort()).toEqual(['A.md'])
  })
})
