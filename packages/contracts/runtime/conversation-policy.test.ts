import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_POLICY_REQUEST_VERSION,
  CONVERSATION_POLICY_RESPONSE_VERSION,
  SAFE_DEFAULT_BACKGROUND_PLAN,
  SAFE_DEFAULT_CACHE_POLICY,
  currentUserRequestFromPrompt,
  normalizeConversationPolicyResponse,
  selectedConversationPolicyCapabilityManifests,
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
      directContextDecision: {
        schemaVersion: 'sciforge.direct-context-decision.v1',
        decisionRef: 'decision:policy:refs',
        decisionOwner: 'harness-policy',
        intent: 'artifact-status',
        requiredTypedContext: ['current-refs'],
        usedRefs: ['artifact:paper-list'],
        sufficiency: 'sufficient',
        allowDirectContext: true,
      },
      turnExecutionConstraints: {
        schemaVersion: 'sciforge.turn-execution-constraints.v1',
        contextOnly: true,
        agentServerForbidden: true,
      },
      backgroundPlan: 'invalid',
      cachePolicy: undefined,
    },
  });

  assert.ok(response);
  assert.deepEqual(response.currentReferences, [{ ref: 'artifact:paper-list' }]);
  assert.equal(response.directContextDecision?.decisionRef, 'decision:policy:refs');
  assert.equal(response.turnExecutionConstraints?.agentServerForbidden, true);
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

test('conversation policy owns selected capability manifest projection', () => {
  const manifests = selectedConversationPolicyCapabilityManifests({
    skillDomain: 'literature',
    selectedToolIds: ['tool.search', 'tool.search'],
    selectedSenseIds: ['vision-sense'],
    selectedVerifierIds: ['citation-verifier'],
    selectedComponentIds: ['paper-table'],
    expectedArtifactTypes: ['paper-list'],
  });

  assert.deepEqual(manifests.map((item) => item.id), [
    'tool.search',
    'vision-sense',
    'citation-verifier',
    'paper-table',
    'scenario.literature.agentserver-generation',
  ]);
  assert.equal(manifests[1].internalAgent, 'optional');
  assert.deepEqual(manifests[4].artifacts, ['paper-list']);
});

test('conversation policy capability projection can omit AgentServer generation', () => {
  const manifests = selectedConversationPolicyCapabilityManifests({
    skillDomain: 'literature',
    selectedToolIds: ['runtime.direct-context-answer'],
    allowAgentServerGeneration: false,
  });

  assert.deepEqual(manifests.map((item) => item.id), ['runtime.direct-context-answer']);
  assert.equal(manifests.some((item) => String(item.id).includes('agentserver-generation')), false);
});
