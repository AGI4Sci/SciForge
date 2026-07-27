import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_PLAN_ALLOWED_ROUTES,
  CODEX_PLAN_PROVIDER_ID,
  CODEX_PLAN_UPSTREAM_BASE_URL,
  createCodexPlanAdapter,
  createCodexPlanRuntimeConfig,
  extractCodexTraceCorrelation,
} from './codex';

test('Codex adapter owns the official subscription upstream and narrow route allowlist', () => {
  const adapter = createCodexPlanAdapter();
  assert.equal(adapter.upstreamBaseUrl, CODEX_PLAN_UPSTREAM_BASE_URL);
  assert.equal(adapter.upstreamBaseUrl, 'https://chatgpt.com/backend-api/codex');
  assert.equal(adapter.wireProtocol, 'responses');
  assert.deepEqual(adapter.allowedRoutes, CODEX_PLAN_ALLOWED_ROUTES);
  assert.deepEqual(adapter.allowedRoutes, [
    { method: 'GET', path: '/models' },
    { method: 'POST', path: '/responses' },
    { method: 'POST', path: '/responses/compact' },
  ]);
});

test('Codex runtime config delegates authentication to Codex without an environment key', () => {
  const config = createCodexPlanRuntimeConfig('http://127.0.0.1:3893/v1/');
  assert.equal(CODEX_PLAN_PROVIDER_ID, 'sciforge-plan-gateway');
  assert.match(config, new RegExp(`^model_provider = "${CODEX_PLAN_PROVIDER_ID}"`));
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:3893\/v1"/);
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /requires_openai_auth = true/);
  assert.match(config, /supports_websockets = false/);
  assert.doesNotMatch(config, /env_key|experimental_bearer_token|auth\.command/);
});

test('Codex runtime config rejects non-loopback and HTTPS local endpoints', () => {
  assert.throws(
    () => createCodexPlanRuntimeConfig('http://0.0.0.0:3893/v1'),
    /loopback HTTP/,
  );
  assert.throws(
    () => createCodexPlanRuntimeConfig('https://127.0.0.1:3893/v1'),
    /loopback HTTP/,
  );
  assert.throws(
    () => createCodexPlanRuntimeConfig('http://127.0.0.1:3893/v1?token=secret'),
    /query/,
  );
});

test('extracts GUI scope and Codex reserved turn correlation from metadata JSON', () => {
  const metadata = JSON.stringify({
    session_id: 'native-session',
    thread_id: 'native-thread',
    turn_id: 'native-turn',
    window_id: 'native-window',
    runtime_id: 'codex',
    gui_thread_id: 'gui-thread',
    trace_id: 'ignored-custom-trace',
    gui_turn_id: 'ignored-custom-turn',
  });
  const body = Buffer.from(JSON.stringify({
    client_metadata: { 'x-codex-turn-metadata': metadata },
  }));
  assert.deepEqual(extractCodexTraceCorrelation({ headers: new Headers(), body }), {
    runtimeId: 'codex',
    threadId: 'gui-thread',
    turnId: 'native-turn',
  });
});
