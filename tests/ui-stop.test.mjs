import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseStopArgs, parseWindowsListeners } from '../scripts/stop-ui.mjs';

test('stop helper accepts explicit port forms and defaults', () => {
  assert.deepEqual(parseStopArgs([]), { port: 5173, help: false });
  for (const args of [['--port=8080'], ['--port', '8080']]) assert.equal(parseStopArgs(args).port, 8080);
  assert.equal(parseStopArgs(['-h']).help, true);
});

test('invalid arguments fail instead of silently targeting the default port', () => {
  for (const args of [['--prot=8080'], ['8080'], ['--port'], ['--port=0'], ['--port=65536'], ['--port=-1'], ['--port=1.5'], ['--port=1e3'], ['--port=8080;echo']]) {
    assert.throws(() => parseStopArgs(args), args.join(' '));
  }
});

test('Windows listener selection matches exact local port, state and numeric PID', () => {
  const netstat = `
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       42
  TCP    [::]:5173              [::]:0                 LISTENING       42
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       43
  TCP    0.0.0.0:15173          0.0.0.0:0              LISTENING       99
  TCP    0.0.0.0:51730          0.0.0.0:0              LISTENING       98
  TCP    127.0.0.1:6000         127.0.0.1:5173         ESTABLISHED     97
  TCP    127.0.0.1:5173         127.0.0.1:6000         TIME_WAIT       0
  UDP    0.0.0.0:5173           *:*                    LISTENING       96
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       invalid
  truncated
`;
  assert.deepEqual(parseWindowsListeners(netstat, 5173), ['42', '43']);
  assert.deepEqual(parseWindowsListeners(netstat, 15173), ['99']);
  assert.deepEqual(parseWindowsListeners('', 5173), []);
});

test('help and malformed CLI options never attempt process discovery or termination', () => {
  const script = fileURLToPath(new URL('../scripts/stop-ui.mjs', import.meta.url));
  for (const [args, code, message] of [
    [['--help'], 0, /does not verify/],
    [['--port=0'], 1, /between 1 and 65535/],
    [['--prot=8080'], 1, /Unknown option/],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { PATH: '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr);
    assert.match(result.stdout + result.stderr, message);
    assert.doesNotMatch(result.stdout, /Stopping listeners/);
  }
});
