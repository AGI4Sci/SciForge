import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { startCodexResponsesProxyServer } from './proxy';

type UpstreamFailureFixture = {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string | readonly string[]>;
};

type RawProxyFailureRoute = {
  label: string;
  method: 'GET' | 'POST';
  proxyPath: '/v1/models' | '/v1/chat/completions';
  upstreamPath: '/v1/models' | '/v1/chat/completions';
  requestBody?: unknown;
};

type UpstreamFailureCase = {
  label: string;
  fixture: UpstreamFailureFixture;
  bodyKind: string;
  code: string;
  retryable: boolean;
  forbidden: string[];
};

const rawProxyRoutes: RawProxyFailureRoute[] = [
  {
    label: 'Models',
    method: 'GET',
    proxyPath: '/v1/models',
    upstreamPath: '/v1/models',
  },
  {
    label: 'Chat Completions',
    method: 'POST',
    proxyPath: '/v1/chat/completions',
    upstreamPath: '/v1/chat/completions',
    requestBody: {
      model: 'bailian/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Trigger an upstream provider failure' }],
    },
  },
];

const rawFailureCases: UpstreamFailureCase[] = [
  makeRawFailureCase({
    label: 'HTML challenge',
    status: 502,
    contentType: 'text/html; charset=utf-8',
    bodyKind: 'html-challenge',
    code: 'upstream_unavailable',
    retryable: true,
    body: [
      '<!doctype html><html><head><title>Just a moment...</title></head>',
      '<body>Cloudflare challenge cf_chl_opt https://auth.provider.example/oauth/token?client_secret=html-secret sk-live-html-secret-1234567890</body></html>',
    ].join(''),
    forbidden: [
      'sk-live-html-secret-1234567890',
      'https://auth.provider.example/oauth/token?client_secret=html-secret',
      'Cloudflare challenge',
      'cf_chl_opt',
      '<html',
    ],
  }),
  makeRawFailureCase({
    label: 'SSE credential error',
    status: 403,
    contentType: 'text/event-stream; charset=utf-8',
    bodyKind: 'sse',
    code: 'upstream_forbidden',
    retryable: false,
    body: [
      'event: error',
      'data: {"error":"invalid_api_key","message":"POST https://provider.example/token failed with Bearer sk-sse-secret-abcdefghijklmnopqrstuvwxyz"}',
      '',
    ].join('\n'),
    forbidden: [
      'sk-sse-secret-abcdefghijklmnopqrstuvwxyz',
      'https://provider.example/token',
      'invalid_api_key',
      'event: error',
      'data:',
    ],
  }),
  makeRawFailureCase({
    label: 'JSON credential error',
    status: 401,
    contentType: 'application/json',
    bodyKind: 'json',
    code: 'upstream_unauthorized',
    retryable: false,
    body: JSON.stringify({
      error: {
        code: 'provider_bad_auth',
        message: 'Authorization: Bearer sk-json-secret-abcdefghijklmnopqrstuvwxyz was rejected by https://tokens.provider.example/oauth/token',
        details: { api_key: 'sk-json-secret-abcdefghijklmnopqrstuvwxyz' },
      },
    }),
    forbidden: [
      'sk-json-secret-abcdefghijklmnopqrstuvwxyz',
      'https://tokens.provider.example/oauth/token',
      'Authorization: Bearer',
      'provider_bad_auth',
      'api_key',
    ],
  }),
];

