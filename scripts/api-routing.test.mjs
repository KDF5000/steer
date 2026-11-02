import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const code = ts.transpileModule(
  await readFile(new URL('../lib/api-routing.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { createAPIRouter, readStreamChunk } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const primary = 'https://direct.api.example.test/api/v1';
const fallback = 'https://api.example.test/api/v1';
const healthy = () => Response.json({ service: 'steer', status: 'ok' });
const config = {
  primary,
  fallback,
  preferenceDelay: 10,
  probeTimeout: 40,
  headerTimeout: 40,
};

test('a silent broken SSE connection times out so it can reconnect on the other route', async () => {
  const reader = new ReadableStream({ start() {} }).getReader();
  await assert.rejects(readStreamChunk(reader, 5), /heartbeat timed out/);
  await reader.cancel();
  reader.releaseLock();
});

test('startup measures both routes and selects the first healthy one', async () => {
  const calls = [];
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      calls.push(url);
      return url.endsWith('/health') ? healthy() : Response.json({ ok: true });
    },
  });
  await router.fetch('/workspaces');
  assert.deepEqual(calls, [
    `${primary}/health`,
    `${fallback}/health`,
    `${primary}/workspaces`,
  ]);
});

test('a faster tunnel can win even when IPv6 direct access is available', async () => {
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url === `${primary}/health`)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (url === `${fallback}/health`)
        await new Promise((resolve) => setTimeout(resolve, 1));
      return url.endsWith('/health')
        ? healthy()
        : Response.json({ route: url.startsWith(fallback) ? 'tunnel' : 'direct' });
    },
  });
  assert.deepEqual(await (await router.fetch('/workspaces')).json(), {
    route: 'tunnel',
  });
  assert.equal(router.baseURL, fallback);
});

test('a blackholed IPv6 connection does not block IPv4 users', async () => {
  let cancelled = false;
  const router = createAPIRouter({
    ...config,
    fetch: async (url, init) => {
      if (url === `${primary}/health`)
        return new Promise((_, reject) => {
          init.signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(init.signal.reason);
            },
            { once: true },
          );
        });
      return url.endsWith('/health')
        ? healthy()
        : Response.json({ route: 'tunnel' });
    },
  });
  assert.deepEqual(await (await router.fetch('/workspaces')).json(), {
    route: 'tunnel',
  });
  assert.equal(router.baseURL, fallback);
  // The direct probe continues in the background so the router can distinguish
  // a merely slower route from an unavailable one without delaying the request.
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(cancelled, true);
});

test('concurrent startup requests share one route selection', async () => {
  let probes = 0;
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url.endsWith('/health')) {
        probes++;
        await new Promise((r) => setTimeout(r, 2));
        return healthy();
      }
      return new Response('ok');
    },
  });
  await Promise.all([
    router.fetch('/a'),
    router.fetch('/b'),
    router.fetch('/c'),
  ]);
  assert.equal(probes, 2);
});

test('an HTTP 200 from an unrelated service is not a healthy API', async () => {
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url === `${primary}/health`) return Response.json({ status: 'ok' });
      return url.endsWith('/health') ? healthy() : new Response('ok');
    },
  });
  await router.fetch('/a');
  assert.equal(router.baseURL, fallback);
});

test('both unavailable endpoints report failure instead of selecting a bad route', async () => {
  const router = createAPIRouter({
    ...config,
    fetch: async () => {
      throw new TypeError('offline');
    },
  });
  await assert.rejects(router.fetch('/a'), /Neither Steer/);
});

test('reads retry once after a network failure, preserving credentials and cursor', async () => {
  const requests = [];
  const router = createAPIRouter({
    ...config,
    fetch: async (url, init) => {
      if (url.endsWith('/health')) return healthy();
      requests.push([url, init]);
      if (url.startsWith(primary)) throw new TypeError('network changed');
      return new Response('ok');
    },
  });
  await router.fetch('/tasks/t/events?after=42', {
    credentials: 'include',
    headers: { 'X-Steer-Workspace': 'w' },
  });
  assert.deepEqual(
    requests.map(([url]) => url),
    [
      `${primary}/tasks/t/events?after=42`,
      `${fallback}/tasks/t/events?after=42`,
    ],
  );
  assert.equal(requests[1][1].credentials, 'include');
  assert.equal(requests[1][1].headers['X-Steer-Workspace'], 'w');
  assert.equal(router.baseURL, primary);
});

