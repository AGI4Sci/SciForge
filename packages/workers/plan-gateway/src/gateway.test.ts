import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import test from 'node:test';

import { createBuiltInPlanAdapterRegistry } from './adapters';
import type {
  PlanGatewayEvent,
  PlanGatewayTransport,
  PlanGatewayUpstreamRequest,
  PlanGatewayUpstreamResponse,
} from './contract';
import { createPlanGatewayServer, startPlanGatewayServer } from './gateway';
import { CodingPlanAdapterRegistry } from './registry';

test('rejects non-loopback binding and unknown adapters before listening', () => {
  const registry = createBuiltInPlanAdapterRegistry();
  assert.throws(
    () => createPlanGatewayServer({ adapterId: 'codex', adapterRegistry: registry, host: '0.0.0.0' }),
    /loopback/,
  );
  assert.throws(
    () => createPlanGatewayServer({ adapterId: 'missing', adapterRegistry: registry }),
    /Unsupported coding plan adapter/,
  );
});

test('forwards approved requests and streaming bodies without protocol translation', async () => {
  const transport = new FakeTransport();
  const events: PlanGatewayEvent[] = [];
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    instanceId: 'instance-test',
    transport,
    eventSink: (event) => events.push(event),
  });

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses?mode=stream&cursor=next',
      method: 'POST',
      headers: {
        authorization: 'Bearer subscription-token',
        cookie: 'session=secret',
        'x-access-token': 'another-secret',
        'x-api-key': 'x-api-secret',
        'api-key': 'api-secret',
        'anthropic-api-key': 'anthropic-secret',
        'proxy-authorization': 'Basic proxy-secret',
        'x-custom-token': 'custom-secret',
        'x-goog-api-key': 'google-secret',
        'accept-encoding': 'gzip, br',
        connection: 'x-remove',
        'x-remove': 'hop-value',
        'x-runtime-identity': 'codex-cli',
        'content-type': 'application/json',
      },
      chunks: ['{"input":"', 'hello"}'],
    });

    assert.equal(result.status, 201);
    assert.equal(result.body, 'first-second');
    assert.equal(result.headers['x-upstream'], 'preserved');
    assert.equal(result.headers['x-response-hop'], undefined);
    assert.equal(transport.requests.length, 1);
    assert.equal(transport.requests[0].url, 'https://chatgpt.com/backend-api/codex/responses?mode=stream&cursor=next');
    assert.equal(transport.requests[0].method, 'POST');
    assert.equal(transport.requests[0].body, '{"input":"hello"}');
    assert.equal(transport.requests[0].headers.authorization, 'Bearer subscription-token');
    assert.equal(transport.requests[0].headers.cookie, undefined);
    assert.equal(transport.requests[0].headers['x-access-token'], undefined);
    assert.equal(transport.requests[0].headers['x-api-key'], undefined);
    assert.equal(transport.requests[0].headers['api-key'], undefined);
    assert.equal(transport.requests[0].headers['anthropic-api-key'], undefined);
    assert.equal(transport.requests[0].headers['proxy-authorization'], undefined);
    assert.equal(transport.requests[0].headers['x-custom-token'], undefined);
    assert.equal(transport.requests[0].headers['x-goog-api-key'], undefined);
    assert.equal(transport.requests[0].headers['x-runtime-identity'], 'codex-cli');
    assert.equal(transport.requests[0].headers['accept-encoding'], 'identity');
    assert.equal(transport.requests[0].headers.connection, undefined);
    assert.equal(transport.requests[0].headers['x-remove'], undefined);
    assert.equal(transport.requests[0].headers.host, undefined);

    const requestStart = events.find((event) => event.type === 'request.start');
    assert.ok(requestStart?.type === 'request.start');
    assert.equal(headerValue(requestStart.headers, 'authorization'), 'Bearer subscription-token');
    assert.equal(headerValue(requestStart.headers, 'cookie'), undefined);
    assert.equal(headerValue(requestStart.headers, 'x-access-token'), undefined);
    assert.equal(headerValue(requestStart.headers, 'x-api-key'), undefined);
    assert.equal(headerValue(requestStart.headers, 'api-key'), undefined);
    assert.equal(headerValue(requestStart.headers, 'anthropic-api-key'), undefined);
    assert.equal(headerValue(requestStart.headers, 'proxy-authorization'), undefined);
    assert.equal(headerValue(requestStart.headers, 'x-custom-token'), undefined);
    assert.equal(headerValue(requestStart.headers, 'x-goog-api-key'), undefined);
    assert.ok(requestStart.sensitiveValues?.includes('session=secret'));
    assert.ok(requestStart.sensitiveValues?.includes('another-secret'));
    assert.equal(requestStart.path, '/v1/responses?mode=stream&cursor=next');
    assert.equal(headerValue(requestStart.headers, 'accept-encoding'), 'identity');
    assert.equal(requestStart.correlation.requestId, requestStart.requestId);
    assert.equal(
      Buffer.concat(
        events
          .filter((event): event is Extract<PlanGatewayEvent, { type: 'request.chunk' }> => event.type === 'request.chunk')
          .map((event) => Buffer.from(event.chunk)),
      ).toString(),
      '{"input":"hello"}',
    );
    assert.equal(
      Buffer.concat(
        events
          .filter((event): event is Extract<PlanGatewayEvent, { type: 'response.chunk' }> => event.type === 'response.chunk')
          .map((event) => Buffer.from(event.chunk)),
      ).toString(),
      'first-second',
    );
    assert.ok(events.some((event) => event.type === 'response.end'));
  } finally {
    await started.close();
  }
});

