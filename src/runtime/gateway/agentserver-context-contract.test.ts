import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  AGENTSERVER_BACKEND_HANDOFF_VERSION,
  AGENTSERVER_CONTEXT_REQUEST_VERSION,
  REF_SELECTION_POLICY_VERSION,
  buildAgentServerContextRequest,
  canonicalSerializeAgentServerContextRequest,
  canonicalSerializeDegradedHandoffPacket,
  validateAgentServerContextRequest,
  validateDegradedHandoffPacket,
  validateSyntheticAuditMeta,
  type AgentServerContextRequest,
  type DegradedHandoffPacket,
} from './agentserver-context-contract.js';
import type { ProjectMemoryRef } from '../project-session-memory.js';

test('AgentServerContextRequest canonical serialization is deterministic and refs-first', () => {
  const request = buildContextRequest();
  const serialized = canonicalSerializeAgentServerContextRequest(request);
  const reparsed = JSON.parse(serialized) as Record<string, unknown>;

  assert.equal(reparsed._contractVersion, AGENTSERVER_CONTEXT_REQUEST_VERSION);
  assert.deepEqual(Object.keys(reparsed), [
    '_contractVersion',
    'cachePlan',
    'contextPolicy',
    'currentTask',
    'refSelectionAudit',
    'retrievalPolicy',
    'sessionId',
    'turnId',
  ]);
  assert.doesNotMatch(serialized, /rawHistory|rawBody|\"body\"|fullRefList/);
  assert.equal(canonicalSerializeAgentServerContextRequest(JSON.parse(serialized) as AgentServerContextRequest), serialized);
});

test('AgentServerContextRequest rejects raw history, raw body, full ref list, compaction state, recent turns, and untagged selected refs', () => {
  const polluted = {
    ...buildContextRequest(),
    currentTask: {
      ...buildContextRequest().currentTask,
      selectedRefs: [{ ref: 'artifact:1', priority: 0 }],
    },
    rawHistory: [{ role: 'user', content: 'old turn' }],
    cachePlan: {
      ...buildContextRequest().cachePlan,
      perTurnPayloadRefs: [
        ...buildContextRequest().cachePlan.perTurnPayloadRefs,
        { ...ref('artifact:raw'), body: 'RAW_ARTIFACT_BODY' },
      ],
    },
    fullRefList: [ref('artifact:all-refs')],
    contextPolicy: {
      ...buildContextRequest().contextPolicy,
      compactionState: { status: 'old' },
    },
    refSelectionAudit: {
      ...buildContextRequest().refSelectionAudit,
      recentTurns: [{ role: 'assistant', content: 'old bounded turn' }],
    },
  };

  const result = validateAgentServerContextRequest(polluted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /rawHistory/);
  assert.match(result.errors.join('\n'), /body/);
  assert.match(result.errors.join('\n'), /fullRefList/);
  assert.match(result.errors.join('\n'), /compactionState/);
  assert.match(result.errors.join('\n'), /recentTurns/);
  assert.match(result.errors.join('\n'), /selectedRefs\[0\]\.source/);
});

test('DegradedHandoffPacket canonical guard forbids recent turns, full refs, raw history, raw bodies, and compaction state', () => {
  const packet = buildDegradedPacket();
  const serialized = canonicalSerializeDegradedHandoffPacket(packet);
  assert.doesNotMatch(serialized, /recentTurns|fullRefList|rawHistory|compactionState/);

  const polluted = {
    ...packet,
    recentTurns: [{ role: 'assistant', content: 'raw-ish recent context' }],
    fullRefList: [ref('artifact:everything')],
    rawHistory: ['old raw message'],
    degradedReason: {
      ...packet.degradedReason,
      compactionState: { summary: 'must stay out even when nested' },
    },
    boundedArtifactIndex: [
      ...packet.boundedArtifactIndex,
      { ref: 'artifact:raw-body', kind: 'artifact', body: 'RAW_ARTIFACT_BODY' },
    ],
  };
  const result = validateDegradedHandoffPacket(polluted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /recentTurns/);
  assert.match(result.errors.join('\n'), /fullRefList/);
  assert.match(result.errors.join('\n'), /rawHistory/);
  assert.match(result.errors.join('\n'), /body/);
  assert.match(result.errors.join('\n'), /compactionState/);
});

test('SyntheticAuditMeta must explicitly mark synthetic true', () => {
  const missingFlag = validateSyntheticAuditMeta({
    source: 'adapter',
    upstream: 'third-party-agent',
    reason: 'upstream-partial-audit',
    confidence: 'low',
    sourceRefs: [ref('projection:audit-source')],
  });
  assert.equal(missingFlag.ok, false);
  assert.match(missingFlag.errors.join('\n'), /synthetic must be explicitly true/);

  const valid = validateSyntheticAuditMeta({
    synthetic: true,
    source: 'adapter',
    upstream: 'third-party-agent',
    reason: 'upstream-partial-audit',
    confidence: 'low',
    sourceRefs: [ref('projection:audit-source')],
  });
  assert.equal(valid.ok, true);
});

test('buildAgentServerContextRequest applies drift guards and deterministic byte budgets', () => {
  const huge = { ref: 'artifact:huge-old-result', kind: 'artifact', digest: 'sha256:huge', sizeBytes: 9999 };
  const fresh = buildAgentServerContextRequest({
    sessionId: 'session-builder',
    turnId: 'turn-fresh',
    mode: 'fresh',
    currentTurnRef: ref('ledger-event:builder-fresh'),
    stableGoalRef: ref('projection:old-stable-goal'),
    explicitRefs: [],
    projectionPrimaryRefs: [huge],
    boundedContextIndexRefs: [
      { ref: 'projection:bounded-index-b', kind: 'projection', digest: 'sha256:b', sizeBytes: 120 },
      { ref: 'projection:bounded-index-a', kind: 'projection', digest: 'sha256:a', sizeBytes: 120 },
    ],
    cachePlan: {
      stablePrefixRefs: [ref('projection:old-stable-goal')],
      perTurnPayloadRefs: [ref('ledger-event:builder-fresh')],
    },
    refSelectionPolicy: {
      maxSelectedRefs: 1,
      maxSelectedRefBytes: 160,
      fallbackOrder: ['projection-primary', 'context-index'],
    },
  });

  assert.equal(fresh.refSelectionPolicy?.schemaVersion, REF_SELECTION_POLICY_VERSION);
  assert.equal(fresh.contextPolicy.includeCurrentWork, false);
  assert.deepEqual(fresh.cachePlan.stablePrefixRefs, []);
  assert.equal(fresh.currentTask.stableGoalRef, undefined);
  assert.deepEqual(fresh.currentTask.selectedRefs.map((item) => [item.ref, item.source]), [
    ['projection:bounded-index-a', 'context-index'],
  ]);
  assert.equal(fresh.refSelectionAudit.selectedRefBytes, 120);
  assert.equal(validateAgentServerContextRequest(fresh).ok, true);

  const continued = buildAgentServerContextRequest({
    sessionId: 'session-builder',
    turnId: 'turn-continue',
    mode: 'continue',
    currentTurnRef: ref('ledger-event:builder-continue'),
    stableGoalRef: ref('projection:stable-goal'),
    projectionPrimaryRefs: [
      { ref: 'projection:current-work', kind: 'projection', digest: 'sha256:work', sizeBytes: 100 },
    ],
  });
  assert.equal(continued.contextPolicy.includeCurrentWork, true);
  assert.equal(continued.cachePlan.stablePrefixRefs[0]?.ref, 'projection:stable-goal');
  assert.equal(continued.currentTask.selectedRefs[0]?.source, 'projection-primary');
});

test('buildAgentServerContextRequest retrieval-unavailable path uses deterministic fallback refs only', () => {
  const request = buildAgentServerContextRequest({
    sessionId: 'session-builder',
    turnId: 'turn-retrieval-down',
    mode: 'continue',
    currentTurnRef: ref('ledger-event:builder-retrieval-down'),
    retrievalAvailable: false,
    projectionPrimaryRefs: [
      { ref: 'projection:current-work', kind: 'projection', digest: 'sha256:work', sizeBytes: 100 },
    ],
    boundedContextIndexRefs: [
      { ref: 'projection:bounded-index', kind: 'projection', digest: 'sha256:index', sizeBytes: 100 },
    ],
    refSelectionPolicy: {
      fallbackOrder: ['projection-primary', 'context-index'],
    },
  });
  assert.deepEqual(request.retrievalPolicy.tools, []);
  assert.equal(request.retrievalPolicy.maxTailEvidenceBytes, 0);
  assert.deepEqual(request.currentTask.selectedRefs.map((item) => item.source), ['context-index']);
  assert.equal(request.refSelectionPolicy?.retrievalAvailable, false);
});

test('SA-CONF-03 golden fixtures cover context request and degraded handoff boundaries', () => {
  const requestFixtures = buildSaConf03RequestFixtures();
  const degradedFixtures = buildSaConf03DegradedFixtures();

  assert.deepEqual(Object.keys(requestFixtures), [
    'freshExplicitRefs',
    'continueNoExplicitRefs',
    'repairExplicitRefs',
    'retrievalUnavailable',
  ]);
  assert.deepEqual(Object.keys(degradedFixtures), [
    'degradedAgentServerUnavailable',
    'degradedRetrievalUnavailable',
    'degradedTokenBudgetOverrun',
  ]);

  const requestModes = new Set(Object.values(requestFixtures).map((fixture) => fixture.currentTask.mode));
  assert.deepEqual(requestModes, new Set(['fresh', 'continue', 'repair']));
  assert.ok(Object.values(requestFixtures).some((fixture) => fixture.currentTask.explicitRefs.length > 0));
  assert.ok(Object.values(requestFixtures).some((fixture) => fixture.currentTask.explicitRefs.length === 0));
  assert.ok(Object.values(requestFixtures).some((fixture) => fixture.retrievalPolicy.tools.length === 0));
  assert.ok(Object.values(requestFixtures).some((fixture) => fixture.refSelectionAudit.truncated));

  for (const [name, fixture] of Object.entries(requestFixtures)) {
    assert.equal(validateAgentServerContextRequest(fixture).ok, true, name);
    const serialized = canonicalSerializeAgentServerContextRequest(fixture);
    assert.equal(canonicalSerializeAgentServerContextRequest(JSON.parse(serialized) as AgentServerContextRequest), serialized);
    assert.doesNotMatch(serialized, /rawHistory|rawBody|\"body\"|fullRefList|recentTurns|compactionState/);
    assert.equal(sha256(serialized), SA_CONF_03_REQUEST_GOLDEN_SHA256[name as keyof typeof SA_CONF_03_REQUEST_GOLDEN_SHA256], name);
  }

  for (const [name, fixture] of Object.entries(degradedFixtures)) {
    assert.equal(validateDegradedHandoffPacket(fixture).ok, true, name);
    const serialized = canonicalSerializeDegradedHandoffPacket(fixture);
    assert.equal(canonicalSerializeDegradedHandoffPacket(JSON.parse(serialized) as DegradedHandoffPacket), serialized);
    assert.doesNotMatch(serialized, /rawHistory|rawBody|\"body\"|fullRefList|recentTurns|compactionState/);
    assert.equal(sha256(serialized), SA_CONF_03_DEGRADED_GOLDEN_SHA256[name as keyof typeof SA_CONF_03_DEGRADED_GOLDEN_SHA256], name);
  }

  const failClosedCases: Array<[string, 'request' | 'degraded', unknown]> = [
    ['raw history is forbidden anywhere in request', 'request', {
      ...requestFixtures.freshExplicitRefs,
      currentTask: { ...requestFixtures.freshExplicitRefs.currentTask, rawHistory: ['old raw turn'] },
    }],
    ['selected refs must keep an explicit source tag', 'request', {
      ...requestFixtures.continueNoExplicitRefs,
      currentTask: {
        ...requestFixtures.continueNoExplicitRefs.currentTask,
        selectedRefs: [{ ...requestFixtures.continueNoExplicitRefs.currentTask.selectedRefs[0], source: undefined }],
      },
    }],
    ['explicit-ref preference cannot be disabled', 'request', {
      ...requestFixtures.repairExplicitRefs,
      retrievalPolicy: { ...requestFixtures.repairExplicitRefs.retrievalPolicy, preferExplicitRefs: false },
    }],
    ['degraded packet cannot smuggle recent turns', 'degraded', {
      ...degradedFixtures.degradedRetrievalUnavailable,
      recentTurns: [{ role: 'user', content: 'prior raw context' }],
    }],
    ['degraded packet cannot smuggle compaction state nested in indexes', 'degraded', {
      ...degradedFixtures.degradedTokenBudgetOverrun,
      boundedFailureIndex: [
        ...degradedFixtures.degradedTokenBudgetOverrun.boundedFailureIndex,
        { ref: 'failure:raw-compaction-state', compactionState: { summary: 'forbidden' } },
      ],
    }],
  ];

  for (const [name, kind, fixture] of failClosedCases) {
    const result = kind === 'request'
      ? validateAgentServerContextRequest(fixture)
      : validateDegradedHandoffPacket(fixture);
    assert.equal(result.ok, false, name);
  }
});

function buildContextRequest(): AgentServerContextRequest {
  return {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: 'session-1',
    turnId: 'turn-1',
    cachePlan: {
      stablePrefixRefs: [ref('projection:immutable-prefix')],
      perTurnPayloadRefs: [ref('ledger-event:turn-1')],
    },
    currentTask: {
      currentTurnRef: ref('ledger-event:turn-1'),
      mode: 'fresh',
      explicitRefs: [{ ref: 'artifact:paper-1', kind: 'artifact', digest: 'sha256:paper', sizeBytes: 512 }],
      selectedRefs: [{
        ref: 'artifact:paper-1',
        kind: 'artifact',
        digest: 'sha256:paper',
        sizeBytes: 512,
        source: 'explicit',
        priority: 0,
      }],
    },
    retrievalPolicy: {
      tools: ['read_ref', 'retrieve', 'workspace_search'],
      scope: 'current-session',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 4096,
    },
    refSelectionAudit: {
      policyDigest: 'sha256:policy',
      selectedRefCount: 1,
      selectedRefBytes: 512,
      truncated: false,
      sourceCounts: {
        explicit: 1,
        projectionPrimary: 0,
        failureEvidence: 0,
        contextIndex: 0,
      },
    },
    contextPolicy: {
      mode: 'fresh',
      includeCurrentWork: false,
      includeRecentTurns: false,
      persistRunSummary: true,
      maxContextTokens: 8000,
    },
  };
}

function buildDegradedPacket(): DegradedHandoffPacket {
  return {
    _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
    degradedReason: {
      owner: 'agentserver',
      reason: 'agentserver-context-unavailable',
      recoverability: 'retryable',
    },
    currentTurnRef: ref('ledger-event:turn-1'),
    capabilityBriefRef: ref('projection:capability-brief'),
    boundedArtifactIndex: [{ ref: 'artifact:paper-1', kind: 'artifact', digest: 'sha256:paper', sizeBytes: 512 }],
    boundedFailureIndex: [],
    availableRetrievalTools: ['read_ref', 'retrieve', 'workspace_search'],
  };
}

function ref(id: string): ProjectMemoryRef {
  return {
    ref: id,
    kind: id.startsWith('ledger-event:') ? 'ledger-event' : id.startsWith('projection:') ? 'projection' : 'artifact',
    digest: `sha256:${id}`,
    sizeBytes: 128,
  };
}

const SA_CONF_03_REQUEST_GOLDEN_SHA256 = {
  freshExplicitRefs: 'd438f4fe90491b2b741cd1763c848d384a5a810a121c8f0966fbc4c58a6e6779',
  continueNoExplicitRefs: '3505aa182d8b28be6e00b6568578cc0b250d74c124282bff693d6cc244686cb1',
  repairExplicitRefs: '0568aad8b3f406eda6d1e41beab02d11573b1ed570a3da2643837a71cdbd78fc',
  retrievalUnavailable: '251e72a5b957e9cb5c7fbfbf8d923ed6cf0d5ddd44eb8c49c5b2636af2c1e396',
} as const;

const SA_CONF_03_DEGRADED_GOLDEN_SHA256 = {
  degradedAgentServerUnavailable: '36e213d5d9b0bf65e9ebb1f6db5a3491aa02c6ff6a2758134092c518ca773946',
  degradedRetrievalUnavailable: '17bf50792310c19589cf6eb9693936e50c0b17335c80d05ea7aa8c9a834a08e0',
  degradedTokenBudgetOverrun: '6a30e7ee073cc0bf5edd85eb44347bc816a38cf75c399bb9d80f2d25d2bc08d0',
} as const;

function buildSaConf03RequestFixtures(): Record<string, AgentServerContextRequest> {
  const freshExplicitRefs: AgentServerContextRequest = {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: 'sa-conf-03-session',
    turnId: 'turn-fresh',
    cachePlan: {
      stablePrefixRefs: [ref('projection:sa-conf-03-stable-goal')],
      perTurnPayloadRefs: [ref('ledger-event:sa-conf-03-fresh')],
    },
    currentTask: {
      currentTurnRef: ref('ledger-event:sa-conf-03-fresh'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      mode: 'fresh',
      explicitRefs: [{ ref: 'artifact:sa-conf-03-paper', kind: 'artifact', digest: 'sha256:paper-sa-conf-03', sizeBytes: 512 }],
      selectedRefs: [{
        ref: 'artifact:sa-conf-03-paper',
        kind: 'artifact',
        digest: 'sha256:paper-sa-conf-03',
        sizeBytes: 512,
        source: 'explicit',
        priority: 0,
      }],
      userVisibleSelectionDigest: 'sha256:visible-selection-fresh',
    },
    retrievalPolicy: {
      tools: ['read_ref', 'retrieve', 'workspace_search'],
      scope: 'current-session',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 2048,
    },
    refSelectionAudit: {
      policyDigest: 'sha256:sa-conf-03-policy-fresh',
      selectedRefCount: 1,
      selectedRefBytes: 512,
      truncated: false,
      sourceCounts: {
        explicit: 1,
        projectionPrimary: 0,
        failureEvidence: 0,
        contextIndex: 0,
      },
    },
    contextPolicy: {
      mode: 'fresh',
      includeCurrentWork: false,
      includeRecentTurns: false,
      persistRunSummary: true,
      maxContextTokens: 8000,
    },
  };

  const continueNoExplicitRefs: AgentServerContextRequest = {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: 'sa-conf-03-session',
    turnId: 'turn-continue',
    cachePlan: {
      stablePrefixRefs: [ref('projection:sa-conf-03-stable-goal')],
      perTurnPayloadRefs: [ref('ledger-event:sa-conf-03-continue')],
    },
    currentTask: {
      currentTurnRef: ref('ledger-event:sa-conf-03-continue'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      mode: 'continue',
      explicitRefs: [],
      selectedRefs: [{
        ref: 'projection:sa-conf-03-current-work',
        kind: 'projection',
        digest: 'sha256:current-work-sa-conf-03',
        sizeBytes: 256,
        source: 'projection-primary',
        priority: 0,
      }],
      userVisibleSelectionDigest: 'sha256:visible-selection-continue',
    },
    retrievalPolicy: {
      tools: ['read_ref', 'list_session_artifacts'],
      scope: 'current-session',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 1024,
    },
    refSelectionAudit: {
      policyDigest: 'sha256:sa-conf-03-policy-continue',
      selectedRefCount: 1,
      selectedRefBytes: 256,
      truncated: false,
      sourceCounts: {
        explicit: 0,
        projectionPrimary: 1,
        failureEvidence: 0,
        contextIndex: 0,
      },
    },
    contextPolicy: {
      mode: 'continue',
      includeCurrentWork: true,
      includeRecentTurns: false,
      persistRunSummary: true,
      maxContextTokens: 8000,
    },
  };

  const repairExplicitRefs: AgentServerContextRequest = {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: 'sa-conf-03-session',
    turnId: 'turn-repair',
    cachePlan: {
      stablePrefixRefs: [ref('projection:sa-conf-03-stable-goal')],
      perTurnPayloadRefs: [ref('ledger-event:sa-conf-03-repair'), ref('failure:sa-conf-03-validation')],
    },
    currentTask: {
      currentTurnRef: ref('ledger-event:sa-conf-03-repair'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      failureRef: ref('failure:sa-conf-03-validation'),
      mode: 'repair',
      explicitRefs: [{ ref: 'artifact:sa-conf-03-failing-output', kind: 'artifact', digest: 'sha256:failing-output-sa-conf-03', sizeBytes: 768 }],
      selectedRefs: [{
        ref: 'failure:sa-conf-03-validation',
        kind: 'artifact',
        digest: 'sha256:failure-sa-conf-03-validation',
        sizeBytes: 128,
        source: 'failure-evidence',
        priority: 0,
      }, {
        ref: 'artifact:sa-conf-03-failing-output',
        kind: 'artifact',
        digest: 'sha256:failing-output-sa-conf-03',
        sizeBytes: 768,
        source: 'explicit',
        priority: 1,
      }],
      userVisibleSelectionDigest: 'sha256:visible-selection-repair',
    },
    retrievalPolicy: {
      tools: ['read_ref', 'retrieve'],
      scope: 'workspace',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 3072,
    },
    refSelectionAudit: {
      policyDigest: 'sha256:sa-conf-03-policy-repair',
      selectedRefCount: 2,
      selectedRefBytes: 896,
      truncated: false,
      sourceCounts: {
        explicit: 1,
        projectionPrimary: 0,
        failureEvidence: 1,
        contextIndex: 0,
      },
    },
    contextPolicy: {
      mode: 'repair',
      includeCurrentWork: true,
      includeRecentTurns: false,
      persistRunSummary: true,
      maxContextTokens: 8000,
    },
  };

  const retrievalUnavailable: AgentServerContextRequest = {
    ...continueNoExplicitRefs,
    turnId: 'turn-retrieval-unavailable',
    cachePlan: {
      stablePrefixRefs: [ref('projection:sa-conf-03-stable-goal')],
      perTurnPayloadRefs: [ref('ledger-event:sa-conf-03-retrieval-unavailable')],
    },
    currentTask: {
      ...continueNoExplicitRefs.currentTask,
      currentTurnRef: ref('ledger-event:sa-conf-03-retrieval-unavailable'),
      selectedRefs: [{
        ref: 'projection:sa-conf-03-bounded-context-index',
        kind: 'projection',
        digest: 'sha256:bounded-context-index-sa-conf-03',
        sizeBytes: 1024,
        source: 'context-index',
        priority: 0,
      }],
      userVisibleSelectionDigest: 'sha256:visible-selection-retrieval-unavailable',
    },
    retrievalPolicy: {
      tools: [],
      scope: 'current-session',
      preferExplicitRefs: true,
      requireEvidenceForClaims: true,
      maxTailEvidenceBytes: 0,
    },
    refSelectionAudit: {
      policyDigest: 'sha256:sa-conf-03-policy-retrieval-unavailable',
      selectedRefCount: 1,
      selectedRefBytes: 1024,
      truncated: true,
      sourceCounts: {
        explicit: 0,
        projectionPrimary: 0,
        failureEvidence: 0,
        contextIndex: 1,
      },
    },
    contextPolicy: {
      ...continueNoExplicitRefs.contextPolicy,
      maxContextTokens: 1,
    },
  };

  return {
    freshExplicitRefs,
    continueNoExplicitRefs,
    repairExplicitRefs,
    retrievalUnavailable,
  };
}

function buildSaConf03DegradedFixtures(): Record<string, DegradedHandoffPacket> {
  return {
    degradedAgentServerUnavailable: {
      _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
      degradedReason: {
        owner: 'agentserver',
        reason: 'agentserver-context-unavailable',
        recoverability: 'retryable',
      },
      degradedReasonRef: ref('failure:sa-conf-03-agentserver-unavailable'),
      currentTurnRef: ref('ledger-event:sa-conf-03-degraded'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      capabilityBriefRef: ref('projection:sa-conf-03-capability-brief'),
      boundedArtifactIndex: [{ ref: 'artifact:sa-conf-03-paper', kind: 'artifact', digest: 'sha256:paper-sa-conf-03', sizeBytes: 512 }],
      boundedFailureIndex: [{ ref: 'failure:sa-conf-03-agentserver-unavailable', kind: 'failure', digest: 'sha256:failure-agentserver-unavailable', sizeBytes: 128 }],
      availableRetrievalTools: ['read_ref', 'retrieve'],
    },
    degradedRetrievalUnavailable: {
      _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
      degradedReason: {
        owner: 'runtime',
        reason: 'retrieval-unavailable',
        recoverability: 'retryable',
      },
      degradedReasonRef: ref('failure:sa-conf-03-retrieval-unavailable'),
      currentTurnRef: ref('ledger-event:sa-conf-03-retrieval-unavailable'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      capabilityBriefRef: ref('projection:sa-conf-03-capability-brief'),
      boundedArtifactIndex: [],
      boundedFailureIndex: [{ ref: 'failure:sa-conf-03-retrieval-unavailable', kind: 'failure', digest: 'sha256:failure-retrieval-unavailable', sizeBytes: 128 }],
      availableRetrievalTools: [],
    },
    degradedTokenBudgetOverrun: {
      _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
      degradedReason: {
        owner: 'runtime',
        reason: 'token-budget-overrun',
        recoverability: 'recoverable',
      },
      degradedReasonRef: ref('failure:sa-conf-03-token-budget-overrun'),
      currentTurnRef: ref('ledger-event:sa-conf-03-token-budget-overrun'),
      stableGoalRef: ref('projection:sa-conf-03-stable-goal'),
      capabilityBriefRef: ref('projection:sa-conf-03-capability-brief'),
      boundedArtifactIndex: [{ ref: 'artifact:sa-conf-03-bounded-summary', kind: 'artifact', digest: 'sha256:bounded-summary-sa-conf-03', sizeBytes: 256 }],
      boundedFailureIndex: [{ ref: 'failure:sa-conf-03-token-budget-overrun', kind: 'failure', digest: 'sha256:failure-token-budget-overrun', sizeBytes: 128 }],
      availableRetrievalTools: ['read_ref'],
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
