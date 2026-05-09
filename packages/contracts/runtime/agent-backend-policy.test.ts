import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactCapabilityForAgentBackend,
  estimateRuntimeAgentBackendModelContextWindow,
  normalizeRuntimeAgentBackendContextWindowSource,
  normalizeRuntimeLlmEndpoint,
  normalizeRuntimeWorkspaceCompactCapability,
  normalizeRuntimeWorkspaceContextWindowSource,
  runtimeCapabilityEvolutionFailureCode,
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendConfigurationNextStep,
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendConfigurationRecoverActions,
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendFailureIsContextWindowExceeded,
  runtimeAgentBackendProvider,
  runtimeAgentBackendProviderLabel,
  runtimeAgentBackendProviderFailureMessage,
  runtimeAgentBackendRateLimitRecoverActions,
  runtimeAgentBackendRecoverActions,
  runtimeAgentBackendSanitizedFailureUserReason,
  runtimeAgentBackendSupported,
  sanitizeRuntimeAgentBackendFailureDetail,
  withRuntimeAgentBackendUserFacingDiagnostic,
} from './agent-backend-policy';

test('runtime agent backend policy owns provider and capability normalization', () => {
  assert.equal(runtimeAgentBackendSupported('codex'), true);
  assert.equal(runtimeAgentBackendSupported('unknown-backend'), false);
  assert.equal(runtimeAgentBackendProvider('openteam_agent'), 'self-hosted');
  assert.equal(runtimeAgentBackendProviderLabel('claude-code'), 'Anthropic');
  assert.equal(runtimeAgentBackendCapabilities('gemini').sessionRotationSafe, true);
  assert.equal(runtimeAgentBackendCapabilities('openclaw').nativeCompaction, false);
  assert.equal(compactCapabilityForAgentBackend('gemini'), 'session-rotate');
  assert.equal(compactCapabilityForAgentBackend('codex'), 'native');
});

test('runtime agent backend policy owns context source and model window normalization', () => {
  assert.equal(normalizeRuntimeAgentBackendContextWindowSource({
    value: 'usage',
    backend: 'codex',
    capabilities: { nativeCompaction: true },
    hasContextWindowTelemetry: false,
    hasUsage: true,
  }), 'provider-usage');
  assert.equal(normalizeRuntimeAgentBackendContextWindowSource({
    backend: 'hermes-agent',
    capabilities: { nativeCompaction: true },
    hasContextWindowTelemetry: true,
    hasUsage: false,
  }), 'native');
  assert.equal(estimateRuntimeAgentBackendModelContextWindow('gpt-5'), 200_000);
  assert.equal(estimateRuntimeAgentBackendModelContextWindow('gemini-2.0-pro'), 1_000_000);
});

test('runtime agent backend policy owns LLM endpoint normalization', () => {
  assert.deepEqual(normalizeRuntimeLlmEndpoint({
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
  assert.equal(normalizeRuntimeLlmEndpoint({ provider: ' native ' }), undefined);
  assert.equal(normalizeRuntimeLlmEndpoint(null), undefined);
});

test('runtime agent backend policy owns workspace event context source aliases', () => {
  assert.equal(normalizeRuntimeWorkspaceContextWindowSource({
    value: 'provider',
    hasUsage: true,
  }), 'provider-usage');
  assert.equal(normalizeRuntimeWorkspaceContextWindowSource({
    value: 'handoff',
  }), 'agentserver-estimate');
  assert.equal(normalizeRuntimeWorkspaceContextWindowSource({
    backend: 'codex',
    capabilities: { nativeCompaction: true },
    hasContextWindowTelemetry: true,
  }), 'native');
  assert.equal(normalizeRuntimeWorkspaceContextWindowSource({
    hasUsage: true,
  }), 'provider-usage');
  assert.equal(normalizeRuntimeWorkspaceCompactCapability('handoff-only'), 'handoff-slimming');
  assert.equal(normalizeRuntimeWorkspaceCompactCapability(compactCapabilityForAgentBackend('gemini')), 'session-rotate');
});

test('runtime agent backend policy owns failure classification and recovery text', () => {
  assert.equal(runtimeAgentBackendConfigurationFailureIsBlocking('Model Provider is missing'), true);
  assert.ok(runtimeAgentBackendConfigurationRecoverActions('Model Provider is missing')?.some((action) => /Model Base URL/.test(action)));
  assert.match(runtimeAgentBackendConfigurationNextStep('llmEndpoint missing') ?? '', /user-side model endpoint/);
  assert.deepEqual(runtimeAgentBackendFailureCategories('model provider returned empty completion response', undefined), ['model']);
  assert.deepEqual(runtimeAgentBackendFailureCategories('contextWindowExceeded after provider retryResult=failed', undefined), ['context-window']);
  assert.deepEqual(runtimeAgentBackendFailureCategories('maximum context length reached because input is too long and tokens exceeded', undefined), ['context-window']);
  assert.equal(runtimeAgentBackendFailureIsContextWindowExceeded('token limit exceeded while building the final request'), true);
  assert.equal(runtimeAgentBackendFailureIsContextWindowExceeded('429 too many requests; not a context window failure'), false);
  const contextDiagnostic = withRuntimeAgentBackendUserFacingDiagnostic({
    kind: 'context-window',
    categories: ['context-window'],
    message: 'maximum context length reached',
  });
  assert.match(runtimeAgentBackendSanitizedFailureUserReason(contextDiagnostic), /context window\/token limit/);
  assert.ok(runtimeAgentBackendRecoverActions(contextDiagnostic).some((action) => /currentReferenceDigests/.test(action)));
  assert.deepEqual(runtimeAgentBackendFailureCategories('429 retry-after: 2', 429), ['http-429', 'rate-limit']);
  assert.equal(runtimeCapabilityEvolutionFailureCode({
    failureReason: 'AgentServer request failed: ECONNREFUSED at configured Model Base URL',
  }), 'provider-unavailable');
  assert.equal(runtimeCapabilityEvolutionFailureCode({
    failureReason: 'HTTP 429 rate limit from provider',
  }), 'provider-unavailable');
  assert.equal(runtimeCapabilityEvolutionFailureCode({
    schemaErrors: ['payload missing artifacts'],
    failureReason: 'provider returned schema-invalid payload',
  }), 'schema-invalid');
  const diagnostic = withRuntimeAgentBackendUserFacingDiagnostic({
    kind: 'rate-limit',
    categories: ['rate-limit'],
    provider: 'fixture-provider',
    message: 'rate limit exceeded',
    retryAfterMs: 2_000,
  });
  assert.match(diagnostic.userReason ?? '', /模型限流/);
  assert.ok(runtimeAgentBackendRateLimitRecoverActions(diagnostic).some((action) => /2s/.test(action)));
  assert.match(runtimeAgentBackendProviderFailureMessage(diagnostic, true), /will not retry again automatically/);
  const compactDetail = sanitizeRuntimeAgentBackendFailureDetail(`${'x'.repeat(380)} | compact=failed:handoff-slimming:unsupported compact | retryResult=failed`);
  assert.match(compactDetail, /handoff-slimming/);
});
