import { describe, expect, it } from 'vitest'

import { anonId, buildPool, entryFor } from '../src/index.ts'

describe('anonId', () => {
  it('numbers the pool with letters', () => {
    expect(anonId(0)).toBe('A')
    expect(anonId(25)).toBe('Z')
  })

  it('continues with two letters past the alphabet', () => {
    expect(anonId(26)).toBe('AA')
    expect(anonId(27)).toBe('AB')
  })

  it('never produces an id a candidate label could be mistaken for', () => {
    // The ids are letters only, so the choice parser always accepts one and a label like
    // `inv1` can never be read as an id.
    for (let index = 0; index < 100; index++) {
      expect(anonId(index)).toMatch(/^[A-Z]+$/)
    }
  })
})

describe('buildPool', () => {
  const candidates = [
    { label: 'base', produced: 'the base output' },
    { label: 'inv1', produced: 'the inv1 output' },
    { label: 'dom1', produced: 'the dom1 output' },
  ]

  it('gives every candidate an id', () => {
    const pool = buildPool(candidates, 'seed')
    expect(pool.map(entry => entry.id)).toEqual(['A', 'B', 'C'])
  })

  it('keeps the candidate behind each id', () => {
    const pool = buildPool(candidates, 'seed')
    expect(pool.map(entry => entry.label).sort()).toEqual(['base', 'dom1', 'inv1'])
    for (const entry of pool) {
      expect(entry.produced).toBe(`the ${entry.label} output`)
    }
  })

  it('gives the same pool for the same seed', () => {
    // A rerun after a failure must select among the same letters, or the ids in the
    // reasoning no longer name the candidates they named before.
    expect(buildPool(candidates, 'seed')).toEqual(buildPool(candidates, 'seed'))
  })

  it('gives a different order for a different seed', () => {
    // The order carries no information about the candidate, so it must not be a
    // fixed function of the candidates themselves.
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const orders = new Set(seeds.map(seed => buildPool(candidates, seed)
      .map(entry => entry.label)
      .join(',')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('does not keep the candidates in label order', () => {
    // Sorting first and shuffling after is what breaks the tie between "the first
    // candidate alphabetically" and "the first candidate shown".
    const ordered = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      .map(label => ({ label, produced: label }))
    const seeds = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']
    const shuffled = seeds.some(seed => buildPool(ordered, seed)
      .map(entry => entry.label)
      .join(',') !== ordered.map(entry => entry.label).join(','))
    expect(shuffled).toBe(true)
  })

  it('orders the pool by the ids it assigned', () => {
    const pool = buildPool(candidates, 'seed')
    expect(pool.map(entry => entry.id)).toEqual(['A', 'B', 'C'])
  })
})

describe('entryFor', () => {
  it('finds the candidate behind an id', () => {
    const pool = buildPool([
      { label: 'base', produced: 'x' },
      { label: 'inv1', produced: 'y' },
    ], 'seed')
    const entry = entryFor(pool, pool[0]?.id ?? '')
    expect(entry?.label).toBe(pool[0]?.label)
  })

  it('returns undefined for an id the pool never issued', () => {
    const pool = buildPool([{ label: 'base', produced: 'x' }], 'seed')
    expect(entryFor(pool, 'Z')).toBeUndefined()
  })
})
