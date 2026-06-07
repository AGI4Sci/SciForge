import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_BACKEND_GENERATION_ADAPTER_MODE,
  EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
  backendAdapterForGenerationAdapter,
  createInlineBackendGenerationAdapter,
} from './backend-generation-adapter.js';

test('BackendGenerationAdapter defaults to owned orchestrator with third-party backend boundary', async () => {
  const adapter = createInlineBackendGenerationAdapter(async () => ({
    ok: false,
    error: 'not-dispatched',
  }));

  assert.equal(adapter.mode, DEFAULT_BACKEND_GENERATION_ADAPTER_MODE);
  assert.equal(adapter.decisionOwner, 'AgentHost');
  assert.equal(adapter.backendBoundary, 'third-party-backend');
  assert.deepEqual(await adapter.generateTask({} as never), { ok: false, error: 'not-dispatched' });
  assert.equal(backendAdapterForGenerationAdapter(adapter, 'codex').backend, 'codex');
});

test('third-party-adapter mode is fail-closed unless explicit compatibility is requested', () => {
  assert.throws(
    () => createInlineBackendGenerationAdapter(async () => ({ ok: false, error: 'blocked' }), {
      mode: 'third-party-adapter',
    }),
    /explicit compatibilityMode=explicit-third-party-adapter/,
  );

  const adapter = createInlineBackendGenerationAdapter(async () => ({ ok: false, error: 'compat' }), {
    mode: 'third-party-adapter',
    compatibilityMode: EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
  });
  assert.equal(adapter.mode, 'third-party-adapter');
  assert.equal(adapter.backendBoundary, 'third-party-adapter');
});
