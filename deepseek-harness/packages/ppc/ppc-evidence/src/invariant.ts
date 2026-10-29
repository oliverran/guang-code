/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ppc-evidence`.
 * @module @deepseek-ai/dsh-ppc-evidence/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ppc-evidence'

/** Cordis companion plugin name. */
export const name = 'ppc-evidence-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package reads session logs and writes files under a caller-owned root.
 * It registers no service, owns no event stream, and mutates no shared data — a trajectory is a
 * derived view of `Session.events`, and `isAppendSurfaceEvent` already enforces the one relation
 * that matters (a compaction fold is not transcript).
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
