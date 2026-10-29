import { describe, expect, it } from 'vitest'

import { diffTree } from '../src/index.ts'
import type { HarnessTree } from '../src/index.ts'

const BASE: HarnessTree = {
  'PERSONA.md': 'You are precise.',
  'AGENTS.md': 'You are a coding agent.\nAlways run the tests.',
}

describe('diffTree', () => {
  it('reports nothing when the two trees are equal', () => {
    expect(diffTree(BASE, { ...BASE }, 'inv1')).toBe('')
  })

  it('shows the lines a candidate changed', () => {
    const diff = diffTree(BASE, { ...BASE, 'AGENTS.md': 'You are a coding agent.\nNever skip the tests.' }, 'inv1')

    expect(diff).toContain('--- current/AGENTS.md')
    expect(diff).toContain('+++ inv1/AGENTS.md')
    expect(diff).toContain('-Always run the tests.')
    expect(diff).toContain('+Never skip the tests.')
    // The unchanged line is context, not a change.
    expect(diff).toContain(' You are a coding agent.')
  })

  it('shows an added file as an addition', () => {
    const diff = diffTree(BASE, { ...BASE, '.dsh/skills/review/SKILL.md': 'review it\n' }, 'inv1')

    expect(diff).toContain('--- current/.dsh/skills/review/SKILL.md')
    expect(diff).toContain('+++ inv1/.dsh/skills/review/SKILL.md')
    expect(diff).toContain('+review it')
  })

  it('shows a removed file as a deletion', () => {
    const diff = diffTree(BASE, { 'PERSONA.md': BASE['PERSONA.md'] }, 'inv1')

    expect(diff).toContain('--- current/AGENTS.md')
    expect(diff).toContain('-You are a coding agent.')
    expect(diff).toContain('-Always run the tests.')
  })

  it('orders the files it shows, so the same pair always produces the same bytes', () => {
    const candidate = {
      'AGENTS.md': 'changed\n',
      '.dsh/skills/review/SKILL.md': 'new\n',
      'PERSONA.md': 'changed persona\n',
    }
    const diff = diffTree(BASE, candidate, 'inv1')

    // The paths are sorted, and `.` sorts before letters, so the skill bundle comes first.
    const order = ['.dsh/skills/review/SKILL.md', 'AGENTS.md', 'PERSONA.md']
      .map(path => diff.indexOf(path))
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('keeps a change far from its neighbour out of the same hunk', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 0', 'line zero').replace('line 29', 'line twenty-nine')
    const diff = diffTree({ 'AGENTS.md': before }, { 'AGENTS.md': after }, 'inv1')

    // Two changes 29 lines apart are two hunks: a reader sees where each one is.
    expect(diff.match(/@@ /g)).toHaveLength(2)
  })

  it('carries the context around a change', () => {
    const before = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 5', 'line five')
    const diff = diffTree({ 'AGENTS.md': before }, { 'AGENTS.md': after }, 'inv1')

    expect(diff).toContain(' line 3')
    expect(diff).toContain(' line 4')
    expect(diff).toContain('-line 5')
    expect(diff).toContain('+line five')
    expect(diff).toContain(' line 7')
  })

  it('names the hunk the way a unified diff names it', () => {
    const diff = diffTree(
      { 'AGENTS.md': 'one\ntwo\nthree\n' },
      { 'AGENTS.md': 'one\ntwo changed\nthree\n' },
      'inv1',
    )

    expect(diff).toContain('@@ -1,3 +1,3 @@')
  })

  it('reports nothing when two texts differ only in a trailing newline', () => {
    expect(diffTree({ 'AGENTS.md': 'one\ntwo\n' }, { 'AGENTS.md': 'one\ntwo' }, 'inv1')).toBe('')
  })

  it('replaces the whole file when the LCS table would exceed its cap', () => {
    const before = Array.from({ length: 1001 }, (_, index) => `line ${index}`).join('\n')
    const after = Array.from({ length: 1001 }, (_, index) => `other ${index}`).join('\n')

    const diff = diffTree({ 'AGENTS.md': before }, { 'AGENTS.md': after }, 'inv1')

    expect(diff).toContain('-line 0')
    expect(diff).toContain('-line 1000')
    expect(diff).toContain('+other 0')
    expect(diff).toContain('+other 1000')
  })
})
