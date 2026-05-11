import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { harnessModules } from '../../packages/agent-harness/src/modules.js';
import { buildAgentHarnessPromptRenderPlan } from '../../src/runtime/gateway/agent-harness-shadow.js';
import { buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';

const guide = await readFile('docs/HarnessResearchGuide.md', 'utf8');

for (const required of [
  'packages/agent-harness/src/contracts.ts',
  'packages/agent-harness/src/profiles.ts',
  'packages/agent-harness/src/runtime.ts',
  'packages/agent-harness/src/modules.ts',
  'src/runtime/gateway/agent-harness-shadow.ts',
  'buildAgentHarnessPromptRenderPlan',
  'src/runtime/gateway/agentserver-prompts.ts',
]) {
  assert.ok(guide.includes(required), `HarnessResearchGuide should mention ${required}`);
}

for (const forbiddenStrategy of ['fresh', 'continuity', 'tool-use', 'repair', 'latency']) {
  assert.match(
    guide,
    new RegExp(`${forbiddenStrategy}[\\s\\S]{0,220}(?:不能|cannot|prompt builder|AgentServer prompt)`, 'i'),
    `guide should explain that ${forbiddenStrategy} policy does not belong in AgentServer prompt prose`,
  );
}

const moduleStack = Object.keys(harnessModules);
const renderPlan = buildAgentHarnessPromptRenderPlan({
  contract: {
    schemaVersion: 'sciforge.agent-harness-contract.v1',
    profileId: 'balanced-default',
    moduleStack,
    intentMode: 'fresh',
    explorationMode: 'minimal',
    allowedContextRefs: ['artifact:current'],
    requiredContextRefs: ['artifact:current'],
    blockedContextRefs: ['artifact:stale'],
    repairContextPolicy: { kind: 'none', maxAttempts: 0 },
    promptDirectives: [{
      id: 'latency-first-answer',
      sourceCallbackId: 'latency.deadline',
      priority: 100,
      text: 'latencyTier=quick; firstResultDeadlineMs=15000; backgroundAfterMs=45000',
    }],
  },
  trace: {
    auditNotes: [{
      sourceCallbackId: 'harness-runtime.profile-selection',
      severity: 'info',
      message: `profile=balanced-default; latencyTier=quick; moduleStack=${moduleStack.join(',')}; deeper profiles were not selected by default`,
    }],
  },
  summary: {
    contractRef: 'runtime://agent-harness/contracts/research-guide-smoke',
    traceRef: 'runtime://agent-harness/contracts/research-guide-smoke/trace',
  },
});

const plan = record(renderPlan);
const previews = list(plan.moduleDirectivePreviews).map(record);
assert.deepEqual(
  previews.map((preview) => preview.id),
  moduleStack.map((moduleId) => `module-preview.${moduleId}`),
  'prompt render plan should expose one bounded module preview per harness module',
);
for (const preview of previews) {
  assert.equal(preview.kind, 'strategy');
  assert.match(String(preview.sourceCallbackId), /^harness-module\./);
  assert.match(String(preview.text), /preview=bounded/);
}

const renderedEntries = list(plan.renderedEntries).map(record);
for (const moduleId of moduleStack) {
  assert.ok(
    renderedEntries.some((entry) => entry.id === `module-preview.${moduleId}`),
    `renderedEntries should include module preview for ${moduleId}`,
  );
}
assert.ok(renderedEntries.some((entry) => entry.id === 'latency-first-answer'), 'contract directive should stay visible as a sourced entry');

const hostilePlan = {
  ...plan,
  renderedText: 'RAW_RENDERED_TEXT_SHOULD_NOT_INLINE',
  promptDirectives: [{ text: 'RAW_PROMPT_DIRECTIVES_SHOULD_NOT_INLINE' }],
  directiveRefs: [{ text: 'RAW_DIRECTIVE_REFS_SHOULD_NOT_INLINE' }],
  strategyRefs: [{ text: 'RAW_STRATEGY_REFS_SHOULD_NOT_INLINE' }],
  selectedContextRefs: [{ ref: 'RAW_SELECTED_CONTEXT_REFS_SHOULD_NOT_INLINE' }],
};

const prompt = buildAgentServerGenerationPrompt({
  prompt: 'Research-guide smoke prompt.',
  skillDomain: 'literature',
  metadata: {
    promptRenderPlan: hostilePlan,
    agentHarnessHandoff: {
      promptRenderPlan: hostilePlan,
      contract: { marker: 'FULL_CONTRACT_SHOULD_NOT_INLINE' },
      trace: { marker: 'FULL_TRACE_SHOULD_NOT_INLINE' },
    },
  },
  contextEnvelope: {
    version: 'sciforge.context-envelope.smoke',
    sessionFacts: {
      currentUserRequest: 'Research-guide smoke prompt.',
      promptRenderPlan: hostilePlan,
    },
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  artifactSchema: {},
  uiManifestContract: {},
  availableRuntimeCapabilities: undefined,
  uiStateSummary: {},
  artifacts: [],
  recentExecutionRefs: [],
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  priorAttempts: [],
  freshCurrentTurn: true,
});

assert.match(prompt, /sciforge\.agentserver\.prompt-render-plan-summary\.v1/);
assert.match(prompt, /module-preview\.intent/);
assert.match(prompt, /latency-first-answer/);

for (const forbidden of [
  'RAW_RENDERED_TEXT_SHOULD_NOT_INLINE',
  'RAW_PROMPT_DIRECTIVES_SHOULD_NOT_INLINE',
  'RAW_DIRECTIVE_REFS_SHOULD_NOT_INLINE',
  'RAW_STRATEGY_REFS_SHOULD_NOT_INLINE',
  'RAW_SELECTED_CONTEXT_REFS_SHOULD_NOT_INLINE',
  'FULL_CONTRACT_SHOULD_NOT_INLINE',
  'FULL_TRACE_SHOULD_NOT_INLINE',
  '"renderedText"',
  '"promptDirectives"',
  '"directiveRefs"',
  '"strategyRefs"',
  '"selectedContextRefs"',
]) {
  assert.equal(prompt.includes(forbidden), false, `AgentServer prompt must not inline ${forbidden}`);
}

console.log([
  '[ok] harness research guide smoke passed',
  `- documentedEntryPoints=7`,
  `- moduleDirectivePreviews=${previews.length}`,
  '- agentServerPrompt=bounded-render-plan-summary-only',
].join('\n'));

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}
