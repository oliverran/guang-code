/**
 * Anonymising the candidate pool.
 *
 * A selector that can tell which candidate came from the unmodified harness and which came
 * from an adapted one is not choosing between outputs — it is choosing a story about how
 * they were made. So the pool it sees is shuffled and relabelled, and the labels carry no
 * information about the candidate behind them.
 *
 * Two properties matter and they pull in opposite directions:
 *
 * - The mapping must be STABLE across reruns, so the same pool produces the same ids and a
 *   rerun after a failure selects among the same letters. It is derived from a hash of the
 *   task and the round, not from a random source.
 * - The mapping must be a SHUFFLE, so position in the pool says nothing about which
 *   candidate is which. The labels are sorted first and then shuffled, so a candidate's id
 *   does not track its label's alphabetical position.
 *
 * @module
 */

/** One candidate as the selector sees it. */
export interface PoolEntry {
  /** The candidate's own label, which the selector never sees. */
  readonly label: string
  /** The anonymous id the selector chooses by. */
  readonly id: string
  /** What the candidate produced, which is what the selector judges. */
  readonly produced: string
}

/**
 * The anonymous id for one index: A, B, … Z, AA, AB, …
 *
 * The alphabet is letters only, so an id is always something the choice parser accepts and
 * never something a candidate's own label could be mistaken for.
 * @param index - the candidate's position, counting from zero.
 * @returns the anonymous id.
 */
export function anonId(index: number): string {
  let out = ''
  let n = index + 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    out = String.fromCharCode(65 + remainder) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * A 32-bit hash of a seed string, as a signed integer.
 *
 * The pool's shuffle is derived from this, so the same task and round always produce the
 * same order without a random source.
 * @param seed - the string to hash.
 * @returns the hash as a signed integer.
 */
function hashSeed(seed: string): number {
  // FNV-1a, 32 bits. The hash only has to be stable and well spread; it is not a
  // security boundary, and the pool it orders is already anonymous to the selector.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/**
 * A seeded pseudo-random sequence: the same seed always yields the same numbers.
 *
 * A multiplicative congruential generator is enough here: the pool is a handful of
 * candidates, and the requirement is reproducibility rather than statistical quality.
 * @param seed - the seed.
 * @returns the generator.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/**
 * A seeded permutation of the indices `0..count-1`.
 *
 * The permutation is applied to the candidate list rather than the list itself, so the
 * shuffle is one pure function of a count and a generator: the same count and seed always
 * yield the same order.
 * @param count - how many indices to permute.
 * @param random - the generator.
 * @returns the permuted indices.
 */
function shuffledIndices(count: number, random: () => number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index)
  for (let index = indices.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    const held = indices[index] as number
    indices[index] = indices[other] as number
    indices[other] = held
  }
  return indices
}

/**
 * The pool the selector chooses among, with each candidate's own label hidden.
 *
 * The candidates are sorted by their own labels and then shuffled, so the anonymous ids
 * are not in the candidates' label order. The sort makes the starting point deterministic;
 * the shuffle is what removes the order.
 * @param candidates - the candidates, each with its label and what it produced.
 * @param seed - the seed; the same seed and the same candidates give the same pool.
 * @returns the pool, in the order the ids were assigned.
 */
export function buildPool(
  candidates: readonly { readonly label: string; readonly produced: string }[],
  seed: string,
): PoolEntry[] {
  const ordered = [...candidates].sort((left, right) => left.label.localeCompare(right.label))
  const order = shuffledIndices(ordered.length, seededRandom(hashSeed(seed)))
  return order.map((position, index) => {
    const candidate = ordered[position] as { readonly label: string; readonly produced: string }
    return { label: candidate.label, id: anonId(index), produced: candidate.produced }
  })
}

/**
 * The candidate behind one anonymous id.
 * @param pool - the pool the selector chose from.
 * @param id - the anonymous id the selector named.
 * @returns the pool entry, or undefined when no candidate carries that id.
 */
export function entryFor(pool: readonly PoolEntry[], id: string): PoolEntry | undefined {
  return pool.find(entry => entry.id === id)
}
