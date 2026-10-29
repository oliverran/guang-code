/**
 * The experience record: the one lesson an improvement round may contribute to the library.
 *
 * An experience is a claim about what to do differently next time, and it rests on three
 * parts that cannot substitute for one another:
 *
 * - **cue** — the SHAPE of situation the lesson applies to, so it can fire on a different
 *   matter. Not this task's facts: the pattern.
 * - **lesson** — the operation to perform on a harness, stated so it can be applied and
 *   checked, naming the component it concerns.
 * - **evidence** — the execution contrast the lesson rests on. Which runs, which moments.
 * - **confidence** — how much the record supports the claim, and why.
 *
 * The gate is deliberately strict. harness2's `has_experience` requires the first three to
 * be non-empty strings, and that requirement IS the anti-hallucination core of the method:
 * a lesson with no evidence is a guess, and a guess written into a library is read by every
 * later task in the domain as though it were a fact about that domain. A round that cannot
 * support a lesson therefore contributes NOTHING — not a half-entry, not an entry with an
 * empty field. The library stays empty of guesses by being unable to hold one.
 *
 * @module
 */

/** The four fields one experience carries. */
export interface Experience {
  /** The shape of situation the lesson applies to. */
  readonly cue: string
  /** The transferable operation, naming the component it concerns. */
  readonly lesson: string
  /** The execution contrast the lesson rests on. */
  readonly evidence: string
  /** How much the record supports the claim, and why. */
  readonly confidence?: string
}

/** The fields a lesson must carry to enter the library. */
export const REQUIRED_FIELDS = ['cue', 'lesson', 'evidence'] as const

/** One field a lesson must carry to enter the library. */
export type RequiredField = typeof REQUIRED_FIELDS[number]

/**
 * The fields a lesson is missing, in a fixed order.
 *
 * The order is the order the fields are listed in the record itself, so the answer names
 * the gap the way the writer would have written it.
 * @param experience - the experience to check, as the caller received it.
 * @returns the missing field names; empty when the lesson may enter the library.
 */
export function missingFields(experience: Partial<Experience> | undefined): RequiredField[] {
  if (experience === undefined) return [...REQUIRED_FIELDS]
  const missing: RequiredField[] = []
  for (const field of REQUIRED_FIELDS) {
    const value = experience[field]
    if (typeof value !== 'string' || value.trim().length === 0) missing.push(field)
  }
  return missing
}

/**
 * Whether a lesson may enter the library.
 *
 * The three required fields must each be a non-empty string. `confidence` is optional: it
 * qualifies a lesson, and a lesson that states its own support plainly is still a lesson.
 * @param experience - the experience to check.
 * @returns whether the lesson may be stored.
 */
export function hasExperience(experience: Partial<Experience> | undefined): experience is Experience {
  return missingFields(experience).length === 0
}

/**
 * Read one experience from a `<experience>` block or a line-oriented record.
 *
 * The block form is the one an agent writes (`cue: …` on its own line); the record form is
 * the one this package stores (`- **cue**: …`). Both are read, because a lesson arrives
 * from a model in the first form and is written back in the second.
 * @param text - the block or record body.
 * @returns the fields that were present, and nothing that was not.
 */
export function parseExperience(text: string): Partial<Experience> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^\s*(?:-\s*\*\*)?(cue|lesson|evidence|confidence)(?:\*\*)?\s*:\s*(.*)$/i.exec(line)
    if (match === null) continue
    const key = match[1]?.toLowerCase()
    const value = match[2]?.trim()
    if (key === undefined || value === undefined || value.length === 0) continue
    // The first non-empty statement of a field is the one the writer meant; a repeated
    // field is a restatement, not a correction.
    if (out[key] !== undefined) continue
    out[key] = value
  }
  return out
}

/**
 * Render one experience as the field list a stored record carries.
 * @param experience - the experience to render.
 * @returns the rendered lines, without a trailing newline.
 */
export function renderExperience(experience: Experience): string {
  const lines: string[] = []
  for (const field of REQUIRED_FIELDS) {
    lines.push(`- **${field}**: ${experience[field].trim()}`)
  }
  if (experience.confidence !== undefined && experience.confidence.trim().length > 0) {
    lines.push(`- **confidence**: ${experience.confidence.trim()}`)
  }
  return lines.join('\n')
}
