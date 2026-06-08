import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionableRuntimeStderrSummary,
  classifyRuntimeFailure,
  publicRuntimeFailureReason,
} from './runtimeFailure';

test('classifyRuntimeFailure maps provider auth failures without leaking raw detail', () => {
  assert.deepEqual(classifyRuntimeFailure('unexpected status 401 Unauthorized: Invalid token req-secret', 1), {
    failureKind: 'provider-auth',
    ownerLayer: 'provider-config',
    retryable: false,
    publicFailureReason: 'Runtime Codex provider rejected credentials (401 Unauthorized). Check SCIFORGE_RUNTIME_API_KEY and the configured Model Router member model credentials.',
  });
});

test('classifyRuntimeFailure maps retryable gateway and network failures', () => {
  assert.deepEqual(classifyRuntimeFailure('unexpected status 502 Bad Gateway from upstream', 1), {
    failureKind: 'provider-gateway',
    ownerLayer: 'provider-upstream',
    retryable: true,
    publicFailureReason: 'Runtime Codex provider gateway returned 502 Bad Gateway. Treat this as an upstream/transient provider failure and retry with preserved audit refs.',
  });
  assert.deepEqual(classifyRuntimeFailure('ENOTFOUND proxy.example.test', undefined), {
    failureKind: 'external-network',
    ownerLayer: 'external-network',
    retryable: true,
    publicFailureReason: 'Runtime Codex provider network request failed. Check network access and the configured Model Router member model endpoint.',
  });
});

test('classifyRuntimeFailure maps local runtime failures and default exits', () => {
  assert.deepEqual(classifyRuntimeFailure('spawn codex ENOENT', 127), {
    failureKind: 'runtime-tool-missing',
    ownerLayer: 'local-runtime',
    retryable: false,
    publicFailureReason: 'Runtime Codex could not start a required local tool or executable. Check the Runtime Codex installation and PATH.',
  });
  assert.equal(publicRuntimeFailureReason('plain failure', 7), 'Runtime Codex exited with code 7.');
});

test('actionableRuntimeStderrSummary extracts provider failures and ignores plugin auth noise', () => {
  assert.equal(
    actionableRuntimeStderrSummary('prefix unexpected status 403 Forbidden: no access. tail'),
    'unexpected status 403 Forbidden: no access',
  );
  assert.equal(
    actionableRuntimeStderrSummary('remote plugin sync failed for codex_core_plugins with unexpected status 401 Unauthorized from chatgpt.com/backend-api/plugins'),
    undefined,
  );
});
