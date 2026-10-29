/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-probe`.
 * @module @deepseek-ai/dsh-ppc-probe/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-probe'

/** Cordis companion plugin name. */
export const name = 'ppc-probe-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package runs a candidate harness as an ordinary agent session
 * and reads the session log back. The harness's own events are DSH's events, and the
 * session log's integrity is the session package's invariant — a probe adds no relation
 * of its own to assert.
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
