import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractBackendCurrentUserRequest,
  normalizeConfiguredBackendLlmEndpoint,
} from './backend-prompt-policy';

test('extracts current user request from the final backend handoff marker', () => {
  assert.equal(
    extractBackendCurrentUserRequest('System context\nCurrent user request: first\nCurrent user request: final task '),
    'final task',
  );
  assert.equal(extractBackendCurrentUserRequest(' direct task '), 'direct task');
});

test('rejects configured backend LLM endpoints outside Model Router member-model config', () => {
  assert.equal(normalizeConfiguredBackendLlmEndpoint({
    llm: {
      provider: ' openai-compatible ',
      baseUrl: ' http://127.0.0.1:4000/// ',
      apiKey: ' sk-test ',
      model: ' test-model ',
    },
  }, 'workspace-config'), undefined);

  assert.equal(normalizeConfiguredBackendLlmEndpoint({
    baseUrl: 'http://127.0.0.1:4000',
    modelName: 'configured-model',
  }, 'config.local.json'), undefined);

  assert.equal(normalizeConfiguredBackendLlmEndpoint({ provider: ' openai ' }, 'empty'), undefined);
});
