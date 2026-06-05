import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_TOOLS_RUN_STREAM_SCHEMA,
  legacyToolsRunStreamDecision,
} from './legacy-tools-run-guard.js';

test('legacy tools stream guard only allows explicit diagnostic shim payloads', () => {
  assert.deepEqual(legacyToolsRunStreamDecision({
    schemaVersion: LEGACY_TOOLS_RUN_STREAM_SCHEMA,
    kind: 'legacy-diagnostic-shim',
    diagnosticOnly: true,
    prompt: '/computer-use diagnostic --legacy-workspace-gateway inspect refs',
    workspacePath: '/tmp/workspace',
    uiState: {
      diagnosticOnly: true,
      legacyWorkspaceGatewayShim: true,
      guiOwnsExecutor: false,
      guiOwnsExecutionRoute: false,
    },
  }), {
    allowed: true,
    reason: 'legacy-diagnostic-shim',
  });
});

test('legacy tools stream guard seals product and executor-routed payloads', () => {
  const product = legacyToolsRunStreamDecision({
    skillDomain: 'knowledge',
    prompt: 'What is the current Python release?',
    workspacePath: '/tmp/workspace',
  });
  assert.equal(product.allowed, false);
  assert.match(product.reason, /sealed/i);

  const routed = legacyToolsRunStreamDecision({
    schemaVersion: LEGACY_TOOLS_RUN_STREAM_SCHEMA,
    kind: 'legacy-diagnostic-shim',
    diagnosticOnly: true,
    selectedToolIds: ['action.sciforge.computer-use'],
    uiState: {
      diagnosticOnly: true,
      legacyWorkspaceGatewayShim: true,
      agentServerBaseUrl: 'http://127.0.0.1:9999',
    },
  });
  assert.equal(routed.allowed, false);
  assert.match(routed.reason, /forbidden route fields/);
  assert.match(routed.reason, /selectedToolIds/);
  assert.match(routed.reason, /uiState.agentServerBaseUrl/);

  const missingMarker = legacyToolsRunStreamDecision({
    schemaVersion: LEGACY_TOOLS_RUN_STREAM_SCHEMA,
    kind: 'legacy-diagnostic-shim',
    diagnosticOnly: true,
    uiState: {
      diagnosticOnly: true,
    },
  });
  assert.equal(missingMarker.allowed, false);
  assert.match(missingMarker.reason, /legacy diagnostic markers/);
});
