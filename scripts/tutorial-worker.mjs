// Internal worker. Run scripts/tutorial.mjs, which creates and cleans the fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { GlobTool } from '../dist/tools/GlobTool.js';
import { GrepTool } from '../dist/tools/GrepTool.js';
import { FileReadTool } from '../dist/tools/FileReadTool.js';
import { FileEditTool } from '../dist/tools/FileEditTool.js';
import { ToolPipeline } from '../dist/utils/toolPipeline.js';

const auto = process.argv.includes('--auto');
const cwd = process.cwd();
assert.equal(process.env.GUANG_TUTORIAL_WORKSPACE, cwd, 'Use npm run tutorial, not the internal worker.');
const original = await readFile('cart.js', 'utf8');
// Prevent accidental direct invocation in an unrelated working directory.
assert.equal(JSON.parse(await readFile('package.json', 'utf8')).name, 'guang-code-cart-practice');
assert.match(original, /Practice fixture: one intentional bug/);
const rl = auto ? null : createInterface({ input: process.stdin, output: process.stdout });
class Quit extends Error {}
const inputClosed = new AbortController();
rl?.once('close', () => inputClosed.abort());
async function ask(question, scripted = '') {
  if (auto) { console.log(`${question}${scripted} [scripted answer]`); return scripted; }
  let answer;
  try { answer = (await rl.question(question, { signal: inputClosed.signal })).trim().toLowerCase(); }
  catch (error) { if (error.code === 'ERR_USE_AFTER_CLOSE' || error.name === 'AbortError') throw new Quit(); throw error; }
  if (answer === 'q') throw new Quit();
  return answer;
}
async function next(title) {
  console.log(`\n${title}`);
  await ask('Press Enter to continue, or q to quit: ');
}
function show(result) {
  console.log(result.content.replaceAll(cwd, '<practice>'));
}
async function tool(tool, input, context = {}) {
  const result = await tool.execute(input, { cwd, ...context });
  show(result);
  assert.ok(!result.isError, result.content);
  return result;
}
function testCart(expectedStatus) {
  // A fixed Node invocation, not BashTool or a user-supplied command.
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'cart.test.js'], {
    cwd, env: process.env, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(run.error);
  console.log((run.stdout + run.stderr).replaceAll(cwd, '<practice>').trim());
  assert.equal(run.status, expectedStatus, 'The sample did not produce the expected test result.');
  return run.stdout;
}
const edit = {
  file_path: 'cart.js',
  old_string: 'sum + item.priceCents, 0',
  new_string: 'sum + item.priceCents * item.quantity, 0',
};

try {
  console.log(`\nGuang Code | offline tool lab\n
固定脚本 / scripted orchestration. No AI model is connected.
真实执行 / real operations: Glob, Grep, Read, Edit, ToolPipeline, Node tests.
Only a disposable copy of the bundled cart example is used.
No API keys, network requests, real project data, or provider claims.
Mode: ${auto ? 'AUTO: even final approval is a scripted answer' : 'INTERACTIVE: you control the final edit'}
`);
  await next('1 / 5 · Explore the project / 阅读样例');
  await tool(GlobTool, { pattern: '*.js' });
  await tool(GrepTool, { pattern: 'totalCents', include: '*.js', context_lines: 0 });
  await tool(FileReadTool, { file_path: 'cart.js' });
  await tool(FileReadTool, { file_path: 'cart.test.js' });

  await next('2 / 5 · Reproduce the bug / 先看红测试');
  const before = testCart(1);
  assert.match(before, /# pass 2\b/);
  assert.match(before, /# fail 2\b/);
  const guess = await ask('What is ignored? [1] price [2] quantity (Enter reveals): ', '2');
  console.log(guess === '2' ? 'Correct: quantity is ignored.' : 'The missing factor is quantity.');
  console.log('1250 × 2 + 350 × 3 should be 3550 cents; the current code returns 1600.');

  await next('3 / 5 · Plan before changing / 验证 Plan 模式');
  console.log('Proposed patch (fixed by the tutorial, not a model):');
  console.log(`- ${edit.old_string}\n+ ${edit.new_string}`);
  const planned = await FileEditTool.execute(edit, { cwd, permissionMode: 'plan', planApproved: false });
  show(planned);
  assert.equal(planned.isError, true);
  assert.match(planned.content, /Plan mode active/);
  assert.equal(await readFile('cart.js', 'utf8'), original);
  console.log('Verified: Plan mode left the file unchanged.');

  await next('4 / 5 · Inspect permission decisions / 拒绝与批准');
  const pipeline = new ToolPipeline();
  pipeline.addPermissionGate();
  let editsExecuted = 0;
  async function throughGate(allowed) {
    return pipeline.run({ toolName: 'Edit', input: edit, cwd, context: {
      onPermissionRequest: async () => allowed,
    } }, async () => {
      editsExecuted++;
      return FileEditTool.execute(edit, { cwd, permissionMode: 'default' });
    });
  }
  console.log('First, the tutorial supplies a deliberate denial to the real permission gate.');
  const denied = await throughGate(false);
  show(denied.result);
  assert.equal(denied.result.denied, true);
  assert.equal(editsExecuted, 0);
  assert.equal(await readFile('cart.js', 'utf8'), original);
  console.log('Verified: denied requests never reached Edit; the file is unchanged.');
  console.log('Next request: Edit cart.js in this temporary copy, using exactly the patch above.');
  const approved = await ask('Apply this patch? Type y to approve; Enter/n to decline: ', 'y');
  if (approved !== 'y') {
    assert.equal(await readFile('cart.js', 'utf8'), original);
    console.log('Declined. No edit was performed. Re-run the tutorial whenever you like.');
  } else {
    const applied = await throughGate(true);
    show(applied.result);
    assert.ok(!applied.result.isError, applied.result.content);
    assert.equal(editsExecuted, 1);
    assert.equal(await readFile('cart.js', 'utf8'), original.replace(edit.old_string, edit.new_string));
    await next('5 / 5 · Verify the change / 再看绿测试');
    const after = testCart(0);
    assert.match(after, /# pass 4\b/);
    assert.match(after, /# fail 0\b/);
    console.log('\nPASS: red tests → Plan blocked → permission denied → approved Edit → 4 green tests.');
    console.log('Next: docs/tutorial.md explains how to try the same fixture with a real model.');
  }
} catch (error) {
  if (error instanceof Quit) console.log('\nStopped by you. The temporary exercise will be removed.');
  else { console.error(`Exercise failed: ${error.message}`); process.exitCode = 1; }
} finally { rl?.close(); }
