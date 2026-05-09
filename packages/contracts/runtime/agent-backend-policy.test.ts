import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactCapabilityForAgentBackend,
  estimateRuntimeAgentBackendModelContextWindow,
  normalizeRuntimeAgentBackendContextWindowSource,
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendProvider,
  runtimeAgentBackendProviderLabel,
  runtimeAgentBackendRateLimitRecoverActions,
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

test('runtime agent backend policy owns failure classification and recovery text', () => {
  assert.equal(runtimeAgentBackendConfigurationFailureIsBlocking('Model Provider is missing'), true);
  assert.deepEqual(runtimeAgentBackendFailureCategories('model provider returned empty completion response', undefined), ['model']);
  assert.deepEqual(runtimeAgentBackendFailureCategories('contextWindowExceeded after provider retryResult=failed', undefined), ['context-window']);
  assert.deepEqual(runtimeAgentBackendFailureCategories('429 retry-after: 2', 429), ['http-429', 'rate-limit']);
  const diagnostic = withRuntimeAgentBackendUserFacingDiagnostic({
    kind: 'rate-limit',
    categories: ['rate-limit'],
    provider: 'fixture-provider',
    message: 'rate limit exceeded',
    retryAfterMs: 2_000,
  });
  assert.match(diagnostic.userReason ?? '', /模型限流/);
  assert.ok(runtimeAgentBackendRateLimitRecoverActions(diagnostic).some((action) => /2s/.test(action)));
  const compactDetail = sanitizeRuntimeAgentBackendFailureDetail(`${'x'.repeat(380)} | compact=failed:handoff-slimming:unsupported compact | retryResult=failed`);
  assert.match(compactDetail, /handoff-slimming/);
});
