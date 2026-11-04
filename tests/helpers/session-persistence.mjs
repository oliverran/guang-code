import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runQuery } from '../../dist/utils/QueryEngine.js';
import { OpenAIProvider } from '../../dist/providers/OpenAIProvider.js';
import { sessionStore, SessionEventStore } from '../../dist/utils/sessionES.js';
import { GuangWebServer } from '../../dist/utils/webServer.js';

// Each scenario runs in a separate process with an empty home and no credentials.
// Replace the provider stream, not the query engine or persistence implementation.
const requests = [];
OpenAIProvider.prototype.streamChat = async function* (options) {
  requests.push(structuredClone(options.messages));
  yield { type: 'text_delta', text: 'Offline reply ' + requests.length };
  yield { type: 'done', inputTokens: 1, outputTokens: 2, stopReason: 'end_turn' };
};
const localFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  assert.equal(new URL(url).hostname, '127.0.0.1', 'Only local Web test requests are allowed');
  return localFetch(url, options);
};

const sessionId = 'fixture-' + randomUUID();
const cwd = process.cwd();
const user = content => ({ id: randomUUID(), role: 'user', content, timestamp: Date.now() });
const common = {
  model: 'gpt-offline-fixture', cwd, sessionId, permissionMode: 'default',
  apiKeyOverride: 'offline-fixture-not-a-real-key', providerConfig: { providers: {} },
  onPermissionRequest: async () => 'deny', onStreamChunk: () => {},
};
const freshProjection = () => new SessionEventStore().getProjection(sessionId);
const assertMessages = async expected => {
  assert.deepEqual((await freshProjection()).messages, expected);
  const events = (await sessionStore.readEvents(sessionId)).filter(e => e.type === 'MessageAdded');
  assert.deepEqual(events.map(e => e.payload.message), expected);
};

