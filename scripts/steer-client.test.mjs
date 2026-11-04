import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile with the project's TypeScript version; no extra test runner required.
const source = await readFile(
  new URL('../lib/steer-client.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
});
const { steer } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const encoder = new TextEncoder();
const event = { sequence: 1, type: 'message', text: '你好，Steer' };
const frame = `event: relay.event\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const done = 'event: steer.done\r\ndata: {}\r\n\r\n';

function mockStream(t, chunks, { close = true } = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(
          typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
        );
      if (close) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(body),
  );
  t.after(() => {
    fetch.mock.restore();
    steer.setWorkspace('');
  });
  return { body, fetch, cancelled: () => cancelled };
}

test('decodes UTF-8 and CRLF frames split at every byte', async (t) => {
  const chunks = Array.from(encoder.encode(frame + done), (byte) =>
    Uint8Array.of(byte),
  );
  const { body } = mockStream(t, chunks);
  const events = [];
  await steer.streamRunEvents('run', 0, new AbortController().signal, (value) =>
    events.push(value),
  );
  assert.deepEqual(events, [event]);
  assert.equal(body.locked, false);
});

test(
  'finishes on steer.done even when the server keeps the stream open',
  { timeout: 1000 },
  async (t) => {
    const stream = mockStream(t, [frame + done + frame], { close: false });
    const events = [];
    await steer.streamTaskEvents(
      'task',
      0,
      new AbortController().signal,
      (value) => events.push(value),
    );
    assert.deepEqual(
      events,
      [event],
      'events after completion must not be delivered',
    );
    assert.equal(stream.cancelled(), true);
    assert.equal(stream.body.locked, false);
  },
);

test('handles heartbeat comments, multiline data and an EOF completion frame', async (t) => {
  mockStream(t, [
    ': heartbeat\n\nevent: relay.event\ndata: {"sequence": 2,\ndata: "text": "ok"}\n\nevent: steer.done',
  ]);
  const events = [];
  await steer.streamRunEvents('run', 0, new AbortController().signal, (value) =>
    events.push(value),
  );
  assert.deepEqual(events, [{ sequence: 2, text: 'ok' }]);
});

test('rejects premature EOF so callers can reconnect', async (t) => {
  const { body } = mockStream(t, [frame]);
  await assert.rejects(
    steer.streamRunEvents('run', 0, new AbortController().signal, () => {}),
    /ended unexpectedly/,
  );
  assert.equal(body.locked, false);
});

test('cancels and unlocks a stream on a server error', async (t) => {
  const stream = mockStream(
    t,
    ['event: steer.error\ndata: {"error":"runtime disconnected"}\n\n'],
    { close: false },
  );
  await assert.rejects(
    steer.streamRunEvents('run', 0, new AbortController().signal, () => {}),
    /runtime disconnected/,
  );
  assert.equal(stream.cancelled(), true);
  assert.equal(stream.body.locked, false);
});

test('cancels and unlocks a stream on malformed JSON', async (t) => {
  const stream = mockStream(t, ['event: relay.event\ndata: broken\n\n'], {
    close: false,
  });
  await assert.rejects(
    steer.streamRunEvents('run', 0, new AbortController().signal, () => {}),
    SyntaxError,
  );
  assert.equal(stream.cancelled(), true);
  assert.equal(stream.body.locked, false);
});

test('does not deliver queued events after cancellation', async (t) => {
  const stream = mockStream(t, [frame + done], { close: false });
  const controller = new AbortController();
  controller.abort();
  const events = [];
  await assert.rejects(
    steer.streamRunEvents('run', 0, controller.signal, (value) =>
      events.push(value),
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(events, []);
  assert.equal(stream.cancelled(), true);
  assert.equal(stream.body.locked, false);
});

test('preserves workspace, credentials and resume cursor for task streams', async (t) => {
  const { fetch } = mockStream(t, [done]);
  steer.setWorkspace('workspace-a');
  const signal = new AbortController().signal;
  await steer.streamTaskEvents('task/1', 42, signal, () => {});
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, '/api/v1/tasks/task%2F1/events?after=42');
  assert.equal(init.headers['X-Steer-Workspace'], 'workspace-a');
  assert.equal(init.credentials, 'include');
  assert.equal(init.signal, signal);
});

test('stops within a chunk when the consumer cancels', async (t) => {
  const stream = mockStream(t, [frame + frame + done], { close: false });
  const controller = new AbortController();
  const events = [];
  await assert.rejects(
    steer.streamRunEvents('run', 0, controller.signal, (value) => {
      events.push(value);
      controller.abort();
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(events, [event]);
  assert.equal(stream.cancelled(), true);
  assert.equal(stream.body.locked, false);
});

test('releases the connection when the consumer throws', async (t) => {
  const stream = mockStream(t, [frame], { close: false });
  const failure = new Error('render failed');
  await assert.rejects(
    steer.streamRunEvents('run', 0, new AbortController().signal, () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(stream.cancelled(), true);
  assert.equal(stream.body.locked, false);
});
