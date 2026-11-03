// ============================================================
//  ESM shim for `glob@7` (which only ships CJS).
//  Exposes the named `glob` export so dist/tools/GlobTool.js etc.
//  can keep using `import { glob } from 'glob'`.
// ============================================================
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const g = require('glob');

// glob@7 returns a Glob instance unless a callback is supplied. All runtime
// callers await an array of paths, so adapt its callback API to a Promise.
export const glob = promisify(g.glob);
export const globSync = g.sync;
export const Glob = g.Glob;
export const hasMagic = g.hasMagic;
export default g;
