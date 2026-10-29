/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-compose`.
 * @module @deepseek-ai/dsh-ppc-compose/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-compose'

/** Cordis companion plugin name. */
export const name = 'ppc-compose-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package writes a pool of files, runs a selector agent session
 * over it, and reads the session log back. The pool's integrity is ordinary filesystem IO,
 * and the selector's session log is the session package's invariant — a compose adds no
 * relation of its own to assert.
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
