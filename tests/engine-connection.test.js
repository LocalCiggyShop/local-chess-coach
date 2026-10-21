import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineConnection } from '../src/engine-connection.js';

const disconnected = () => new Error('Could not establish connection. Receiving end does not exist.');
function harness({ exists = false, ready = false } = {}) {
  const state = { exists, ready, creates: 0, probes: 0, messages: [], pauses: 0 };
  const api = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      getContexts: async () => state.exists ? [{}] : [],
      sendMessage: async message => {
        if (message.type === 'ping') state.probes++;
        if (!state.ready) throw disconnected();
        if (message.type === 'ping') return { ready: true };
        state.messages.push(message); return { id: message.id, move: 'e2e4' };
      },
    },
    offscreen: { createDocument: async () => { state.creates++; state.exists = true; } },
  };
  const connection = new EngineConnection(api, { attempts: 3, pause: async () => {
    state.pauses++; state.ready = true;
  } });
  return { connection, api, state };
}
const request = id => ({ target: 'engine', type: 'analyze', tabId: 1, id });

test('an existing offscreen context waits for its module listener before sending analysis', async () => {
  const { connection, state } = harness({ exists: true });
  assert.equal((await connection.send(request('late-listener'))).move, 'e2e4');
  assert.equal(state.creates, 0);
  assert.equal(state.probes, 2);
  assert.equal(state.messages.length, 1);
});

test('concurrent requests share offscreen creation and readiness', async () => {
  const { connection, api, state } = harness();
  let finish;
  api.offscreen.createDocument = () => {
    state.creates++; state.exists = true;
    return new Promise(resolve => { finish = resolve; });
  };
  const first = connection.send(request('first'));
  await new Promise(resolve => setImmediate(resolve));
  // The context exists now, but createDocument is still loading its modules.
  const second = connection.send(request('second'));
  assert.equal(state.messages.length, 0);
  finish();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.id), ['first', 'second']);
  assert.equal(state.creates, 1);
  assert.equal(state.probes, 2);
});

test('analysis reconnects if the receiver disappears after the readiness probe', async () => {
  const { connection, api, state } = harness({ exists: true, ready: true });
  const send = api.runtime.sendMessage;
  let fail = true;
  api.runtime.sendMessage = async message => {
    if (message.type === 'analyze' && fail) {
      fail = false; state.exists = false; state.ready = false; throw disconnected();
    }
    return send(message);
  };
  assert.equal((await connection.send(request('reconnected'))).id, 'reconnected');
  assert.equal(state.creates, 1);
  assert.equal(state.messages.length, 1);
});

test('an unavailable listener has a bounded failure and can be retried later', async () => {
  const { connection, state } = harness({ exists: true });
  connection.pause = async () => {};
  await assert.rejects(connection.send(request('failed')), /local engine could not connect.*Refresh/);
  assert.equal(state.probes, 3);
  assert.equal(state.messages.length, 0);
  state.ready = true;
  assert.equal((await connection.send(request('retry'))).id, 'retry');
});

test('cancel without an engine succeeds without creating or waiting for one', async () => {
  const { connection, state } = harness();
  assert.deepEqual(await connection.send({ target: 'engine', type: 'cancel', tabId: 1 }), { ok: true });
  assert.equal(state.creates, 0);
  assert.equal(state.probes, 0);
});

test('unrelated messaging errors are preserved without retries', async () => {
  const { connection, api, state } = harness({ exists: true, ready: true });
  api.runtime.sendMessage = async () => { throw new Error('Unexpected engine failure.'); };
  await assert.rejects(connection.send(request('bad')), /Unexpected engine failure/);
  assert.equal(state.pauses, 0);
});
