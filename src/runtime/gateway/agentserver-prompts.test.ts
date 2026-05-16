import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentServerGenerationPrompt } from './agentserver-prompts.js';
import { AGENTSERVER_BACKEND_HANDOFF_VERSION, type BackendHandoffPacket } from './agentserver-context-contract.js';
import type { ProjectMemoryRef } from '../project-session-memory.js';

test('AgentServer generation prompt projects core snapshot as turn refs without recentTurns or raw bodies', () => {
  const prompt = buildAgentServerGenerationPrompt({
    prompt: 'Continue from the supplied refs.',
    skillDomain: 'literature',
    contextEnvelope: {
      agentServerCoreSnapshot: {
        source: 'AgentServer Core /context',
        session: { id: 'session-1', status: 'active' },
        recentTurnRefs: [{
          turnNumber: 3,
          role: 'assistant',
          runId: 'run-3',
          contentRef: '.sciforge/refs/turn-3.md',
          contentDigest: 'sha1:turn-3',
          contentChars: 2048,
          contentOmitted: true,
        }],
        recentTurns: [{
          role: 'assistant',
          content: 'RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK',
        }],
        currentWork: {
          entryCount: 1,
          rawTurnCount: 1,
          compactionTags: [{
            kind: 'compaction',
            id: 'compact-1',
            summary: ['RAW_COMPACTION_SUMMARY_SHOULD_NOT_LEAK'],
          }],
        },
      },
    },
    workspaceTreeSummary: [],
    availableSkills: [],
    artifactSchema: {},
    uiManifestContract: {},
    priorAttempts: [],
  });

  assert.match(prompt, /recentTurnRefs/);
  assert.match(prompt, /\.sciforge\/refs\/turn-3\.md/);
  assert.match(prompt, /sha1:turn-3/);
  assert.doesNotMatch(prompt, /recentTurns|RAW_AGENTSERVER_TURN_BODY_SHOULD_NOT_LEAK|RAW_COMPACTION_SUMMARY_SHOULD_NOT_LEAK/);
});

test('AgentServer generation prompt renderer consumes BackendHandoffPacket and bounded render plan only', () => {
  const backendHandoffPacket: BackendHandoffPacket = {
    _contractVersion: AGENTSERVER_BACKEND_HANDOFF_VERSION,
    sessionId: 'session-1',
    turnId: 'turn-1',
    currentTurnRef: ref('message:turn-1', 'task-input'),
    contextRefs: [ref('artifact:selected-report', 'artifact')],
    retrievalTools: ['read_ref'],
    contextSnapshotRef: ref('projection:context-snapshot', 'context'),
  };
  const prompt = buildAgentServerGenerationPrompt({
    prompt: 'Use the supplied backend handoff refs.',
    skillDomain: 'literature',
    backendHandoffPacket,
    boundedRenderPlan: {
      schemaVersion: 'sciforge.agentserver.prompt-render-plan.v1',
      renderMode: 'bounded',
      deterministic: true,
      renderDigest: 'sha256:bounded-render',
      sourceRefs: { handoffPacketRef: 'ref:handoff-packet' },
      renderedEntries: [{
        id: 'policy:current-turn',
        sourceCallbackId: 'agentserver-current-turn',
        text: 'BOUNDED_RENDER_ENTRY',
      }],
      renderedText: 'RAW_RENDERED_TEXT_SHOULD_NOT_LEAK',
    },
    contextEnvelope: {
      promptRenderPlan: {
        renderDigest: 'sha256:legacy-raw',
        renderedText: 'LEGACY_CONTEXT_ENVELOPE_RENDERED_TEXT_SHOULD_NOT_LEAK',
      },
      sessionFacts: {
        promptRenderPlan: {
          renderDigest: 'sha256:legacy-session',
          renderedText: 'LEGACY_SESSION_RENDERED_TEXT_SHOULD_NOT_LEAK',
        },
      },
    },
    workspaceTreeSummary: [],
    availableSkills: [],
    artifactSchema: {},
    uiManifestContract: {},
    priorAttempts: [],
  });

  assert.match(prompt, /BackendHandoffPacket/);
  assert.match(prompt, /message:turn-1/);
  assert.match(prompt, /artifact:selected-report/);
  assert.match(prompt, /sha256:bounded-render/);
  assert.match(prompt, /BOUNDED_RENDER_ENTRY/);
  assert.doesNotMatch(prompt, /RAW_RENDERED_TEXT_SHOULD_NOT_LEAK|LEGACY_CONTEXT_ENVELOPE_RENDERED_TEXT_SHOULD_NOT_LEAK|LEGACY_SESSION_RENDERED_TEXT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(prompt, /"promptRenderPlan":/);
});

function ref(id: string, kind: ProjectMemoryRef['kind']): ProjectMemoryRef {
  return {
    ref: id,
    kind,
    digest: `sha256:${id}`,
    sizeBytes: 128,
  };
}
