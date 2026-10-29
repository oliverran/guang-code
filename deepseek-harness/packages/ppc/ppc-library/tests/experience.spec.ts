import { describe, expect, it } from 'vitest'

import {
  hasExperience,
  missingFields,
  parseExperience,
  renderExperience,
  type Experience,
} from '../src/index.ts'

const COMPLETE: Experience = {
  cue: 'when an instrument performs several sequential acts and one terminates the actor',
  lesson: 'order the acts so the terminating act comes last, in the AGENTS.md procedure',
  evidence: 'the base rollout stopped after the second act; the edited one finished',
  confidence: 'high — two rollouts, one divergence point',
}

describe('hasExperience', () => {
  it('accepts a lesson that carries all three required fields', () => {
    expect(hasExperience(COMPLETE)).toBe(true)
  })

  it('accepts a lesson without a confidence', () => {
    // Confidence qualifies a lesson; a lesson that states its support plainly is still
    // a lesson, and harness2's own gate does not require the field.
    const { confidence: _confidence, ...withoutConfidence } = COMPLETE
    expect(hasExperience(withoutConfidence)).toBe(true)
  })

  it('rejects a lesson whose cue is empty', () => {
    expect(hasExperience({ ...COMPLETE, cue: '  ' })).toBe(false)
  })

  it('rejects a lesson whose lesson is missing', () => {
    expect(hasExperience({ ...COMPLETE, lesson: undefined })).toBe(false)
  })

  it('rejects a lesson whose evidence is missing', () => {
    // The evidence is what separates a supported lesson from a guess, and a guess written
    // into a library is read by every later task as a fact about the domain.
    expect(hasExperience({ ...COMPLETE, evidence: '' })).toBe(false)
  })

  it('rejects a missing lesson outright', () => {
    expect(hasExperience(undefined)).toBe(false)
  })
})

describe('missingFields', () => {
  it('names every missing field in the order the record lists them', () => {
    expect(missingFields({})).toEqual(['cue', 'lesson', 'evidence'])
    expect(missingFields(undefined)).toEqual(['cue', 'lesson', 'evidence'])
    expect(missingFields({ ...COMPLETE, lesson: '' })).toEqual(['lesson'])
  })
})

describe('parseExperience', () => {
  it('reads the block form an agent writes', () => {
    const parsed = parseExperience([
      'cue: when a tool times out on a large file',
      'lesson: read the file in chunks, in the helper script',
      'evidence: the base rollout burned its budget on one read',
      'confidence: medium — one rollout',
    ].join('\n'))

    expect(parsed.cue).toBe('when a tool times out on a large file')
    expect(parsed.lesson).toBe('read the file in chunks, in the helper script')
    expect(parsed.evidence).toBe('the base rollout burned its budget on one read')
    expect(parsed.confidence).toBe('medium — one rollout')
  })

  it('reads the record form this package stores', () => {
    const parsed = parseExperience(renderExperience(COMPLETE))

    expect(parsed.cue).toBe(COMPLETE.cue)
    expect(parsed.lesson).toBe(COMPLETE.lesson)
    expect(parsed.evidence).toBe(COMPLETE.evidence)
    expect(parsed.confidence).toBe(COMPLETE.confidence)
  })

  it('drops a field that was written empty', () => {
    const parsed = parseExperience('cue: something\nlesson:\nevidence: a contrast')
    expect(parsed.lesson).toBeUndefined()
  })

  it('ignores lines that are not fields', () => {
    const parsed = parseExperience('some prose\ncue: a shape of situation')
    expect(parsed.cue).toBe('a shape of situation')
  })

  it('keeps the first statement of a field that is stated twice', () => {
    const parsed = parseExperience('cue: the first shape\ncue: the second shape')
    expect(parsed.cue).toBe('the first shape')
  })
})

describe('renderExperience', () => {
  it('renders the required fields and the confidence when there is one', () => {
    const rendered = renderExperience(COMPLETE)

    expect(rendered).toContain('- **cue**: ')
    expect(rendered).toContain('- **lesson**: ')
    expect(rendered).toContain('- **evidence**: ')
    expect(rendered).toContain('- **confidence**: ')
  })

  it('omits the confidence when there is none', () => {
    const { confidence: _confidence, ...withoutConfidence } = COMPLETE
    expect(renderExperience(withoutConfidence)).not.toContain('confidence')
  })
})