for (const route of rawProxyRoutes) {
  for (const failureCase of rawFailureCases) {
    test(`${route.label} proxy scrubs upstream ${failureCase.label} non-2xx failures`, async () => {
      const result = await requestRawProxyFailure(route, failureCase.fixture);

      assert.equal(result.status, failureCase.fixture.status);
      assert.equal(result.headers.get('www-authenticate'), null);
      assert.equal(result.headers.get('set-cookie'), null);
      assert.equal(result.headers.get('x-upstream-api-key'), null);
      assert.equal(result.headers.get('content-type')?.startsWith('application/json; charset=utf-8'), true);
      assert.equal(result.json.error.code, failureCase.code);
      assert.equal(result.json.error.status, failureCase.fixture.status);
      assert.equal(result.json.error.retryable, failureCase.retryable);
      assert.equal(result.json.error.audit.bodyBytes, Buffer.byteLength(failureCase.fixture.body, 'utf8'));
      assert.equal(result.json.error.audit.bodyKind, failureCase.bodyKind);
      assert.equal(result.json.error.audit.contentType, failureCase.fixture.contentType.split(';', 1)[0]);
      assert.match(result.json.error.audit.bodySha256, /^sha256:[a-f0-9]{64}$/);
      assertNoRawProviderLeak(result.text, [
        ...failureCase.forbidden,
        'header-secret-that-must-not-leak',
        'https://headers.provider.example/oauth/token',
      ]);
    });
  }
}

test('Responses proxy scrubs raw HTML provider failures from public errors', async () => {
  const secret = 'sk-live-html-secret-1234567890';
  const tokenEndpoint = 'https://auth.provider.example/oauth/token?client_secret=very-secret';
  const body = [
    '<!doctype html><html><head><title>Just a moment...</title></head>',
    `<body>Cloudflare challenge cf_chl_opt ${tokenEndpoint} ${secret}</body></html>`,
  ].join('');

  const result = await requestResponsesFailure({
    status: 502,
    contentType: 'text/html; charset=utf-8',
    body,
  });

  assert.equal(result.status, 502);
  assert.equal(result.json.error.code, 'upstream_unavailable');
  assert.equal(result.json.error.status, 502);
  assert.equal(result.json.error.retryable, true);
  assert.match(result.json.error.message, /Upstream provider returned HTTP 502 Bad Gateway/);
  assert.equal(result.json.error.audit.bodyBytes, Buffer.byteLength(body, 'utf8'));
  assert.equal(result.json.error.audit.bodyKind, 'html-challenge');
  assert.equal(result.json.error.audit.contentType, 'text/html');
  assert.match(result.json.error.audit.bodySha256, /^sha256:[a-f0-9]{64}$/);
  assertNoRawProviderLeak(result.text, [secret, tokenEndpoint, 'Cloudflare challenge', 'cf_chl_opt', '<html']);
});

test('Responses proxy scrubs upstream JSON error message and credential fields', async () => {
  const secret = 'sk-json-secret-abcdefghijklmnopqrstuvwxyz';
  const tokenEndpoint = 'https://tokens.provider.example/oauth/token';
  const body = JSON.stringify({
    error: {
      code: 'provider_bad_auth',
      message: `POST ${tokenEndpoint} failed with Authorization: Bearer ${secret}`,
      details: {
        api_key: secret,
        challenge_html: '<html><script>window._cf_chl_opt={}</script></html>',
      },
    },
  });

  const result = await requestResponsesFailure({
    status: 401,
    contentType: 'application/json',
    body,
  });

  assert.equal(result.status, 401);
  assert.equal(result.json.error.code, 'upstream_unauthorized');
  assert.equal(result.json.error.status, 401);
  assert.equal(result.json.error.retryable, false);
  assert.equal(result.json.error.audit.bodyKind, 'html-challenge');
  assert.equal(result.json.error.audit.contentType, 'application/json');
  assertNoRawProviderLeak(result.text, [secret, tokenEndpoint, 'Authorization: Bearer', 'provider_bad_auth', 'challenge_html']);
});

test('Responses proxy scrubs upstream SSE challenge bodies from public errors', async () => {
  const secret = 'sk-sse-secret-abcdefghijklmnopqrstuvwxyz';
  const tokenEndpoint = 'https://provider.example/token';
  const body = [
    'event: error',
    `data: <html><script>window._cf_chl_opt={tokenEndpoint:"${tokenEndpoint}", key:"${secret}"}</script></html>`,
    '',
  ].join('\n');

  const result = await requestResponsesFailure({
    status: 403,
    contentType: 'text/event-stream; charset=utf-8',
    body,
  });

  assert.equal(result.status, 403);
  assert.equal(result.json.error.code, 'upstream_forbidden');
  assert.equal(result.json.error.status, 403);
  assert.equal(result.json.error.audit.bodyKind, 'html-challenge');
  assert.equal(result.json.error.audit.contentType, 'text/event-stream');
  assertNoRawProviderLeak(result.text, [secret, tokenEndpoint, 'window._cf_chl_opt', 'event: error', 'data: <html>']);
});

