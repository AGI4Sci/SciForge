import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_POLICY_REQUEST_VERSION,
  CONVERSATION_POLICY_RESPONSE_VERSION,
  SAFE_DEFAULT_BACKGROUND_PLAN,
  SAFE_DEFAULT_CACHE_POLICY,
  currentUserRequestFromPrompt,
  normalizeConversationPolicyResponse,
  type ConversationPolicyRequest,
} from './conversation-policy';

test('conversation policy contract exports stable request and response schema versions', () => {
  const request = {
    schemaVersion: CONVERSATION_POLICY_REQUEST_VERSION,
    turn: { prompt: 'Summarize current evidence.', references: [] },
    session: { messages: [], runs: [], artifacts: [], executionUnits: [] },
    workspace: {},
    capabilities: [],
    limits: { maxInlineChars: 2400 },
    tsDecisions: {},
  } satisfies ConversationPolicyRequest;

  assert.equal(request.schemaVersion, 'sciforge.conversation-policy.request.v1');
  assert.equal(CONVERSATION_POLICY_RESPONSE_VERSION, 'sciforge.conversation-policy.response.v1');
});

test('conversation policy response normalizer fails closed for missing strategy fields', () => {
  const response = normalizeConversationPolicyResponse({
    data: {
      schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
      currentReferences: [{ ref: 'artifact:paper-list' }, 'not-a-record'],
      backgroundPlan: 'invalid',
      cachePolicy: undefined,
    },
  });

  assert.ok(response);
  assert.deepEqual(response.currentReferences, [{ ref: 'artifact:paper-list' }]);
  assert.deepEqual(response.backgroundPlan, SAFE_DEFAULT_BACKGROUND_PLAN);
  assert.deepEqual(response.cachePolicy, SAFE_DEFAULT_CACHE_POLICY);
});

test('conversation policy response normalizer rejects unsupported schemas', () => {
  assert.equal(normalizeConversationPolicyResponse({ schemaVersion: 'sciforge.conversation-policy.response.v0' }), undefined);
  assert.equal(normalizeConversationPolicyResponse({}), undefined);
});

test('conversation policy extracts the current user request from labeled prompt transcripts', () => {
  assert.equal(currentUserRequestFromPrompt('system: keep context\nuser: Continue from prior refs'), 'Continue from prior refs');
  assert.equal(currentUserRequestFromPrompt('User : 重新运行失败步骤'), '重新运行失败步骤');
  assert.equal(currentUserRequestFromPrompt('plain current request'), 'plain current request');
});
