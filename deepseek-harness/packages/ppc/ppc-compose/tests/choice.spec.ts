import { describe, expect, it } from 'vitest'

import { parseChoice } from '../src/index.ts'

describe('parseChoice', () => {
  it('reads the id from the choice block', () => {
    const choice = parseChoice('reasoning\n```choice\nB\n```', ['A', 'B'])
    expect(choice?.id).toBe('B')
  })

  it('reads the reasoning from the why block', () => {
    const choice = parseChoice(
      '<why>\nDELIVERY decided it; A left out the summary.\n</why>\n```choice\nA\n```',
      ['A', 'B'],
    )
    expect(choice?.why).toBe('DELIVERY decided it; A left out the summary.')
  })

  it('accepts a choice block with no newline after the fence', () => {
    const choice = parseChoice('```choice\nC```', ['A', 'B', 'C'])
    expect(choice?.id).toBe('C')
  })

  it('rejects a reply with no choice block', () => {
    // Without a decision there is nothing to honour, and guessing one would deliver an
    // output nobody chose.
    expect(parseChoice('I think A is better.', ['A', 'B'])).toBeUndefined()
  })

  it('rejects an id the pool never issued', () => {
    expect(parseChoice('```choice\nZ\n```', ['A', 'B'])).toBeUndefined()
  })

  it('accepts a reply with no why block', () => {
    const choice = parseChoice('```choice\nA\n```', ['A'])
    expect(choice?.id).toBe('A')
    expect(choice?.why).toBe('')
  })

  it('reads the first choice block when the reply carries two', () => {
    const choice = parseChoice('```choice\nA\n```\nand again\n```choice\nB\n```', ['A', 'B'])
    expect(choice?.id).toBe('A')
  })
})
