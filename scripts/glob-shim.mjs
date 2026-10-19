// ============================================================
//  ESM shim for `glob@7` (which only ships CJS).
//  Exposes the named `glob` export so dist/tools/GlobTool.js etc.
//  can keep using `import { glob } from 'glob'`.
// ============================================================
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const g = require('glob');

export const glob = g.glob;
export const globSync = g.sync;
export const Glob = g.Glob;
export const hasMagic = g.hasMagic;
export default g;
