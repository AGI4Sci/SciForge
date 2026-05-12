import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionSideEffectsHaveHighRiskSignal,
  explicitIntentConstraintsForText,
  intentTextHasHighRiskSignal,
  requestedActionTypeForIntentText,
  verifyRouteModeForIntentText,
} from './intent-first-verification-policy';

test('intent-first policy extracts lightweight user intent constraints', () => {
  assert.deepEqual(
    explicitIntentConstraintsForText('只给建议，不需要改代码，后台验证即可。'),
    ['negative-or-skip-instruction', 'scope-limiting-instruction', 'background-request'],
  );
  assert.deepEqual(
    explicitIntentConstraintsForText('work offline and wait for verify'),
    ['wait-request', 'network-restriction'],
  );
});

test('intent-first policy classifies requested action types', () => {
  assert.equal(requestedActionTypeForIntentText('给我一个建议和最终版本'), 'advice');
  assert.equal(requestedActionTypeForIntentText('实现代码并跑 typecheck'), 'code-change');
  assert.equal(requestedActionTypeForIntentText('分析 csv 数据'), 'data-analysis');
  assert.equal(requestedActionTypeForIntentText('push 到 github'), 'external-action');
  assert.equal(requestedActionTypeForIntentText('hello'), 'answer');
});

test('intent-first policy routes verify without forcing work checks inline', () => {
  assert.equal(verifyRouteModeForIntentText('skip verify and show draft'), 'skip');
  assert.equal(verifyRouteModeForIntentText('run release verify before merge'), 'release');
  assert.equal(verifyRouteModeForIntentText('后台验证即可'), 'background');
  assert.equal(verifyRouteModeForIntentText('等验证完成后再说'), 'wait');
  assert.equal(verifyRouteModeForIntentText('deep verify this result'), 'careful');
});

test('intent-first policy recognizes high-risk text and side effects', () => {
  assert.equal(intentTextHasHighRiskSignal('dangerous production migration'), true);
  assert.equal(intentTextHasHighRiskSignal('plain summary'), false);
  assert.equal(actionSideEffectsHaveHighRiskSignal(['publish external update']), true);
  assert.equal(actionSideEffectsHaveHighRiskSignal(['read local notes']), false);
});