test('Healthz upstream preflight classifies missing config without calling upstream', async () => {
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: '',
    port: 0,
  });

  try {
    const result = await requestPreflight(proxy.url);

    assert.equal(result.status, 200);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.upstream.category, 'config-missing');
    assert.equal(result.json.upstream.releaseAcceptance, 'not-evaluated');
    assert.equal(result.json.upstream.audit, undefined);
  } finally {
    await proxy.close();
  }
});

test('Healthz upstream preflight classifies provider auth and scrubs provider body', async () => {
  const secret = 'sk-preflight-secret-abcdefghijklmnopqrstuvwxyz';
  const tokenEndpoint = 'https://tokens.provider.example/oauth/token';
  const result = await requestPreflightFromFixture({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 'provider_bad_auth',
        message: `Authorization: Bearer ${secret} rejected by ${tokenEndpoint}`,
      },
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.upstream.category, 'provider-auth');
  assert.equal(result.json.upstream.httpStatus, 401);
  const audit = result.json.upstream.audit;
  assert.ok(audit);
  assert.equal(audit.rawProviderBody, 'suppressed');
  assert.equal(result.json.upstream.releaseAcceptance, 'not-evaluated');
  assertNoRawProviderLeak(result.text, [secret, tokenEndpoint, 'Authorization: Bearer', 'provider_bad_auth']);
});

test('Healthz upstream preflight classifies rate limits, upstream outage, and repo bugs', async () => {
  const rateLimited = await requestPreflightFromFixture({
    status: 429,
    contentType: 'application/json',
    body: '{"error":{"message":"quota exhausted for sk-rate-limited-secret"}}',
  });
  assert.equal(rateLimited.json.upstream.category, 'rate-limited');
  assert.equal(rateLimited.json.upstream.retryable, true);
  assertNoRawProviderLeak(rateLimited.text, ['sk-rate-limited-secret', 'quota exhausted']);

  const outage = await requestPreflightFromFixture({
    status: 503,
    contentType: 'text/html',
    body: '<html><body>provider outage sk-outage-secret</body></html>',
  });
  assert.equal(outage.json.upstream.category, 'upstream-outage');
  assert.equal(outage.json.upstream.retryable, true);
  assertNoRawProviderLeak(outage.text, ['sk-outage-secret', '<html>']);

  const repoBug = await requestPreflightFromFixture({
    status: 400,
    contentType: 'application/json',
    body: '{"error":{"message":"bad request from proxy using sk-repo-bug-secret"}}',
  });
  assert.equal(repoBug.json.upstream.category, 'repo-bug');
  assert.equal(repoBug.json.upstream.retryable, false);
  assertNoRawProviderLeak(repoBug.text, ['sk-repo-bug-secret', 'bad request from proxy']);
});

test('Healthz upstream preflight classifies network failures as upstream outage', async () => {
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: 'http://127.0.0.1:1/v1',
    upstreamApiKey: 'sk-network-secret-that-must-not-leak',
    port: 0,
  });

  try {
    const result = await requestPreflight(proxy.url);

    assert.equal(result.status, 200);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.upstream.category, 'upstream-outage');
    assert.equal(result.json.upstream.retryable, true);
    assertNoRawProviderLeak(result.text, ['sk-network-secret-that-must-not-leak']);
  } finally {
    await proxy.close();
  }
});