test('health and manifest are local control routes with no upstream traffic', async () => {
  const transport = new FakeTransport();
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    instanceId: 'health-instance',
    transport,
  });

  try {
    const health = await sendRequest(started.origin, { path: '/healthz', method: 'GET' });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), {
      status: 'ok',
      workerId: 'sciforge.plan-gateway',
      version: '0.1.0',
      adapterId: 'codex',
      protocol: 'responses',
      upstreamOrigin: 'https://chatgpt.com',
      traceCapture: 'disabled',
      instanceId: 'health-instance',
    });
    const manifest = await sendRequest(started.origin, { path: '/manifest', method: 'GET' });
    assert.equal(manifest.status, 200);
    assert.equal(JSON.parse(manifest.body).workerId, 'sciforge.plan-gateway');
    assert.equal(transport.requests.length, 0);
  } finally {
    await started.close();
  }
});

test('shutdown waits for delayed response-end trace persistence on a keep-alive connection', async () => {
  const transport = new FakeTransport();
  const agent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
  let releasePersistence = (): void => undefined;
  let markPersistenceStarted = (): void => undefined;
  const persistenceGate = new Promise<void>((resolve) => { releasePersistence = resolve; });
  const persistenceStarted = new Promise<void>((resolve) => { markPersistenceStarted = resolve; });
  const responseBodies: string[] = [];
  let terminalTracePersisted = false;
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
    eventSink: async (event) => {
      if (event.type === 'response.chunk') responseBodies.push(Buffer.from(event.chunk).toString());
      if (event.type === 'response.end') {
        markPersistenceStarted();
        await persistenceGate;
        terminalTracePersisted = true;
      }
    },
  });
  let closePromise: Promise<void> | undefined;

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      chunks: ['{}'],
      agent,
    });
    assert.equal(result.body, 'first-second');
    await persistenceStarted;
    assert.equal(responseBodies.join(''), 'first-second');

    const serverClosed = once(started.server, 'close');
    let closeResolved = false;
    closePromise = started.close().then(() => { closeResolved = true; });
    await serverClosed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closeResolved, false);
    assert.equal(terminalTracePersisted, false);

    releasePersistence();
    await closePromise;
    assert.equal(closeResolved, true);
    assert.equal(terminalTracePersisted, true);
  } finally {
    releasePersistence();
    await (closePromise ?? started.close());
    agent.destroy();
  }
});

