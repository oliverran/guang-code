import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runQuery } from '../../dist/utils/QueryEngine.js';
import { OpenAIProvider } from '../../dist/providers/OpenAIProvider.js';
import { sessionStore, SessionEventStore } from '../../dist/utils/sessionES.js';
import { GuangWebServer } from '../../dist/utils/webServer.js';

// Keep real tool execution, permission checks and persistence; replace only the
// model stream. Every scenario has an empty home and can only fetch its local UI.
const localFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  assert.equal(new URL(url).hostname, '127.0.0.1', 'Only local Web test requests are allowed');
  return localFetch(url, options);
};
const scenario = process.argv[2];
const sessionId = 'history-' + randomUUID();
const cwd = process.cwd();
const user = content => ({ id: randomUUID(), role: 'user', content, timestamp: Date.now() });
const requests = [];
const offeredTools = [];
const chunks = [];
let permissions = 0;
const file = scenario === 'redacted' ? 'redacted.txt' : scenario === 'failed' ? 'missing.txt' : 'example.txt';
const originalBody = 'A body that should be omitted from stored input.';
const replacementBody = 'The replacement body should also stay omitted.';
const toolCalls = scenario === 'omitted-input' ? [
  { id: 'write-fixture', name: 'Write', input: { file_path: 'written.txt', content: originalBody } },
  { id: 'edit-fixture', name: 'Edit', input: { file_path: 'written.txt', old_string: originalBody, new_string: replacementBody } },
] : [{ id: 'read-fixture', name: 'Read', input: { file_path: file } }];
if (scenario === 'multiple') toolCalls.push({ id: 'glob-fixture', name: 'Glob', input: { pattern: '*.txt' } });
OpenAIProvider.prototype.streamChat = async function* (options) {
  requests.push(structuredClone(options.messages));
  offeredTools.push(options.tools.map(tool => tool.name));
  if (requests.length === 1) {
    yield { type: 'text_delta', text: 'Inspecting the project.' };
    for (const toolCall of toolCalls) {
      yield { type: 'tool_call_start', id: toolCall.id, name: toolCall.name };
      yield { type: 'tool_call_end', toolCall };
    }
  } else if (requests.length === 2 && scenario === 'interrupted') {
    yield { type: 'error', message: 'Offline simulated model interruption after tool execution' };
    return;
  } else {
    // Deliberately omit the tool output from the answer: the next query must
    // retain the actual evidence, not depend on the model restating it.
    yield { type: 'text_delta', text: requests.length === 2 ? 'Inspection complete.' : 'Follow-up complete.' };
  }
  yield { type: 'done', inputTokens: 1, outputTokens: 1, stopReason: requests.length === 1 ? 'tool_calls' : 'end_turn' };
};
const common = {
  model: 'gpt-offline-fixture', cwd, sessionId, permissionMode: 'default',
  apiKeyOverride: 'offline-fixture-not-a-real-key', providerConfig: { providers: {} },
  onPermissionRequest: async () => { permissions++; return scenario === 'denied' ? 'deny' : 'allow_once'; },
  onStreamChunk: chunk => chunks.push(chunk),
};
const first = user(scenario === 'interrupted' ? 'Allowed tools: Read\nInspect the project file.' : 'Inspect the project file.');
const result = await runQuery({ ...common, messages: [first] });
assert.equal(requests.length, 2);
const expectedErrors = scenario === 'interrupted' ? 1 : 0;
assert.equal(chunks.filter(chunk => chunk.type === 'error').length, expectedErrors);
assert.equal(permissions, toolCalls.length);
const savedTools = result.messages.filter(message => message.toolUseId);
assert.equal(savedTools.length, toolCalls.length * 2);
const nativeResults = requests[1].flatMap(message => Array.isArray(message.content) ? message.content : [])
  .filter(block => block.type === 'tool_result');