function makeRawFailureCase(input: Omit<UpstreamFailureCase, 'fixture'> & {
  status: number;
  contentType: string;
  body: string;
}): UpstreamFailureCase {
  return {
    label: input.label,
    bodyKind: input.bodyKind,
    code: input.code,
    retryable: input.retryable,
    forbidden: input.forbidden,
    fixture: {
      status: input.status,
      contentType: input.contentType,
      body: input.body,
      headers: {
        'www-authenticate': 'Bearer realm="https://headers.provider.example/oauth/token", error_description="header-secret-that-must-not-leak"',
        'set-cookie': [
          'provider_session=header-secret-that-must-not-leak; HttpOnly',
          'provider_challenge=https://headers.provider.example/oauth/token; HttpOnly',
        ],
        'x-upstream-api-key': 'header-secret-that-must-not-leak',
      },
    },
  };
}

async function requestPreflightFromFixture(fixture: UpstreamFailureFixture): Promise<{
  status: number;
  text: string;
  json: UpstreamPreflightJson;
}> {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/v1/models');
    assert.equal(request.method, 'GET');
    response.writeHead(fixture.status, {
      'content-type': fixture.contentType,
      ...fixture.headers,
    });
    response.end(fixture.body);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    upstreamApiKey: 'sk-server-side-secret-that-must-not-leak',
    port: 0,
  });

  try {
    return await requestPreflight(proxy.url);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestPreflight(proxyUrl: string): Promise<{
  status: number;
  text: string;
  json: UpstreamPreflightJson;
}> {
  const response = await fetch(`${proxyUrl}/healthz?check=upstream`, {
    headers: {
      authorization: 'Bearer sk-client-secret-that-must-not-echo',
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: JSON.parse(text),
  };
}

async function requestRawProxyFailure(route: RawProxyFailureRoute, fixture: UpstreamFailureFixture): Promise<{
  status: number;
  headers: Headers;
  text: string;
  json: ProxyFailureJson;
}> {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, route.upstreamPath);
    assert.equal(request.method, route.method);
    response.writeHead(fixture.status, {
      'content-type': fixture.contentType,
      ...fixture.headers,
    });
    response.end(fixture.body);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    port: 0,
  });

  try {
    const headers: Record<string, string> = {
      authorization: 'Bearer sk-client-secret-that-must-not-echo',
    };
    const init: RequestInit = {
      method: route.method,
      headers,
    };
    if (route.requestBody !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(route.requestBody);
    }
    const response = await fetch(`${proxy.url}${route.proxyPath}`, init);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: JSON.parse(text),
    };
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestResponsesFailure(fixture: UpstreamFailureFixture): Promise<{
  status: number;
  text: string;
  json: ProxyFailureJson;
}> {
  const upstream = createServer((request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    response.writeHead(fixture.status, {
      'content-type': fixture.contentType,
      ...fixture.headers,
    });
    response.end(fixture.body);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const proxy = await startCodexResponsesProxyServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    port: 0,
  });

  try {
    const response = await fetch(`${proxy.url}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-client-secret-that-must-not-echo',
      },
      body: JSON.stringify({
        model: 'bailian/deepseek-v4-flash',
        input: 'Trigger an upstream provider failure',
      }),
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: JSON.parse(text),
    };
  } finally {
    await proxy.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
}

type ProxyFailureJson = {
  error: {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
    audit: {
      bodyBytes: number;
      bodyKind: string;
      bodySha256: string;
      contentType?: string;
    };
  };
};

type UpstreamPreflightJson = {
  ok: boolean;
  upstreamBaseUrl: string;
  checkedAt: string;
  upstream: {
    schemaVersion: string;
    check: string;
    endpoint: string;
    ok: boolean;
    category: string;
    message: string;
    retryable: boolean;
    durationMs: number;
    timeoutMs: number;
    httpStatus?: number;
    releaseAcceptance: string;
    audit?: {
      rawProviderBody: string;
      bodyBytes: number;
      bodyKind: string;
      bodySha256: string;
      contentType?: string;
    };
  };
};

function assertNoRawProviderLeak(text: string, forbidden: string[]) {
  for (const value of forbidden) {
    assert.equal(
      text.includes(value),
      false,
      `public Responses error leaked raw provider content: ${value}`,
    );
  }
  assert.equal(text.includes('sk-client-secret-that-must-not-echo'), false);
}
