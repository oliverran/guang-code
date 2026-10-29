/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-propose`.
 * @module @deepseek-ai/dsh-ppc-propose/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-propose'

/** Cordis companion plugin name. */
export const name = 'ppc-propose-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package runs an editor session and reads back the tree it left.
 * It registers no service, owns no event stream, and mutates no shared data — the editor
 * session's own log is DSH's session log, and the proposal it produces is validated by
 * `dsh-ppc-surface` before any rollout.
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
