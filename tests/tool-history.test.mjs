import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./helpers/tool-history.mjs', import.meta.url));
for (const [scenario, description] of [
  ['continued', 'the next query retains previous tool input and output without executing it again'],
  ['reopened', 'reopening a session retains tool context for the next query'],
  ['multiple', 'multiple saved tool calls retain their order and appear once'],
  ['denied', 'a denied tool result remains available in the next query'],
  ['failed', 'a failed tool result remains available in the next query'],
  ['redacted', 'saved tool output stays redacted when restored to model context'],
  ['omitted-input', 'restored Write and Edit inputs preserve omitted bodies without replaying changes'],
  ['legacy', 'older tool transcripts without message IDs remain usable'],
  ['web', 'Web reload and continuation send the saved tool context to the model'],
  ['interrupted', 'interrupted tool history stays separate from the next user instruction'],
]) {
  test(description, async t => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'guang-tool-history-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(path.join(cwd, '.guang-code'));
    await writeFile(path.join(cwd, '.guang-code/config.json'), JSON.stringify({ memoryEnabled: false }));
    await writeFile(path.join(cwd, 'example.txt'), 'The project uses the violet adapter.\n');
    // A fabricated key-like string verifies redaction; no actual credentials are used.
    await writeFile(path.join(cwd, 'redacted.txt'), 'sk-' + 'z'.repeat(28));
    const result = spawnSync(process.execPath, [fixture, scenario], {
      cwd,
      env: {
        HOME: cwd, USERPROFILE: cwd, PATH: '', NO_COLOR: '1',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