test('a transient direct failure does not change the preferred route', async () => {
  let directRequests = 0;
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url.endsWith('/health')) return healthy();
      if (url.startsWith(primary) && directRequests++ === 0)
        throw new TypeError('brief network jitter');
      return Response.json({ route: url.startsWith(primary) ? 'direct' : 'tunnel' });
    },
  });
  assert.deepEqual(await (await router.fetch('/a')).json(), { route: 'tunnel' });
  assert.equal(router.baseURL, primary);
  assert.deepEqual(await (await router.fetch('/b')).json(), { route: 'direct' });
  assert.equal(router.baseURL, primary);
});

test('repeated direct failures move subsequent traffic to a healthy tunnel', async () => {
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url.endsWith('/health')) return healthy();
      if (url.startsWith(primary)) throw new TypeError('direct route is down');
      return new Response('ok');
    },
  });
  await router.fetch('/a');
  assert.equal(router.baseURL, primary);
  await router.fetch('/b');
  assert.equal(router.baseURL, fallback);
});

test('a fallback failure never sends traffic back to an unproven direct route', async () => {
  const calls = [];
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      calls.push(url);
      if (url === `${primary}/health`) throw new TypeError('no IPv6');
      if (url === `${fallback}/health`) return healthy();
      if (url.startsWith(fallback)) throw new TypeError('slow tunnel failed');
      throw new Error('direct request must not be retried');
    },
  });
  await assert.rejects(router.fetch('/sessions/shared'), /slow tunnel failed/);
  assert.equal(router.baseURL, fallback);
  assert.deepEqual(calls, [
    `${primary}/health`,
    `${fallback}/health`,
    `${fallback}/sessions/shared`,
    `${primary}/health`,
  ]);
});

test('writes without an idempotency key are never replayed', async () => {
  let writes = 0;
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url.endsWith('/health')) return healthy();
      writes++;
      throw new TypeError('response lost after commit');
    },
  });
  await assert.rejects(
    router.fetch('/projects', { method: 'POST', body: '{}' }),
  );
  assert.equal(writes, 1);
  // A single ambiguous write failure is not enough evidence to move all
  // subsequent traffic to another path.
  assert.equal(router.baseURL, primary);
});

test('task submissions reuse the same idempotency key and multipart body on failover', async () => {
  const requests = [];
  const body = new FormData();
  body.set('prompt', 'one task');
  const router = createAPIRouter({
    ...config,
    fetch: async (url, init) => {
      if (url.endsWith('/health')) return healthy();
      requests.push(init);
      return new Response('', { status: url.startsWith(primary) ? 502 : 202 });
    },
  });
  const response = await router.fetch('/tasks', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': 'same-task' },
  });
  assert.equal(response.status, 202);
  assert.equal(requests.length, 2);
  for (const init of requests) {
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'same-task');
    assert.equal(init.body, body);
  }
});

test('user cancellation never retries the operation or changes the route', async () => {
  const controller = new AbortController();
  let requests = 0;
  const router = createAPIRouter({
    ...config,
    fetch: async (url) => {
      if (url.endsWith('/health')) return healthy();
      requests++;
      controller.abort();
      throw controller.signal.reason;
    },
  });
  await assert.rejects(router.fetch('/a', { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(requests, 1);
  assert.equal(router.baseURL, primary);
});

test('SSE bodies remain open beyond the response-header timeout', async () => {
  const router = createAPIRouter({
    ...config,
    headerTimeout: 5,
    fetch: async (url, init) => {
      if (url.endsWith('/health')) return healthy();
      const body = new ReadableStream({
        start(c) {
          init.signal.addEventListener('abort', () =>
            c.error(init.signal.reason),
          );
          setTimeout(() => {
            c.enqueue(new TextEncoder().encode('data: event\n\n'));
            c.close();
          }, 20);
        },
      });
      return new Response(body);
    },
  });
  assert.equal(await (await router.fetch('/events')).text(), 'data: event\n\n');
});

test('periodic measurements switch to a clearly faster recovered route', async () => {
  let directAvailable = false;
  const router = createAPIRouter({
    ...config,
    routeEvaluationInterval: 1,
    switchMinSavings: 0,
    switchRatio: 1,
    fetch: async (url) => {
      if (url === `${primary}/health` && !directAvailable)
        throw new TypeError('no IPv6');
      if (url === `${primary}/health`)
        await new Promise((resolve) => setTimeout(resolve, 1));
      if (url === `${fallback}/health`)
        await new Promise((resolve) => setTimeout(resolve, 10));
      return url.endsWith('/health') ? healthy() : new Response('ok');
    },
  });
  await router.fetch('/a');
  assert.equal(router.baseURL, fallback);
  directAvailable = true;
  await new Promise((resolve) => setTimeout(resolve, 2));
  await router.fetch('/b');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(router.baseURL, primary);
});