test('fails closed for disallowed routes, methods, and missing runtime auth', async () => {
  const transport = new FakeTransport();
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
  });

  try {
    const disallowed = await sendRequest(started.origin, {
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(disallowed.status, 404);
    const wrongMethod = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'GET',
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(wrongMethod.status, 405);
    const unauthenticated = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      chunks: ['{}'],
    });
    assert.equal(unauthenticated.status, 401);
    const absoluteTarget = await sendRequest(started.origin, {
      path: 'http://attacker.invalid/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(absoluteTarget.status, 400);
    const authorityTarget = await sendRequest(started.origin, {
      path: '//attacker.invalid/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(authorityTarget.status, 400);
    const encodedTraversal = await sendRequest(started.origin, {
      path: '/v1/%2e%2e/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(encodedTraversal.status, 404);
    assert.equal(transport.requests.length, 0);
  } finally {
    await started.close();
  }
});

test('delegated credential rejection is traced without contacting the upstream', async () => {
  const transport = new FakeTransport();
  const events: PlanGatewayEvent[] = [];
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
    eventSink: (event) => events.push(event),
  });

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      chunks: ['{}'],
    });
    assert.equal(result.status, 401);
    assert.match(result.body, /PLAN_AUTH_REQUIRED/);
    assert.equal(transport.requests.length, 0);
    const requestStart = events.find((event) => event.type === 'request.start');
    const requestError = events.find((event) => event.type === 'request.error');
    assert.ok(requestStart?.type === 'request.start');
    assert.ok(requestError?.type === 'request.error');
    assert.equal(requestError.requestId, requestStart.requestId);
    assert.equal(requestError.code, 'PLAN_AUTH_REQUIRED');
    assert.equal(headerValue(requestStart.headers, 'authorization'), undefined);
    assert.deepEqual(requestStart.sensitiveValues, []);
  } finally {
    await started.close();
  }
});

test('rejects credential-shaped query parameters before contacting the upstream', async () => {
  const transport = new FakeTransport();
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
  });

  try {
    for (const name of ['access_token', 'api_key', 'key', 'token', 'custom_token']) {
      const result = await sendRequest(started.origin, {
        path: `/v1/responses?mode=stream&${name}=query-secret`,
        method: 'POST',
        headers: { authorization: 'Bearer caller-token' },
        chunks: ['{}'],
      });
      assert.equal(result.status, 400);
      assert.match(result.body, /PLAN_QUERY_CREDENTIAL_NOT_ALLOWED/);
    }
    assert.equal(transport.requests.length, 0);
  } finally {
    await started.close();
  }
});

test('relays redirects without following them to another upstream', async () => {
  const transport = new RedirectTransport();
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
  });

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      chunks: ['{}'],
    });
    assert.equal(result.status, 307);
    assert.equal(result.headers.location, 'https://attacker.invalid/responses');
    assert.equal(transport.calls, 1);
  } finally {
    await started.close();
  }
});

test('rejects compressed upstream bodies instead of recording binary bytes as text', async () => {
  const events: PlanGatewayEvent[] = [];
  const transport: PlanGatewayTransport = {
    async forward(request) {
      for await (const _chunk of request.body) {
        // Consume the request before returning a deliberately invalid response.
      }
      assert.equal(request.headers.get('accept-encoding'), 'identity');
      return {
        status: 200,
        headers: [
          ['content-type', 'text/event-stream'],
          ['content-encoding', 'gzip'],
        ],
        body: responseChunks(),
      };
    },
  };
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
    eventSink: (event) => events.push(event),
  });

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'accept-encoding': 'br',
      },
      chunks: ['{}'],
    });
    assert.equal(result.status, 502);
    assert.match(result.body, /PLAN_RESPONSE_ENCODING_UNSUPPORTED/);
    assert.equal(events.some((event) => event.type === 'response.start'), false);
    assert.equal(events.some((event) => event.type === 'response.chunk'), false);
    assert.ok(events.some(
      (event) => event.type === 'request.error' && event.code === 'PLAN_RESPONSE_ENCODING_UNSUPPORTED',
    ));
  } finally {
    await started.close();
  }
});

