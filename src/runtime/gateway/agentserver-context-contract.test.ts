import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENTSERVER_BACKEND_HANDOFF_VERSION,
  AGENTSERVER_CONTEXT_REQUEST_VERSION,
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

test('AgentServerContextRequest rejects raw history, raw body, full ref list, and untagged selected refs', () => {
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
  };

  const result = validateAgentServerContextRequest(polluted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /rawHistory/);
  assert.match(result.errors.join('\n'), /body/);
  assert.match(result.errors.join('\n'), /fullRefList/);
  assert.match(result.errors.join('\n'), /selectedRefs\[0\]\.source/);
});

test('DegradedHandoffPacket canonical guard forbids recent turns, full refs, raw history, and compaction state', () => {
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
  };
  const result = validateDegradedHandoffPacket(polluted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /recentTurns/);
  assert.match(result.errors.join('\n'), /fullRefList/);
  assert.match(result.errors.join('\n'), /rawHistory/);
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
