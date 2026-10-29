/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-library`.
 * @module @deepseek-ai/dsh-ppc-library/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-library'

/** Cordis companion plugin name. */
export const name = 'ppc-library-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package writes a library of files under a caller-owned root
 * and reads them back. Its one hard rule — a lesson missing a required field is not
 * written — is enforced in the operation that writes it, because the write is the only
 * place the rule can be enforced: a later read finds only what the write allowed.
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
