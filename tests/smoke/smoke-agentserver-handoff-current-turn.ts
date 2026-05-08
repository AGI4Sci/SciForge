import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
import { normalizeBackendHandoff } from '../../src/runtime/workspace-task-input.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-handoff-current-turn-'));
const currentPrompt = '检索最近一周的任何领域论文，阅读全文，并写系统总结报告';
const staleFailure = '旧任务失败：'.repeat(6000);

const generationPrompt = buildAgentServerGenerationPrompt({
  prompt: currentPrompt,
  skillDomain: 'literature',
  contextEnvelope: {
    version: 'sciforge.context-envelope.v1',
    workspaceFacts: true,
    sessionFacts: {
      currentUserRequest: currentPrompt,
      recentConversation: [`user: ${currentPrompt}`],
    },
    scenarioFacts: {
      expectedArtifactTypes: ['paper-list', 'research-report'],
      selectedComponentIds: ['paper-card-list', 'report-viewer'],
    },
    longTermRefs: {
      priorAttempts: Array.from({ length: 12 }, (_, index) => ({
        id: `old-attempt-${index}`,
        status: 'failed-with-reason',
        failureReason: staleFailure,
      })),
    },
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  availableRuntimeCapabilities: {},
  artifactSchema: { types: ['paper-list', 'research-report'] },
  uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
  uiStateSummary: {
    rawUserPrompt: currentPrompt,
    expectedArtifactTypes: ['paper-list', 'research-report'],
    selectedComponentIds: ['paper-card-list', 'report-viewer'],
  },
  artifacts: [],
  recentExecutionRefs: [],
  expectedArtifactTypes: ['paper-list', 'research-report'],
  selectedComponentIds: ['paper-card-list', 'report-viewer'],
  priorAttempts: Array.from({ length: 12 }, (_, index) => ({
    id: `old-attempt-${index}`,
    status: 'failed-with-reason',
    failureReason: staleFailure,
  })),
});

const normalized = await normalizeBackendHandoff({
  agent: { id: 'agent', name: 'Agent', backend: 'codex' },
  input: { text: generationPrompt },
}, {
  workspacePath: workspace,
  purpose: 'agentserver-generation',
  budget: {
    maxPayloadBytes: 18_000,
    maxInlineStringChars: 2500,
    maxInlineJsonBytes: 5000,
    headChars: 400,
    tailChars: 400,
    maxArrayItems: 3,
    maxObjectKeys: 20,
    maxDepth: 5,
    maxPriorAttempts: 1,
  },
});

const input = normalized.payload as { input?: { text?: unknown } };
assert.equal(typeof input.input?.text, 'string');
const text = String(input.input?.text);
assert.match(text, /CURRENT TURN SNAPSHOT/);
assert.match(text, /检索最近一周的任何领域论文/);
assert.match(text, /paper-list/);
assert.match(text, /research-report/);
assert.match(text, /AgentServerGenerationResponse|SciForge ToolPayload|outputContract/);
assert.ok(text.length < generationPrompt.length, 'handoff should still be compacted');

console.log('[ok] compact AgentServer handoff preserves current turn snapshot and output contract');
