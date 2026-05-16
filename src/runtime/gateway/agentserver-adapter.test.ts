import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AGENTSERVER_ADAPTER_MODE,
  EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
  createInlineAgentServerAdapter,
} from './agentserver-adapter.js';

test('AgentServerAdapter defaults to owned orchestrator with third-party backend boundary', async () => {
  const adapter = createInlineAgentServerAdapter(async () => ({
    ok: false,
    error: 'not-dispatched',
  }));

  assert.equal(adapter.mode, DEFAULT_AGENTSERVER_ADAPTER_MODE);
  assert.equal(adapter.decisionOwner, 'AgentServer');
  assert.equal(adapter.backendBoundary, 'third-party-backend');
  assert.deepEqual(await adapter.generateTask({} as never), { ok: false, error: 'not-dispatched' });
});

test('third-party-adapter mode is fail-closed unless explicit compatibility is requested', () => {
  assert.throws(
    () => createInlineAgentServerAdapter(async () => ({ ok: false, error: 'blocked' }), {
      mode: 'third-party-adapter',
    }),
    /explicit compatibilityMode=explicit-third-party-adapter/,
  );

  const adapter = createInlineAgentServerAdapter(async () => ({ ok: false, error: 'compat' }), {
    mode: 'third-party-adapter',
    compatibilityMode: EXPLICIT_THIRD_PARTY_ADAPTER_COMPATIBILITY_MODE,
  });
  assert.equal(adapter.mode, 'third-party-adapter');
  assert.equal(adapter.backendBoundary, 'third-party-adapter');
});
