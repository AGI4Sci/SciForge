import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest, WorkspaceRuntimeEvent } from '../runtime-types';
import { buildAgentServerGenerationPrompt, summarizeUiStateForAgentServer } from '../gateway/agentserver-prompts';
import { buildContextEnvelope } from '../gateway/context-envelope';
import { applyConversationPolicy, requestWithPolicyResponse } from './apply';
import { CONVERSATION_POLICY_RESPONSE_VERSION, normalizeConversationPolicyResponse, type ConversationPolicyResponse } from '@sciforge-ui/runtime-contract/conversation-policy';
import { TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION } from '@sciforge-ui/runtime-contract/turn-constraints';

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

test('applied Python conversation policy publishes structured turn constraints', () => {
  const turnExecutionConstraints = directContextTurnExecutionConstraints();
  const response = normalizeConversationPolicyResponse({
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    executionModePlan: { executionMode: 'direct-context-answer' },
    turnExecutionConstraints,
    latencyPolicy: { blockOnContextCompaction: false },
    responsePlan: { initialResponseMode: 'direct-context-answer' },
    backgroundPlan: {},
    cachePolicy: {},
  });

  assert.ok(response);
  const request = requestWithPolicyResponse(baseRequest(), response);
  const conversationPolicy = request.uiState?.conversationPolicy as ConversationPolicyResponse | undefined;
  assert.deepEqual(conversationPolicy?.turnExecutionConstraints, turnExecutionConstraints);
  assert.deepEqual(request.uiState?.turnExecutionConstraints, turnExecutionConstraints);
});

test('applied Python conversation policy preserves direct-context decision for gateway fast path', () => {
  const directContextDecision = {
    schemaVersion: 'sciforge.direct-context-decision.v1',
    decisionRef: 'decision:conversation-policy:old-ref',
    decisionOwner: 'harness-policy',
    intent: 'run-diagnostic',
    requiredTypedContext: ['run-trace', 'execution-units', 'failure-evidence'],
    usedRefs: ['execution-unit:EU-old'],
    sufficiency: 'sufficient',
    allowDirectContext: true,
  };
  const response = normalizeConversationPolicyResponse({
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    directContextDecision,
    executionModePlan: { executionMode: 'direct-context-answer' },
    turnExecutionConstraints: directContextTurnExecutionConstraints(),
    latencyPolicy: { blockOnContextCompaction: false },
    responsePlan: { initialResponseMode: 'direct-context-answer' },
    backgroundPlan: {},
    cachePolicy: {},
  });

  assert.ok(response);
  const request = requestWithPolicyResponse(baseRequest(), response);
  const conversationPolicy = request.uiState?.conversationPolicy as ConversationPolicyResponse | undefined;
  assert.deepEqual(conversationPolicy?.directContextDecision, directContextDecision);
});

test('failed Python conversation policy preserves turn execution constraints fail-closed', async () => {
  const turnExecutionConstraints = directContextTurnExecutionConstraints();
  const events: WorkspaceRuntimeEvent[] = [];
  const result = await applyConversationPolicy({
    ...baseRequest(),
    uiState: {
      ...baseRequest().uiState,
      turnExecutionConstraints,
    },
  }, {
    onEvent: (event) => events.push(event),
  }, {
    config: {
      mode: 'active',
      command: process.execPath,
      args: ['-e', 'console.error("policy boom"); process.exit(42);'],
      timeoutMs: 500,
    },
  });

  const conversationPolicy = result.request.uiState?.conversationPolicy as Record<string, unknown> | undefined;
  assert.equal(result.status, 'failed');
  assert.equal(conversationPolicy?.applicationStatus, 'failed');
  assert.deepEqual(conversationPolicy?.turnExecutionConstraints, turnExecutionConstraints);
  assert.deepEqual(result.request.uiState?.turnExecutionConstraints, turnExecutionConstraints);
  assert.equal(events[0]?.type, 'conversation-policy');
  assert.equal(events[0]?.status, 'failed');
});

