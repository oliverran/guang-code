/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-surface`.
 * @module @deepseek-ai/dsh-ppc-surface/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-surface'

/** Cordis companion plugin name. */
export const name = 'ppc-surface-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package holds a static path predicate and a pure validator over
 * caller-supplied trees. It registers no service, owns no event stream, and mutates no shared
 * data — a proposal is validated before it is rolled out, so no runtime relationship exists to
 * assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