switch (process.argv[2]) {
  case 'plain': {
    const first = user('Hello');
    const result = await runQuery({ ...common, messages: [first] });
    assert.equal(result.messages[0].content, 'Offline reply 1');
    await assertMessages([first, ...result.messages]);
    break;
  }
  case 'rounds': {
    const first = user('Repeat this');
    const one = await runQuery({ ...common, messages: [first] });
    // Same text with a different ID is a real new turn, not a duplicate.
    const second = user('Repeat this');
    const history = [first, ...one.messages, second];
    const two = await runQuery({ ...common, messages: history });
    await assertMessages([...history, ...two.messages]);
    assert.deepEqual(requests[1].map(m => m.content), history.map(m => m.content));
    break;
  }
  case 'tools': {
    let round = 0;
    OpenAIProvider.prototype.streamChat = async function* () {
      round++;
      yield { type: 'text_delta', text: round < 3 ? 'Looking ' + round : 'Final answer' };
      if (round < 3) {
        const id = 'read-only-' + round;
        yield { type: 'tool_call_start', id, name: 'Glob' };
        yield { type: 'tool_call_end', toolCall: { id, name: 'Glob', input: { pattern: '*.txt' } } };
      }
      yield { type: 'done', inputTokens: 1, outputTokens: 2, stopReason: round < 3 ? 'tool_calls' : 'end_turn' };
    };
    const first = user('Find the example');
    const result = await runQuery({ ...common, messages: [first] });
    assert.equal(round, 3);
    assert.equal(result.messages.at(-1).content, 'Final answer');
    assert.equal(result.messages.filter(m => m.content.startsWith('[Tool Result:')).length, 2);
    assert.ok(result.messages.filter(m => m.content.startsWith('[Tool Result:')).every(m => m.content.includes('Permission denied')));
    await assertMessages([first, ...result.messages]);
    break;
  }
  case 'legacy': {
    await sessionStore.newSession(cwd, { id: sessionId });
    const history = [
      { role: 'user', content: 'Repeat this', createdAt: 1000 },
      { role: 'assistant', content: 'Old reply', createdAt: 1001 },
    ];
    for (const message of history) await sessionStore.appendEvent(sessionId, {
      type: 'MessageAdded', payload: { message }, id: randomUUID(), ts: Date.now(),
    });
    const next = user('Repeat this');
    const result = await runQuery({ ...common, messages: [...history, next] });
    await assertMessages([...history, next, ...result.messages]);
    break;
  }
  case 'web': {
    const server = new GuangWebServer({ cwd, host: '127.0.0.1', port: 0 });
    await server.start();
    const send = async (message, extra = {}) => {
      const response = await fetch(server.getUrl() + '/api/ui/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, model: common.model, apiKey: common.apiKeyOverride, ...extra }),
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.doesNotMatch(text, /event: error/);
      assert.match(text, /event: final/);
    };
    const reload = async () => {
      const response = await fetch(server.getUrl() + '/api/ui/sessions/' + sessionId);
      assert.equal(response.status, 200);
      return (await response.json()).projection.messages;
    };
    try {
      await send('First question');
      const first = await reload();
      assert.deepEqual(first.map(m => m.content), ['First question', 'Offline reply 1']);
      assert.ok(first.every(m => typeof m.id === 'string' && m.id));
      // Older browser clients send a display-only history including the new prompt.
      // Persisted history must remain canonical, including tool messages and IDs.
      await send('Second question', { messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'Offline reply 1' },
        { role: 'user', content: 'Second question' },
      ] });
      const second = await reload();
      assert.deepEqual(second.map(m => m.content), ['First question', 'Offline reply 1', 'Second question', 'Offline reply 2']);
      assert.equal(new Set(second.map(m => m.id)).size, 4);
      assert.deepEqual(requests[1].map(m => m.content), ['First question', 'Offline reply 1', 'Second question']);
      sessionStore.unload(sessionId);
      await send('Third question');
      assert.deepEqual((await reload()).map(m => m.content), [...second.map(m => m.content), 'Third question', 'Offline reply 3']);
    } finally {
      await server.stop();
    }
    break;
  }
  case 'restart': {
    await sessionStore.newSession(cwd, { id: sessionId });
    const first = user('Before restart');
    await sessionStore.appendEvent(sessionId, { type: 'MessageAdded', payload: { message: first }, id: randomUUID(), ts: Date.now() });
    // Verify both snapshot-backed and event-only reopens.
    for (const snapshot of [false, true]) {
      if (snapshot) await sessionStore.writeSnapshot(sessionId, await sessionStore.getProjection(sessionId));
      const reopened = new SessionEventStore();
      const before = await reopened.getProjection(sessionId);
      await reopened.appendEvent(sessionId, { type: 'SessionMetadataChanged', payload: { title: 'Reopened' }, id: randomUUID(), ts: Date.now() });
      const after = await freshProjection();
      assert.equal(after.lastEventSeq, before.lastEventSeq + 1);
      assert.deepEqual(after.messages, [first]);
      const last = (await reopened.readEvents(sessionId)).at(-1);
      assert.equal(last.prevHash, before.lastEventHash);
    }
    break;
  }
  case 'concurrent': {
    await sessionStore.newSession(cwd, { id: sessionId });
    sessionStore.unload(sessionId);
    const messages = Array.from({ length: 5 }, (_, i) => user('Concurrent ' + i));
    await Promise.all(messages.map(message => sessionStore.appendEvent(sessionId, {
      type: 'MessageAdded', payload: { message }, id: randomUUID(), ts: Date.now(),
    })));
    const events = await sessionStore.readEvents(sessionId);
    assert.deepEqual(events.map(e => e.seq), [1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < events.length; i++) assert.equal(events[i].prevHash, events[i - 1]._hash);
    await assertMessages(messages);
    break;
  }
  case 'failed-append': {
    await sessionStore.newSession(cwd, { id: sessionId });
    const rejected = sessionStore.appendEvent(sessionId, Object.freeze({ type: 'SessionMetadataChanged' }));
    const message = user('After failure');
    const accepted = sessionStore.appendEvent(sessionId, {
      type: 'MessageAdded', payload: { message }, id: randomUUID(), ts: Date.now(),
    });
    await assert.rejects(rejected, TypeError);
    await accepted;
    await assertMessages([message]);
    assert.equal((await freshProjection()).lastEventSeq, 2);
    break;
  }
  case 'snapshot': {
    await sessionStore.newSession(cwd, { id: sessionId });
    for (let i = 0; i < 104; i++) await sessionStore.appendEvent(sessionId, {
      type: 'SessionMetadataChanged', payload: { title: 'Title ' + i }, id: randomUUID(), ts: Date.now(),
    });
    const snapshot = JSON.parse(await readFile(path.join(sessionStore.baseDir, sessionId, 'projection.json'), 'utf8'));
    assert.equal(snapshot.lastEventSeq, 100);
    assert.equal((await freshProjection()).lastEventSeq, 105);
    sessionStore.unload(sessionId);
    const message = user('After snapshot');
    await sessionStore.appendEvent(sessionId, {
      type: 'MessageAdded', payload: { message }, id: randomUUID(), ts: Date.now(),
    });
    const projection = await freshProjection();
    assert.equal(projection.lastEventSeq, 106);
    assert.equal(projection.title, 'Title 103');
    await assertMessages([message]);
    break;
  }
  default: throw new Error('Unknown persistence scenario');
}