test('timed out Python conversation policy preserves turn execution constraints fail-closed', async () => {
  const turnExecutionConstraints = directContextTurnExecutionConstraints();
  const result = await applyConversationPolicy({
    ...baseRequest(),
    uiState: {
      ...baseRequest().uiState,
      turnExecutionConstraints,
    },
  }, {}, {
    config: {
      mode: 'active',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000);'],
      timeoutMs: 10,
    },
  });

  const conversationPolicy = result.request.uiState?.conversationPolicy as Record<string, unknown> | undefined;
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /timed out/);
  assert.equal(conversationPolicy?.applicationStatus, 'failed');
  assert.deepEqual(conversationPolicy?.turnExecutionConstraints, turnExecutionConstraints);
  assert.deepEqual(result.request.uiState?.turnExecutionConstraints, turnExecutionConstraints);
});

test('conversation policy keeps recent execution refs out of current-turn references', async () => {
  const result = await applyConversationPolicy({
    ...baseRequest(),
    references: [{ kind: 'file', ref: 'file:current-input.md', title: 'Current input' }],
    uiState: {
      ...baseRequest().uiState,
      currentReferences: [{ kind: 'artifact', ref: 'artifact:current-report', title: 'Current report' }],
      recentExecutionRefs: [{ id: 'execution-unit:old-run', ref: 'execution-unit:old-run', status: 'done' }],
    },
  }, {}, {
    config: {
      mode: 'active',
      command: process.execPath,
      args: ['-e', `
        const fs = require('node:fs');
        const request = JSON.parse(fs.readFileSync(0, 'utf8'));
        if (JSON.stringify(request.turn.references).includes('execution-unit:old-run')) process.exit(7);
        process.stdout.write(JSON.stringify({
          schemaVersion: 'sciforge.conversation-policy.response.v1',
          currentReferences: request.turn.references,
          latencyPolicy: {},
          responsePlan: {},
          backgroundPlan: {},
          cachePolicy: {}
        }));
      `],
      timeoutMs: 500,
    },
  });

  const currentRefs = (result.request.uiState?.currentReferences as Array<Record<string, unknown>> | undefined)
    ?.map((reference) => String(reference.ref || '')) ?? [];
  assert.equal(result.status, 'applied');
  assert.deepEqual(currentRefs, ['file:current-input.md', 'artifact:current-report']);
  assert.equal(currentRefs.includes('execution-unit:old-run'), false);
});

test('conversation policy excludes optimistic current user message from prior session context', async () => {
  const result = await applyConversationPolicy({
    ...baseRequest(),
    prompt: 'Create a fresh memo.',
    uiState: {
      ...baseRequest().uiState,
      sessionMessages: [{
        id: 'msg-current',
        role: 'user',
        content: 'Create a fresh memo.',
        status: 'completed',
      }],
    },
  }, {}, {
    config: {
      mode: 'active',
      command: process.execPath,
      args: ['-e', `
        const fs = require('node:fs');
        const request = JSON.parse(fs.readFileSync(0, 'utf8'));
        if ((request.session.messages || []).length !== 0) process.exit(9);
        process.stdout.write(JSON.stringify({
          schemaVersion: 'sciforge.conversation-policy.response.v1',
          goalSnapshot: { taskRelation: 'new-task' },
          contextPolicy: { mode: 'isolate', historyReuse: { allowed: false } },
          latencyPolicy: {},
          responsePlan: {},
          backgroundPlan: {},
          cachePolicy: {}
        }));
      `],
      timeoutMs: 500,
    },
  });

  assert.equal(result.status, 'applied');
  assert.equal((result.request.uiState?.contextReusePolicy as Record<string, unknown> | undefined)?.mode, 'isolate');
});

