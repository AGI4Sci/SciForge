import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionSideEffectsHaveHighRiskSignal,
  explicitIntentConstraintsForText,
  intentTextHasHighRiskSignal,
  requestedActionTypeForIntentText,
  verifyRouteModeForIntentText,
} from './intent-first-verification-policy';

test('intent-first policy does not infer constraints from prompt prose', () => {
  assert.deepEqual(explicitIntentConstraintsForText('只给建议，不需要改代码，后台验证即可。'), []);
  assert.deepEqual(explicitIntentConstraintsForText('work offline and wait for verify'), []);
});

test('intent-first policy leaves prompt prose as answer unless structure provides action type', () => {
  assert.equal(requestedActionTypeForIntentText('给我一个建议和最终版本'), 'answer');
  assert.equal(requestedActionTypeForIntentText('实现代码并跑 typecheck'), 'answer');
  assert.equal(requestedActionTypeForIntentText('分析 csv 数据'), 'answer');
  assert.equal(requestedActionTypeForIntentText('push 到 github'), 'answer');
  assert.equal(requestedActionTypeForIntentText('hello'), 'answer');
  assert.equal(requestedActionTypeForIntentText(''), 'unknown');
});

test('intent-first policy does not route verification from prompt prose', () => {
  assert.equal(verifyRouteModeForIntentText('skip verify and show draft'), undefined);
  assert.equal(verifyRouteModeForIntentText('run release verify for merge'), undefined);
  assert.equal(verifyRouteModeForIntentText('git push after npm run verify:full', {
    releaseGatePolicy: {
      requiredCommand: 'npm run verify:full',
      syncActionSignals: ['git push'],
    },
  }), undefined);
  assert.equal(verifyRouteModeForIntentText('后台验证即可'), undefined);
  assert.equal(verifyRouteModeForIntentText('等验证完成后再说'), undefined);
  assert.equal(verifyRouteModeForIntentText('deep verify this result'), undefined);
});

test('intent-first policy recognizes high-risk only from structured side effects', () => {
  assert.equal(intentTextHasHighRiskSignal('dangerous production migration'), false);
  assert.equal(intentTextHasHighRiskSignal('plain summary'), false);
  assert.equal(actionSideEffectsHaveHighRiskSignal(['external-write']), true);
  assert.equal(actionSideEffectsHaveHighRiskSignal([{ kind: 'publish' }]), true);
  assert.equal(actionSideEffectsHaveHighRiskSignal(['read local notes']), false);
});