test('aborts the upstream operation when the client disconnects', async () => {
  let observeAbort: (() => void) | undefined;
  let observeStart: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => { observeAbort = resolve; });
  const forwardingStarted = new Promise<void>((resolve) => { observeStart = resolve; });
  const transport: PlanGatewayTransport = {
    forward(request) {
      observeStart?.();
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          observeAbort?.();
          reject(new Error('aborted'));
        }, { once: true });
      });
    },
  };
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
  });

  try {
    const target = new URL(started.origin);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: '/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    request.once('error', () => undefined);
    request.flushHeaders();
    await forwardingStarted;
    request.destroy();
    await Promise.race([
      aborted,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('abort was not forwarded')), 1_000)),
    ]);
  } finally {
    await started.close();
  }
});

test('event sink failures never create a second forwarding path', async () => {
  const transport = new FakeTransport();
  const logs: string[] = [];
  const started = await startPlanGatewayServer({
    adapterId: 'codex',
    adapterRegistry: createBuiltInPlanAdapterRegistry(),
    port: 0,
    transport,
    eventSink: () => { throw new Error('sink unavailable'); },
    log: (message) => logs.push(message),
  });

  try {
    const result = await sendRequest(started.origin, {
      path: '/v1/responses',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      chunks: ['{}'],
    });
    assert.equal(result.status, 201);
    assert.equal(transport.requests.length, 1);
    assert.ok(logs.some((message) => message.includes('event sink failed')));
  } finally {
    await started.close();
  }
});

test('registry rejects non-HTTPS upstreams even with a custom transport', () => {
  assert.throws(
    () => new CodingPlanAdapterRegistry([{
      id: 'unsafe',
      upstreamBaseUrl: 'http://example.com/model',
      wireProtocol: 'responses',
      allowedRoutes: [{ method: 'POST', path: '/responses' }],
      createRuntimeConfig: () => '',
      transformForwardHeaders: (headers) => headers,
    }]),
    /HTTPS/,
  );
});

class FakeTransport implements PlanGatewayTransport {
  readonly requests: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  }> = [];

  async forward(request: PlanGatewayUpstreamRequest): Promise<PlanGatewayUpstreamResponse> {
    const chunks: Buffer[] = [];
    for await (const chunk of request.body) chunks.push(Buffer.from(chunk));
    this.requests.push({
      url: request.url.toString(),
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: Buffer.concat(chunks).toString(),
    });
    return {
      status: 201,
      statusText: 'Created',
      headers: [
        ['content-type', 'text/event-stream'],
        ['x-upstream', 'preserved'],
        ['connection', 'x-response-hop'],
        ['x-response-hop', 'remove-me'],
      ],
      body: responseChunks(),
    };
  }
}

class RedirectTransport implements PlanGatewayTransport {
  calls = 0;

  async forward(request: PlanGatewayUpstreamRequest): Promise<PlanGatewayUpstreamResponse> {
    for await (const _chunk of request.body) {
      // Consume the client request before returning the upstream response.
    }
    this.calls += 1;
    return {
      status: 307,
      statusText: 'Temporary Redirect',
      headers: [['location', 'https://attacker.invalid/responses']],
      body: emptyBody(),
    };
  }
}

async function* responseChunks(): AsyncGenerator<Uint8Array> {
  yield Buffer.from('first-');
  await Promise.resolve();
  yield Buffer.from('second');
}

async function* emptyBody(): AsyncGenerator<Uint8Array> {
  yield* [];
}

function sendRequest(
  origin: string,
  options: {
    path: string;
    method: string;
    headers?: Record<string, string>;
    chunks?: string[];
    agent?: HttpAgent;
  },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(origin);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: options.path,
      method: options.method,
      headers: options.headers,
      agent: options.agent,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    request.once('error', reject);
    for (const chunk of options.chunks ?? []) request.write(chunk);
    request.end();
  });
}

function headerValue(headers: ReadonlyArray<readonly [string, string]>, name: string): string | undefined {
  return headers.find(([header]) => header.toLowerCase() === name.toLowerCase())?.[1];
}