test('conversation policy keeps real prior messages while dropping only current user turn', async () => {
  const result = await applyConversationPolicy({
    ...baseRequest(),
    prompt: 'Continue the memo.',
    uiState: {
      ...baseRequest().uiState,
      sessionMessages: [
        { id: 'msg-prior-user', role: 'user', content: 'Create a memo.', status: 'completed' },
        { id: 'msg-prior-agent', role: 'scenario', content: 'Memo created.', status: 'completed' },
        { id: 'msg-current', role: 'user', content: 'Continue the memo.', status: 'completed' },
      ],
    },
  }, {}, {
    config: {
      mode: 'active',
      command: process.execPath,
      args: ['-e', `
        const fs = require('node:fs');
        const request = JSON.parse(fs.readFileSync(0, 'utf8'));
        const ids = (request.session.messages || []).map((message) => message.id);
        if (ids.includes('msg-current')) process.exit(10);
        if (ids.length !== 2 || !ids.includes('msg-prior-user') || !ids.includes('msg-prior-agent')) process.exit(11);
        process.stdout.write(JSON.stringify({
          schemaVersion: 'sciforge.conversation-policy.response.v1',
          goalSnapshot: { taskRelation: 'continue' },
          contextPolicy: { mode: 'continue', historyReuse: { allowed: true } },
          latencyPolicy: {},
          responsePlan: {},
          backgroundPlan: {},
          cachePolicy: {}
        }));
      `],
      timeoutMs: 500,
    },
  });

  assert.equal(result.status, 'applied');
  assert.equal((result.request.uiState?.contextReusePolicy as Record<string, unknown> | undefined)?.mode, 'continue');
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
  assert.match(prompt, /"arrayFields"/);
  assert.match(prompt, /"uiManifestShape"/);
  assert.match(prompt, /forbiddenShape/);
  assert.match(prompt, /Plain paper titles/);
  assert.match(prompt, /asks not to retrieve/);
  assert.doesNotMatch(prompt, /RAW_POLICY_SHOULD_NOT_BE_COPIED/);
});

test('generation prompt compacts capability broker briefs for backend handoff', () => {
  const longText = 'CAPABILITY_DETAIL_SHOULD_BE_CLIPPED '.repeat(300);
  const capabilityBrokerBrief = {
    schemaVersion: 'sciforge.agentserver.capability-broker-brief.v1',
    source: 'test',
    contract: 'capability-contract',
    briefs: Array.from({ length: 14 }, (_, index) => ({
      id: `capability-${index}`,
      name: `Capability ${index}`,
      kind: 'tool',
      brief: longText,
      routingTags: ['literature', 'retrieval', 'download'],
      domains: ['literature'],
      providerIds: ['provider-a'],
      budget: {
        status: 'ok',
        limits: longText,
      },
    })),
  };
  const prompt = buildAgentServerGenerationPrompt({
    prompt: 'Find current papers and produce a report.',
    skillDomain: 'literature',
    contextEnvelope: {
      version: 'test',
      scenarioFacts: { capabilityBrokerBrief },
      sessionFacts: {},
    },
    workspaceTreeSummary: [],
    availableSkills: [],
    availableRuntimeCapabilities: capabilityBrokerBrief,
    artifactSchema: {},
    uiManifestContract: {},
    uiStateSummary: {},
    priorAttempts: [],
  });

  assert.match(prompt, /omittedBriefCount/);
  assert.match(prompt, /capability-5/);
  assert.doesNotMatch(prompt, /capability-6/);
  assert.ok(prompt.length < 35_000, `prompt should stay compact, got ${prompt.length}`);
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

function directContextTurnExecutionConstraints() {
  return {
    schemaVersion: TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION,
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
    reasons: [
      'current-context-only directive',
      'workspace execution forbidden by current turn',
      'AgentServer generation forbidden by current turn',
    ],
    evidence: {
      hasPriorContext: true,
      referenceCount: 1,
      artifactCount: 0,
      executionRefCount: 0,
      runCount: 0,
    },
  };
}
