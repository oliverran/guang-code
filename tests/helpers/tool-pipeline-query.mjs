import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runQuery } from '../../dist/utils/QueryEngine.js';
import { OpenAIProvider } from '../../dist/providers/OpenAIProvider.js';

// Keep the real query engine, permission gate, Glob tool and timeout pipeline.
// Only the model stream is replaced, so no credentials or network are needed.
globalThis.fetch = () => { throw new Error('Network access is not allowed in this fixture'); };
let requests = 0;
OpenAIProvider.prototype.streamChat = async function* (options) {
  requests++;
  if (requests === 1) {
    yield { type: 'tool_call_start', id: 'offline-glob', name: 'Glob' };
    yield { type: 'tool_call_end', toolCall: {
      id: 'offline-glob', name: 'Glob', input: { pattern: '*.txt' },
    } };
  } else {
    assert.equal(requests, 2, 'The query should need one tool call and one final reply');
    const results = options.messages.flatMap(message =>
      Array.isArray(message.content) ? message.content : []
    ).filter(block => block.type === 'tool_result');
    assert.equal(results.length, 1);
    assert.equal(results[0].is_error, false);
    assert.equal(results[0].content, 'Found 1 file(s):\nexample.txt');
    yield { type: 'text_delta', text: 'Found the example file.' };
  }
  yield {
    type: 'done', inputTokens: 1, outputTokens: 1,
    stopReason: requests === 1 ? 'tool_calls' : 'end_turn',
  };
};
const chunks = [];
const result = await runQuery({
  model: 'gpt-offline-fixture', cwd: process.cwd(), sessionId: randomUUID(),
  permissionMode: 'default', providerConfig: { providers: {} },
  apiKeyOverride: 'offline-fixture-not-a-real-key',
  messages: [{ id: randomUUID(), role: 'user', content: 'Find the example file', timestamp: Date.now() }],
  onPermissionRequest: async toolName => {
    assert.equal(toolName, 'Glob');
    return 'allow_once';
  },
  onStreamChunk: chunk => chunks.push(chunk),
});
assert.equal(requests, 2);
assert.equal(result.messages.at(-1).content, 'Found the example file.');
assert.equal(chunks.filter(chunk => chunk.type === 'error').length, 0);
assert.deepEqual(chunks.filter(chunk => chunk.type === 'tool_done').map(chunk => chunk.toolResult), [
  'Found 1 file(s):\nexample.txt',
]);
