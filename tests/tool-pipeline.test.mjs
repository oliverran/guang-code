import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import timerPromises from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PipelineAbortError, ToolPipeline } from '../dist/utils/toolPipeline.js';

// Advance deadlines explicitly instead of sleeping or depending on machine speed.
// Sync built-in exports also updates the pipeline's named setTimeout import.
function controlTimers(t) {
  const timers = [];
  t.mock.method(timerPromises, 'setTimeout', (ms, value, { signal } = {}) =>
    new Promise((resolve, reject) => {
      const timer = {
        ms,
        active: true,
        expire() {
          if (!timer.active) return;
          timer.active = false;
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
      };
      function abort() {
        if (!timer.active) return;
        timer.active = false;
        signal?.removeEventListener('abort', abort);
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      }
      timers.push(timer);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    }));
  syncBuiltinESMExports();
  t.after(() => {
    // Settle remaining mock timers even when a regression assertion fails.
    for (const timer of timers) timer.expire();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return timers;
}

function observe(promise) {
  const outcome = { status: 'pending' };
  promise.then(
    value => Object.assign(outcome, { status: 'fulfilled', value }),
    reason => Object.assign(outcome, { status: 'rejected', reason }),
  );
  return outcome;
}

// One event-loop turn flushes the promise chain without advancing mock deadlines.
const flush = () => new Promise(resolve => setImmediate(resolve));
const context = { toolName: 'Read', input: {}, callId: 'offline-tool' };

test('a completed tool returns its result before the five-minute deadline', async t => {
  const timers = controlTimers(t);
  const pipeline = new ToolPipeline();
  pipeline.addTimeout(/.*/, 300_000);
  const expected = { content: 'Offline result' };
  let calls = 0;
  const outcome = observe(pipeline.run(context, async () => { calls++; return expected; }));
  await flush();
  assert.equal(outcome.status, 'fulfilled');
  assert.equal(outcome.value.result, expected);
  assert.equal(outcome.value.aborted, undefined);
  assert.equal(calls, 1);
  assert.deepEqual(timers.map(timer => [timer.ms, timer.active]), [[300_000, false]]);
  assert.equal(pipeline.stats.successes, 1);
  assert.equal(pipeline.stats.failures, 0);
});

for (const kind of ['synchronous', 'asynchronous']) {
  test(`${kind} tool failures propagate immediately and cancel the deadline`, async t => {
    const timers = controlTimers(t);
    const pipeline = new ToolPipeline();
    pipeline.addTimeout(/.*/, 300_000);
    const expected = new Error('Offline executor failed');
    const executor = kind === 'synchronous'
      ? () => { throw expected; }
      : async () => { throw expected; };
    const outcome = observe(pipeline.run(context, executor));
    await flush();
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason, expected);
    assert.equal(timers[0].active, false);
    assert.equal(pipeline.stats.failures, 1);
  });
}

test('a hung tool returns a timeout result when its deadline expires', async t => {
  const timers = controlTimers(t);
  const pipeline = new ToolPipeline({ defaultTimeoutMs: 180_000 });
  pipeline.addTimeout('Read');
  const errors = [];
  pipeline.register('error', ctx => errors.push(ctx.error));
  let postCalls = 0;
  pipeline.register('post', (_ctx, next) => { postCalls++; return next(); });
  const outcome = observe(pipeline.run(context, () => new Promise(() => {})));
  await flush();
  assert.equal(outcome.status, 'pending');
  assert.equal(timers[0].ms, 180_000);
  timers[0].expire();
  await flush();
  assert.equal(outcome.status, 'fulfilled');
  assert.equal(outcome.value.aborted, true);
  assert.deepEqual(outcome.value.result, {
    content: 'Tool "Read" timed out after 180000ms.', isError: true,
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof PipelineAbortError);
  assert.equal(errors[0].code, 'TOOL_TIMEOUT');
  assert.equal(postCalls, 0);
  assert.equal(pipeline.stats.failures, 1);
  assert.equal(pipeline.stats.successes, 0);
});

for (const kind of ['resolution', 'rejection']) {
  test(`late tool ${kind} is handled without changing a timeout result`, async t => {
    const timers = controlTimers(t);
    const pipeline = new ToolPipeline();
    pipeline.addTimeout(/.*/, 300_000);
    let finish;
    const execution = new Promise((resolve, reject) => {
      finish = kind === 'resolution' ? resolve : reject;
    });
    const errors = [];
    pipeline.register('error', ctx => errors.push(ctx.error));
    const outcome = observe(pipeline.run(context, () => execution));
    timers[0].expire();
    await flush();
    assert.equal(outcome.status, 'fulfilled');
    const timeoutResult = outcome.value;
    assert.equal(timeoutResult.aborted, true);
    finish(kind === 'resolution' ? { content: 'Too late' } : new Error('Late failure'));
    await flush();
    assert.equal(outcome.value, timeoutResult);
    assert.equal(errors.length, 1);
    assert.equal(pipeline.stats.failures, 1);
    assert.equal(pipeline.stats.successes, 0);
  });
}

test('timeout patterns leave unrelated tools alone and match literal names exactly', async t => {
  const timers = controlTimers(t);
  const pipeline = new ToolPipeline();
  pipeline.addTimeout('Read.file', 25);
  const expected = { content: 'Other tool' };
  assert.equal((await pipeline.run({ toolName: 'ReadXfile' }, () => expected)).result, expected);
  assert.equal(timers.length, 0);
  const matching = observe(pipeline.run({ toolName: 'Read.file' }, () => expected));
  await flush();
  assert.equal(matching.status, 'fulfilled');
  assert.equal(matching.value.result, expected);
  assert.deepEqual(timers.map(timer => [timer.ms, timer.active]), [[25, false]]);
});

test('overlapping specific and catch-all deadlines both clear on success', async t => {
  const timers = controlTimers(t);
  const pipeline = new ToolPipeline();
  // These are the overlapping policies installed by QueryEngine for Bash.
  pipeline.addTimeout('Bash', 180_000, { priority: 5 });
  pipeline.addTimeout(/.*/, 300_000, { priority: 10 });
  const expected = { content: 'Command completed' };
  let calls = 0;
  const outcome = observe(pipeline.run({ toolName: 'Bash' }, () => { calls++; return expected; }));
  await flush();
  assert.equal(outcome.status, 'fulfilled');
  assert.equal(outcome.value.result, expected);
  assert.equal(calls, 1);
  assert.deepEqual(timers.map(timer => [timer.ms, timer.active]), [[180_000, false], [300_000, false]]);
});

test('real timeout timers do not keep a completed or failed tool process alive', () => {
  const moduleUrl = new URL('../dist/utils/toolPipeline.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { ToolPipeline } from ${JSON.stringify(moduleUrl)};
    const pipeline = new ToolPipeline();
    pipeline.addTimeout(/.*/, 300_000);
    assert.equal((await pipeline.run({ toolName: 'Read' }, () => ({ content: 'ok' }))).result.content, 'ok');
    const error = new Error('expected');
    await assert.rejects(pipeline.run({ toolName: 'Read' }, async () => { throw error; }), value => value === error);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('an approved real tool completes an offline model query without waiting for its deadline', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'guang-timeout-query-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.guang-code'));
  await writeFile(path.join(cwd, '.guang-code/config.json'), JSON.stringify({ memoryEnabled: false }));
  await writeFile(path.join(cwd, 'example.txt'), 'Offline fixture\n');
  const fixture = fileURLToPath(new URL('./helpers/tool-pipeline-query.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [fixture], {
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