assert.equal(nativeResults.length, toolCalls.length, 'The current tool loop still uses native result blocks');
if (scenario === 'denied') assert.match(nativeResults[0].content, /Permission denied/);
else if (scenario === 'failed') assert.match(nativeResults[0].content, /File not found/);
else if (scenario === 'redacted') {
  assert.match(nativeResults[0].content, /\*\*\*secret:sk-0\*\*\*/);
  assert.doesNotMatch(nativeResults[0].content, new RegExp('sk-' + 'z'.repeat(28)));
}
else if (scenario === 'omitted-input') {
  assert.match(nativeResults[0].content, /File written successfully/);
  assert.match(nativeResults[1].content, /File edited successfully/);
  assert.equal(nativeResults[1].is_error, false);
} else assert.match(nativeResults[0].content, /The project uses the violet adapter/);
assert.equal(nativeResults[0].is_error, ['denied', 'failed'].includes(scenario));

let history = [first, ...result.messages];
let resumeSessionId = sessionId;
if (scenario === 'reopened' || scenario === 'web') {
  sessionStore.unload(sessionId);
  history = (await new SessionEventStore().getProjection(sessionId)).messages;
  assert.deepEqual(history, [first, ...result.messages]);
} else if (scenario === 'legacy') {
  history = history.map(({ id, ...message }) => message);
  resumeSessionId += '-legacy';
  await sessionStore.newSession(cwd, { id: resumeSessionId });
  for (const message of history) await sessionStore.appendEvent(resumeSessionId, {
    type: 'MessageAdded', payload: { message }, id: randomUUID(), ts: Date.now(),
  });
}
const followup = user((scenario === 'interrupted' ? 'Allowed tools: Glob\n' : '') +
  'Use the previous tool evidence to explain the project. Do not run tools again.');
if (scenario === 'web') {
  const server = new GuangWebServer({ cwd, host: '127.0.0.1', port: 0 });
  await server.start();
  try {
    const reloaded = await fetch(server.getUrl() + '/api/ui/sessions/' + sessionId);
    assert.equal(reloaded.status, 200);
    assert.deepEqual((await reloaded.json()).projection.messages, history);
    const response = await fetch(server.getUrl() + '/api/ui/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // A stale display history must not replace the saved tool messages.
      body: JSON.stringify({ message: followup.content, sessionId, model: common.model,
        apiKey: common.apiKeyOverride, messages: [{ role: 'user', content: 'Stale display history' }] }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /event: error/);
    assert.match(text, /event: final/);
  } finally {
    await server.stop();
  }
} else {
  await runQuery({ ...common, sessionId: resumeSessionId, messages: [...history, followup] });
}
assert.equal(requests.length, 3);
assert.equal(permissions, toolCalls.length, 'Restoring history must not execute tools again');
assert.equal(chunks.filter(chunk => chunk.type === 'error').length, expectedErrors);
if (scenario === 'interrupted') assert.deepEqual(offeredTools[2], ['Glob'], 'The new user instruction governs tool selection');
const restored = requests[2];
assert.ok(restored.every(message => typeof message.content === 'string'),
  'Saved transcripts are context text, not fabricated native tool calls');
const text = restored.map(message => message.content).join('\n');
let lastPosition = -1;
for (const message of savedTools) {
  assert.equal(text.split(message.content).length - 1, 1, 'Each saved tool transcript must appear once');
  const position = text.indexOf(message.content);
  assert.ok(position > lastPosition, 'Tool transcripts must stay in execution order');
  lastPosition = position;
}
assert.equal(restored.at(-1).content, followup.content);
assert.ok(lastPosition < text.indexOf(followup.content));
assert.doesNotMatch(text, /Stale display history/);
assert.doesNotMatch(text, new RegExp('sk-' + 'z'.repeat(28)));
if (scenario === 'omitted-input') {
  assert.ok(!text.includes(originalBody));
  assert.ok(!text.includes(replacementBody));
  assert.equal(text.split('[omitted:').length - 1, 3);
  assert.equal(await readFile('written.txt', 'utf8'), replacementBody);
}
const projection = await new SessionEventStore().getProjection(resumeSessionId);
assert.equal(projection.messages.filter(message => message.toolUseId).length, savedTools.length);
