import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scenarioFile = fileURLToPath(new URL('./helpers/session-persistence.mjs', import.meta.url));
for (const [scenario, description] of [
  ['plain', 'plain assistant replies survive a fresh session-store read'],
  ['rounds', 'repeated input history is saved once across query turns'],
  ['legacy', 'older Web history without IDs is preserved without replaying it'],
  ['tools', 'multiple tool iterations save each message and the final reply once'],
  ['web', 'Web chat reload and continuation use the saved history without duplicate prompts'],
  ['restart', 'session event sequence and hash chain continue after unloading or restarting'],
  ['concurrent', 'concurrent appends in one store keep a continuous event sequence'],
  ['failed-append', 'a failed append does not block the next queued write'],
  ['snapshot', 'automatic snapshots and reopening preserve the event tail'],
]) {
  test(description, async t => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'guang-session-test-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(path.join(cwd, '.guang-code'));
    await writeFile(path.join(cwd, '.guang-code/config.json'), JSON.stringify({ memoryEnabled: false }));
    await writeFile(path.join(cwd, 'example.txt'), 'Offline fixture\n');
    const result = spawnSync(process.execPath, [scenarioFile, scenario], {
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
