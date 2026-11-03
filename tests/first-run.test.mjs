import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { glob } from '../scripts/glob-shim.mjs';
import { GlobTool } from '../dist/tools/GlobTool.js';
import { ingestPmFiles, loadPmContext } from '../dist/utils/pmContext.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'guang-first-run-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'src'));
  await mkdir(path.join(cwd, 'node_modules'));
  await writeFile(path.join(cwd, 'src', 'hello.js'), 'export const greeting = "hello";\n');
  await writeFile(path.join(cwd, 'node_modules', 'ignored.js'), 'hello\n');
  await writeFile(path.join(cwd, 'README.md'), '# Example\n');
  return cwd;
}

function isolatedNode(cwd, args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd,
    // No inherited API keys, global configuration, or project state.
    env: {
      HOME: cwd, USERPROFILE: cwd, PATH: '', NO_COLOR: '1',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    encoding: 'utf8', timeout: 15000, ...options,
  });
}

function assertSuccess(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('glob shim resolves matching paths and respects ignore options', async t => {
  const cwd = await fixture(t);
  const matches = await glob('**/*.js', { cwd, ignore: ['node_modules/**'], nodir: true });
  assert.deepEqual(matches, ['src/hello.js']);
  assert.deepEqual(await glob('missing-*', { cwd }), []);
});

test('Glob tool returns files and handles an empty result', async t => {
  const cwd = await fixture(t);
  const found = await GlobTool.execute({ pattern: '**/*.js' }, { cwd });
  assert.equal(found.isError, undefined, found.content);
  assert.equal(found.content, 'Found 1 file(s):\nsrc/hello.js');
  const empty = await GlobTool.execute({ pattern: 'missing-*' }, { cwd });
  assert.equal(empty.content, 'No files matched pattern: missing-*');
});

test('Grep works without an installed ripgrep executable', async t => {
  const cwd = await fixture(t);
  const moduleUrl = pathToFileURL(path.join(root, 'dist/tools/GrepTool.js')).href;
  const result = isolatedNode(cwd, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { GrepTool } from ${JSON.stringify(moduleUrl)};
    const result = await GrepTool.execute({ pattern: 'greeting', include: '**/*.js' }, { cwd: process.cwd() });
    assert.equal(result.isError, undefined, result.content);
    assert.match(result.content, /hello\\.js:1:>export const greeting/);
    assert.doesNotMatch(result.content, /node_modules/);
  `]);
  assertSuccess(result);
});

test('PM context accepts wildcard file paths', async t => {
  const cwd = await fixture(t);
  const result = await ingestPmFiles({ cwd, patternsOrPaths: ['src/*.js'] });
  assert.deepEqual(result, { added: 1, skipped: 0, total: 1 });
  assert.equal((await loadPmContext(cwd)).files[0].path, 'src/hello.js');
});

test('terminal --help boots from a clean home without credentials', async t => {
  const cwd = await fixture(t);
  const result = isolatedNode(cwd, [path.join(root, 'dist/main.js'), '--help']);
  assertSuccess(result);
  assert.match(result.stdout, /Usage: guang/);
  assert.match(result.stdout, /--plan/);
});

test('Markdown renderer and custom command frontmatter load', async () => {
  const { renderMarkdown } = await import('../dist/utils/markdown/index.js');
  const { parseFrontmatter } = await import('../dist/utils/customCommands.js');
  const rendered = renderMarkdown('# Hello\n\n```js\nconst answer = 42;\n```');
  assert.match(rendered, /Hello/);
  assert.match(rendered, /const answer = 42/);
  assert.doesNotMatch(rendered, /undefined|```/);
  assert.deepEqual(parseFrontmatter('---\ndescription: Example\n---\nBody'), {
    frontmatter: { description: 'Example' }, content: 'Body',
  });
});

test('Web server boots and serves local pages without credentials', async t => {
  const cwd = await fixture(t);
  const moduleUrl = pathToFileURL(path.join(root, 'dist/utils/webServer.js')).href;
  const result = isolatedNode(cwd, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { GuangWebServer } from ${JSON.stringify(moduleUrl)};
    const server = new GuangWebServer({ cwd: process.cwd(), host: '127.0.0.1', port: 0 });
    await server.start();
    try {
      const base = 'http://127.0.0.1:' + server.server.address().port;
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<title>guang-code/);
      for (const resource of ['sessions', 'skills', 'plugins']) {
        const response = await fetch(base + '/api/ui/' + resource);
        assert.equal(response.status, 200, resource);
        assert.ok(Array.isArray((await response.json())[resource]), resource);
      }
    } finally {
      await server.stop();
    }
  `]);
  assertSuccess(result);
});
