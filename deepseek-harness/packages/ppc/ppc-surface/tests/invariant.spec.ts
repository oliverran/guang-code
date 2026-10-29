import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'

import * as surfaceInvariant from '../src/invariant.ts'

describe('ppc-surface invariant companion', () => {
  it('registers the package under its own name and hands back a disposer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    const dispose = await surfaceInvariant.apply(ctx)

    expect(surfaceInvariant.name).toBe('ppc-surface-invariant')
    expect(surfaceInvariant.inject).toEqual(['invariants'])
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('reserves the package name, so a second registration is refused', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await surfaceInvariant.apply(ctx)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-ppc-surface', () => {})
    }).toThrow(/already registered/)
  })
})
