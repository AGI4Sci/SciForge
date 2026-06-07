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

test('normalizes configured backend LLM endpoint from root or llm blocks', () => {
  assert.deepEqual(normalizeConfiguredBackendLlmEndpoint({
    llm: {
      provider: ' openai-compatible ',
      baseUrl: ' http://127.0.0.1:4000/// ',
      apiKey: ' sk-test ',
      model: ' test-model ',
    },
  }, 'workspace-config'), {
    modelProvider: 'openai-compatible',
    modelName: 'test-model',
    llmEndpoint: {
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:4000',
      apiKey: 'sk-test',
      modelName: 'test-model',
    },
    llmEndpointSource: 'workspace-config',
  });

  assert.deepEqual(normalizeConfiguredBackendLlmEndpoint({
    baseUrl: 'http://127.0.0.1:4000',
    modelName: 'configured-model',
  }, 'config.local.json')?.llmEndpoint, {
    provider: undefined,
    baseUrl: 'http://127.0.0.1:4000',
    apiKey: undefined,
    modelName: 'configured-model',
  });

  assert.equal(normalizeConfiguredBackendLlmEndpoint({ provider: ' openai ' }, 'empty'), undefined);
});
