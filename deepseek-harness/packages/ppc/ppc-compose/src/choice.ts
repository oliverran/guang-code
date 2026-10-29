/**
 * Reading the selector's answer.
 *
 * The selector replies with a `<why>` block and a ```choice block. The choice block is the
 * decision; the why is the reasoning a person reads afterwards. A reply that carries no
 * choice block, or one naming an id the pool never issued, is not a decision — and a
 * decision that cannot be read must not be guessed at, because a guess is a selection
 * nobody made.
 *
 * @module
 */

/** The anonymous id the selector chose, and the reasoning it gave. */
export interface ParsedChoice {
  /** The anonymous id the selector named. */
  readonly id: string
  /** The selector's reasoning, trimmed; empty when the reply carried no `<why>` block. */
  readonly why: string
}

/** The choice block: a fenced block whose first line names one id. */
const CHOICE = /```choice\s*\n?\s*([A-Za-z0-9_-]+)\s*\n?\s*```/s
/** The reasoning block. */
const WHY = /<why>([\s\S]*?)<\/why>/

/**
 * Read whatever id the selector named, without judging it.
 *
 * The named id is separated from the judgement because the judgement needs the pool and
 * the record of the failure needs the id: "the selector named Z" says more about what
 * happened than "the selector named an id that is not one of A, B".
 * @param reply - the selector's final assistant text.
 * @returns the named choice, or undefined when the reply carries no choice block.
 */
export function namedChoice(reply: string): ParsedChoice | undefined {
  const match = CHOICE.exec(reply)
  const id = match?.[1]?.trim()
  if (id === undefined) return undefined
  const why = WHY.exec(reply)?.[1]?.trim() ?? ''
  return { id, why }
}

/**
 * Read the selector's choice out of its reply.
 *
 * The id is validated against the pool's own ids, not merely against the shape of an id:
 * a selector that names `C` when the pool issued `A` and `B` has produced a decision that
 * cannot be honoured, and treating it as one would deliver an output nobody chose.
 * @param reply - the selector's final assistant text.
 * @param ids - the ids the pool issued.
 * @returns the choice, or undefined when the reply carries no usable decision.
 */
export function parseChoice(reply: string, ids: readonly string[]): ParsedChoice | undefined {
  const choice = namedChoice(reply)
  if (choice === undefined || !ids.includes(choice.id)) return undefined
  return choice
}
