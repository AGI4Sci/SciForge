import assert from 'node:assert/strict';

import {
  configureDirectAnswerArtifactContext,
  mergeReusableContextArtifactsForDirectPayload,
} from '../../src/runtime/gateway/direct-answer-payload.js';
import { requestWithPolicyResponse } from '../../src/runtime/conversation-policy/apply.js';
import type { ConversationPolicyResponse } from '@sciforge-ui/runtime-contract/conversation-policy';
import type { GatewayRequest, ToolPayload } from '../../src/runtime/runtime-types.js';

const baseRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'locate prior outputs',
  workspacePath: '/tmp/sciforge-policy-smoke',
  expectedArtifactTypes: ['paper-list', 'research-report'],
  artifacts: [{
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/report.md',
  }],
  uiState: {
    sessionId: 'session-followup',
    recentConversation: ['user: generate report', 'assistant: report and chart refs are ready'],
    recentExecutionRefs: [{ id: 'unit-1', outputRef: '.sciforge/task-results/round-one.json' }],
  },
};

const policyResponse: ConversationPolicyResponse = {
  schemaVersion: 'sciforge.conversation-policy.response.v1',
  contextPolicy: {
    schemaVersion: 'sciforge.conversation.context-policy.v1',
    mode: 'continue',
    historyReuse: { allowed: true, scope: 'same-task-recent-turns' },
    referencePriority: { explicitReferences: [], historyFallbackAllowed: true },
    pollutionGuard: { dropStaleHistory: false },
  },
  contextProjection: {
    selectedMessageRefs: [{ id: 'm1', role: 'assistant', refs: ['artifact:research-report'] }],
    selectedRunRefs: [{ id: 'run-1', status: 'completed', refs: ['file:.sciforge/task-results/round-one.json'] }],
    conversationLedger: [],
  },
  currentReferences: [{
    kind: 'file',
    ref: '.sciforge/artifacts/report.md',
    title: 'report.md',
    source: 'python-policy',
  }],
  artifactIndex: {
    schemaVersion: 'sciforge.artifact-index.v1',
    entries: [{
      id: 'research-report',
      kind: 'artifact',
      ref: '.sciforge/artifacts/report.md',
      clickableRef: 'file:.sciforge/artifacts/report.md',
    }],
  },
};

const enriched = requestWithPolicyResponse(baseRequest, policyResponse);
const enrichedUiState = enriched.uiState as {
  contextReusePolicy?: { mode?: string };
  currentReferences?: Array<{ ref?: string }>;
  artifactIndex?: { schemaVersion?: string };
};
assert.equal(enrichedUiState.contextReusePolicy?.mode, 'continue');
assert.equal(enrichedUiState.currentReferences?.[0]?.ref, '.sciforge/artifacts/report.md');
assert.equal(enrichedUiState.artifactIndex?.schemaVersion, 'sciforge.artifact-index.v1');

configureDirectAnswerArtifactContext(async () => ({
  combinedArtifacts: [{
    id: 'paper-list',
    type: 'paper-list',
    producerScenario: 'literature',
    schemaVersion: '1',
    dataRef: '.sciforge/artifacts/papers.json',
  }],
}));

const directPayload: ToolPayload = {
  message: 'Prior context answer with a report only.',
  confidence: 0.9,
  claimType: 'context-summary',
  evidenceLevel: 'agentserver-direct',
  reasoningTrace: 'Structured direct answer.',
  claims: [],
  uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
  executionUnits: [],
  artifacts: [{
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature',
    schemaVersion: '1',
    data: { markdown: 'Existing report summary' },
  }],
};

const merged = await mergeReusableContextArtifactsForDirectPayload(directPayload, enriched);
assert.ok(merged.artifacts.some((artifact) => artifact.type === 'paper-list'));

const isolated = await mergeReusableContextArtifactsForDirectPayload(directPayload, {
  ...baseRequest,
  uiState: {
    ...baseRequest.uiState,
    contextReusePolicy: {
      mode: 'isolate',
      historyReuse: { allowed: false },
    },
  },
});
assert.equal(isolated.artifacts.some((artifact) => artifact.type === 'paper-list'), false);

console.log('[ok] multi-turn follow-up decisions rely on conversation policy and structured refs');
