import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnosticForFailure } from './backend-failure-diagnostics';

test('diagnostic schema maps network failures to user-visible recovery', () => {
  const diagnostic = diagnosticForFailure('fetch failed: ECONNREFUSED 127.0.0.1:8787', {
    evidenceRefs: ['trace:network-1'],
  });

  assert.equal(diagnostic.kind, 'network');
  assert.match(diagnostic.userReason ?? '', /网络|连接/);
  assert.ok(diagnostic.recoverActions?.some((action) => /可达|重试|服务/.test(action)));
  assert.deepEqual(diagnostic.evidenceRefs, ['trace:network-1']);
});

test('diagnostic schema maps model/provider failures without backend-specific text patches', () => {
  const diagnostic = diagnosticForFailure('model provider returned empty completion response and marked generation failed', {
    provider: 'generic-provider',
    model: 'generic-model',
  });

  assert.equal(diagnostic.kind, 'model');
  assert.match(diagnostic.userReason ?? '', /模型|提供方/);
  assert.ok(diagnostic.nextStep);
});

test('diagnostic schema maps tool execution failures with log evidence refs', () => {
  const diagnostic = diagnosticForFailure('command exited with exit code 127; stderr says module not found', {
    evidenceRefs: ['file:.sciforge/logs/run.err', 'file:.sciforge/task-results/run.json'],
  });

  assert.equal(diagnostic.kind, 'tool');
  assert.ok(diagnostic.recoverActions?.some((action) => /stdoutRef|stderrRef|日志|依赖/.test(action)));
  assert.deepEqual(diagnostic.evidenceRefs, ['file:.sciforge/logs/run.err', 'file:.sciforge/task-results/run.json']);
});

test('diagnostic schema maps acceptance failures to repair-first recovery', () => {
  const diagnostic = diagnosticForFailure('acceptance gate failed because required artifact refs are missing', {
    evidenceRefs: ['execution-unit:acceptance-1'],
  });

  assert.equal(diagnostic.kind, 'missing-input');
  assert.ok(diagnostic.categories.includes('acceptance'));
  assert.ok(diagnostic.recoverActions?.some((action) => /acceptance|验收|repair/.test(action)));
  assert.deepEqual(diagnostic.evidenceRefs, ['execution-unit:acceptance-1']);
});
