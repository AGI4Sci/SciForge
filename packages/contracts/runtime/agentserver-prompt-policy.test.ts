import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAgentServerCurrentUserRequest,
  normalizeConfiguredAgentServerLlmEndpoint,
} from './agentserver-prompt-policy';

test('extracts current user request from the final AgentServer handoff marker', () => {
  assert.equal(
    extractAgentServerCurrentUserRequest('System context\nCurrent user request: first\nCurrent user request: final task '),
    'final task',
  );
  assert.equal(extractAgentServerCurrentUserRequest(' direct task '), 'direct task');
});

test('normalizes configured AgentServer LLM endpoint from root or llm blocks', () => {
  assert.deepEqual(normalizeConfiguredAgentServerLlmEndpoint({
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

  assert.deepEqual(normalizeConfiguredAgentServerLlmEndpoint({
    baseUrl: 'http://127.0.0.1:4000',
    modelName: 'configured-model',
  }, 'config.local.json')?.llmEndpoint, {
    provider: undefined,
    baseUrl: 'http://127.0.0.1:4000',
    apiKey: undefined,
    modelName: 'configured-model',
  });

  assert.equal(normalizeConfiguredAgentServerLlmEndpoint({ provider: ' openai ' }, 'empty'), undefined);
});
