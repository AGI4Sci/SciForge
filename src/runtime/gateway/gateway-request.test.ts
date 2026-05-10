import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGatewayRequest, normalizeLlmEndpoint } from './gateway-request';

test('gateway request delegates LLM endpoint normalization to runtime contract policy', () => {
  assert.deepEqual(normalizeLlmEndpoint({
    provider: '  openai-compatible  ',
    baseUrl: ' http://llm.example.test/v1/// ',
    apiKey: ' test-secret ',
    modelName: ' qwen-test ',
  }), {
    provider: 'openai-compatible',
    baseUrl: 'http://llm.example.test/v1',
    apiKey: 'test-secret',
    modelName: 'qwen-test',
  });

  assert.equal(normalizeLlmEndpoint({ provider: ' native ' }), undefined);
});

test('gateway request carries normalized LLM endpoint on full requests', () => {
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Summarize this report.',
    llmEndpoint: {
      provider: ' native ',
      baseUrl: ' http://native.example.test/v1/ ',
      modelName: ' native-model ',
    },
    artifacts: [],
  });

  assert.deepEqual(request.llmEndpoint, {
    provider: 'native',
    baseUrl: 'http://native.example.test/v1',
    modelName: 'native-model',
    apiKey: undefined,
  });
});

test('gateway request ignores legacy verificationPolicy request fields with audit', () => {
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Summarize this report.',
    verificationPolicy: { required: false, mode: 'none', reason: 'legacy relax' },
    uiState: {
      verificationPolicy: { required: false, mode: 'none', reason: 'legacy ui relax' },
      scenarioOverride: {
        title: 'Generated scenario',
        verificationPolicy: { required: false, mode: 'none', reason: 'legacy scenario relax' },
      },
    },
    artifacts: [],
  });

  assert.equal(request.verificationPolicy, undefined);
  assert.equal(request.uiState?.verificationPolicy, undefined);
  assert.deepEqual(request.uiState?.scenarioOverride, { title: 'Generated scenario' });
  assert.deepEqual(
    (request.uiState?.ignoredLegacyVerificationPolicySources as Array<Record<string, unknown>> | undefined)?.map((entry) => entry.source),
    [
      'request.verificationPolicy',
      'request.uiState.verificationPolicy',
      'request.uiState.scenarioOverride.verificationPolicy',
    ],
  );
});
