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

test('gateway request drops deprecated verificationPolicy request fields before runtime policy projection', () => {
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
});

test('gateway request does not derive turn constraints from prompt-only text', () => {
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: '不要重跑、不要执行、不要调用 AgentServer。只基于当前会话 refs/digest 列出证据缺口。',
    references: [{ ref: 'artifact:prior-report' }],
    artifacts: [],
  });

  assert.equal(request.uiState?.turnExecutionConstraints, undefined);
});

test('gateway request preserves versioned structured turn constraints', () => {
  const request = normalizeGatewayRequest({
    skillDomain: 'literature',
    prompt: 'Summarize current refs.',
    artifacts: [],
    turnExecutionConstraints: {
      schemaVersion: 'sciforge.turn-execution-constraints.v1',
      policyId: 'sciforge.current-turn-execution-constraints.v1',
      source: 'runtime-contract.turn-constraints',
      contextOnly: true,
      agentServerForbidden: true,
      workspaceExecutionForbidden: true,
      externalIoForbidden: true,
      codeExecutionForbidden: true,
      preferredCapabilityIds: ['runtime.direct-context-answer'],
      executionModeHint: 'direct-context-answer',
      initialResponseModeHint: 'direct-context-answer',
      reasons: ['upstream policy forbids execution'],
      evidence: {
        hasPriorContext: true,
        referenceCount: 1,
        artifactCount: 0,
        executionRefCount: 0,
        runCount: 0,
      },
    },
  });

  assert.equal((request.uiState?.turnExecutionConstraints as { agentServerForbidden?: boolean } | undefined)?.agentServerForbidden, true);
});
