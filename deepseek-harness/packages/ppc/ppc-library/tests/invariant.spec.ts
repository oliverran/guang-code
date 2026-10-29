import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'

import * as libraryInvariant from '../src/invariant.ts'

describe('ppc-library invariant companion', () => {
  it('registers the package under its own name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    const dispose = await libraryInvariant.apply(ctx)

    expect(libraryInvariant.name).toBe('ppc-library-invariant')
    expect(libraryInvariant.inject).toEqual(['invariants'])
    dispose()
  })

  it('reserves the package name, so a second registration is refused', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await libraryInvariant.apply(ctx)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-ppc-library', () => {})
    }).toThrow(/already registered/)
  })
})
