import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types';
import { buildAgentServerGenerationPrompt, summarizeUiStateForAgentServer } from '../gateway/agentserver-prompts';
import { buildContextEnvelope } from '../gateway/context-envelope';
import { requestWithPolicyResponse } from './apply';
import { CONVERSATION_POLICY_RESPONSE_VERSION, normalizeConversationPolicyResponse, type ConversationPolicyResponse } from '@sciforge-ui/runtime-contract/conversation-policy';

test('normalizes T098 strategy fields and request enrichment exposes stable uiState paths', () => {
  const response = normalizeConversationPolicyResponse({
    data: {
      schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
      goalSnapshot: { mode: 'continue' },
      contextPolicy: { mode: 'continue' },
      executionModePlan: { executionMode: 'thin-reproducible-adapter' },
      latencyPolicy: {
        firstVisibleResponseMs: 1200,
        firstEventWarningMs: 8000,
        silentRetryMs: 45000,
        allowBackgroundCompletion: true,
        blockOnContextCompaction: false,
        blockOnVerification: false,
        reason: 'policy-owned',
      },
      responsePlan: {
        initialResponseMode: 'quick-status',
        finalizationMode: 'append-final',
        userVisibleProgress: ['plan', 'fetch', 'emit'],
        fallbackMessagePolicy: 'truthful-partial-with-next-step',
      },
      backgroundPlan: {
        enabled: true,
        tasks: ['evidence-completion', 'verification'],
        handoffRefsRequired: true,
        cancelOnNewUserTurn: false,
      },
      cachePolicy: {
        reuseScenarioPlan: true,
        reuseSkillPlan: true,
        reuseUiPlan: true,
        reuseReferenceDigests: true,
        reuseLastSuccessfulStage: false,
      },
    },
  });

  assert.ok(response);
  const request = requestWithPolicyResponse(baseRequest(), response);

  assert.deepEqual(request.uiState?.latencyPolicy, response.latencyPolicy);
  assert.deepEqual(request.uiState?.responsePlan, response.responsePlan);
  assert.deepEqual(request.uiState?.backgroundPlan, response.backgroundPlan);
  assert.deepEqual(request.uiState?.cachePolicy, response.cachePolicy);
  assert.deepEqual((request.uiState?.conversationPolicy as ConversationPolicyResponse).latencyPolicy, response.latencyPolicy);
  assert.equal((request.uiState?.latencyPolicy as Record<string, unknown>).allowBackgroundCompletion, true);
  assert.equal((request.uiState?.responsePlan as Record<string, unknown>).initialResponseMode, 'quick-status');
});

test('missing T098 strategy fields fail closed without declaring background completion or cache reuse', () => {
  const response = normalizeConversationPolicyResponse({
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    executionModePlan: { executionMode: 'direct-context-answer' },
  });

  assert.ok(response);
  assert.equal(response.latencyPolicy!.blockOnVerification, true);
  assert.equal(response.latencyPolicy!.blockOnContextCompaction, true);
  assert.equal(response.latencyPolicy!.allowBackgroundCompletion, false);
  assert.equal(response.responsePlan!.initialResponseMode, 'wait-for-result');
  assert.equal(response.backgroundPlan!.enabled, false);
  assert.deepEqual(response.backgroundPlan!.tasks, []);
  assert.equal(response.cachePolicy!.reuseScenarioPlan, false);
  assert.equal(response.cachePolicy!.reuseBackendSession, false);

  const request = requestWithPolicyResponse(baseRequest(), response);
  assert.equal((request.uiState?.backgroundPlan as Record<string, unknown>).enabled, false);
});

test('context envelope and AgentServer prompt carry only clipped policy summaries', () => {
  const longRaw = 'RAW_POLICY_SHOULD_NOT_BE_COPIED '.repeat(40);
  const response = normalizeConversationPolicyResponse({
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    latencyPolicy: {
      firstVisibleResponseMs: 3000,
      firstEventWarningMs: 12000,
      silentRetryMs: 45000,
      allowBackgroundCompletion: true,
      blockOnContextCompaction: false,
      blockOnVerification: false,
      reason: 'short reason',
      rawTrace: longRaw,
    },
    responsePlan: {
      initialResponseMode: 'streaming-draft',
      finalizationMode: 'replace-draft',
      userVisibleProgress: ['plan', 'search', 'fetch', 'validate', 'emit', 'extra-1', 'extra-2', 'extra-3', 'extra-4'],
      fallbackMessagePolicy: 'truthful-partial-with-next-step',
      rawTrace: longRaw,
    },
    backgroundPlan: {
      enabled: true,
      tasks: ['verification'],
      handoffRefsRequired: true,
      cancelOnNewUserTurn: false,
      rawTrace: longRaw,
    },
    cachePolicy: {
      reuseScenarioPlan: true,
      reuseSkillPlan: false,
      reuseUiPlan: true,
      reuseReferenceDigests: true,
      rawTrace: longRaw,
    },
  });
  assert.ok(response);
  const request = requestWithPolicyResponse(baseRequest(), response);
  const envelope = buildContextEnvelope(request, { workspace: '/tmp/sciforge-policy-test' });
  const envelopeJson = JSON.stringify(envelope);

  assert.match(envelopeJson, /conversationPolicySummary/);
  assert.match(envelopeJson, /firstVisibleResponseMs/);
  assert.doesNotMatch(envelopeJson, /RAW_POLICY_SHOULD_NOT_BE_COPIED/);

  const prompt = buildAgentServerGenerationPrompt({
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    contextEnvelope: envelope,
    workspaceTreeSummary: [],
    availableSkills: [],
    artifactSchema: {},
    uiManifestContract: {},
    uiStateSummary: summarizeUiStateForAgentServer(request.uiState, 'full'),
    priorAttempts: [],
  });
  assert.match(prompt, /conversationPolicySummary/);
  assert.doesNotMatch(prompt, /RAW_POLICY_SHOULD_NOT_BE_COPIED/);
});

function baseRequest(): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'Summarize the current evidence.',
    artifacts: [],
    uiState: {
      sessionId: 'session-1',
      recentConversation: ['user: continue'],
    },
  };
}
