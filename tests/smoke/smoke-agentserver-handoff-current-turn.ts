import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope.js';
import { requestWithPolicyResponse } from '../../src/runtime/conversation-policy/apply.js';
import type { ConversationPolicyResponse } from '@sciforge-ui/runtime-contract/conversation-policy';
import type { GatewayRequest } from '../../src/runtime/runtime-types.js';
import { normalizeBackendHandoff } from '../../src/runtime/workspace-task-input.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-handoff-current-turn-'));
const currentPrompt = '检索最近一周的任何领域论文，阅读全文，并写系统总结报告';
const staleFailure = '旧任务失败：'.repeat(6000);

function gatewayRequest(prompt: string, extras: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt,
    artifacts: [],
    ...extras,
    uiState: {
      currentPrompt: prompt,
      currentUserRequest: prompt,
      ...(extras.uiState ?? {}),
    },
  };
}

function policyResponse(executionModePlan?: Record<string, unknown>): ConversationPolicyResponse {
  return {
    schemaVersion: 'sciforge.conversation-policy.response.v1',
    goalSnapshot: {},
    contextPolicy: {},
    handoffMemoryProjection: {},
    executionModePlan,
  };
}

function promptFromPythonPolicy(
  prompt: string,
  executionModePlan: Record<string, unknown> | undefined,
  extras: Partial<GatewayRequest> = {},
) {
  const request = requestWithPolicyResponse(gatewayRequest(prompt, extras), policyResponse(executionModePlan));
  const contextEnvelope = buildContextEnvelope(request, { workspace, workspaceTreeSummary: [] });
  return buildAgentServerGenerationPrompt({
    prompt,
    skillDomain: request.skillDomain,
    contextEnvelope,
    workspaceTreeSummary: [],
    availableSkills: [],
    availableTools: [],
    availableRuntimeCapabilities: {},
    artifactSchema: { types: request.expectedArtifactTypes ?? [] },
    uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
    uiStateSummary: { rawUserPrompt: prompt },
    artifacts: request.artifacts,
    recentExecutionRefs: [],
    expectedArtifactTypes: request.expectedArtifactTypes ?? [],
    selectedComponentIds: request.selectedComponentIds ?? [],
    priorAttempts: [],
  });
}

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
      executionModeRecommendation: 'multi-stage-project',
      complexityScore: 0.91,
      uncertaintyScore: 0.44,
      reproducibilityLevel: 'staged',
      stagePlanHint: ['Return only the next retrieval stage.'],
      executionModeReason: 'Python classifier selected staged research work.',
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

const lightweightSearchPrompt = buildAgentServerGenerationPrompt({
  prompt: '帮我搜索一下最近某个国际局势',
  skillDomain: 'literature',
  contextEnvelope: {
    version: 'sciforge.context-envelope.v1',
    sessionFacts: {
      currentUserRequest: '帮我搜索一下最近某个国际局势',
      recentConversation: ['user: 帮我搜索一下最近某个国际局势'],
    },
    scenarioFacts: {
      executionModeRecommendation: 'thin-reproducible-adapter',
      complexityScore: 0.31,
      uncertaintyScore: 0.42,
      reproducibilityLevel: 'light',
      stagePlanHint: ['Use a bounded lookup adapter.'],
      executionModeReason: 'Python classifier selected lightweight retrieval.',
    },
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  availableRuntimeCapabilities: {},
  artifactSchema: { types: [] },
  uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
  uiStateSummary: { rawUserPrompt: '帮我搜索一下最近某个国际局势' },
  artifacts: [],
  recentExecutionRefs: [],
  expectedArtifactTypes: [],
  selectedComponentIds: [],
  priorAttempts: [],
});

assert.match(lightweightSearchPrompt, /thin-reproducible-adapter/);
assert.match(lightweightSearchPrompt, /"executionModeRecommendation": "thin-reproducible-adapter"/);
assert.match(lightweightSearchPrompt, /Python classifier selected lightweight retrieval/);
assert.doesNotMatch(lightweightSearchPrompt, /directAnswerRecommended/);
assert.doesNotMatch(lightweightSearchPrompt, /"executionModeRecommendation": "direct-context-answer"/);

const directContextPrompt = buildAgentServerGenerationPrompt({
  prompt: '根据上文和当前引用，给我一个简短结论',
  skillDomain: 'literature',
  contextEnvelope: {
    version: 'sciforge.context-envelope.v1',
    sessionFacts: {
      currentUserRequest: '根据上文和当前引用，给我一个简短结论',
      recentConversation: ['user: 根据上文和当前引用，给我一个简短结论'],
      currentReferences: [{ ref: 'artifact:summary-1', title: '已有摘要' }],
    },
    scenarioFacts: {
      executionModeRecommendation: 'direct-context-answer',
      complexityScore: 0.18,
      uncertaintyScore: 0.2,
      reproducibilityLevel: 'none',
      stagePlanHint: ['Answer from existing refs.'],
      executionModeReason: 'Python classifier selected context answer.',
    },
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  availableRuntimeCapabilities: {},
  artifactSchema: { types: [] },
  uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
  uiStateSummary: { rawUserPrompt: '根据上文和当前引用，给我一个简短结论' },
  artifacts: [{ id: 'summary-1', type: 'research-report', title: '已有摘要' }],
  recentExecutionRefs: [],
  expectedArtifactTypes: [],
  selectedComponentIds: [],
  priorAttempts: [],
});

assert.match(directContextPrompt, /"executionModeRecommendation": "direct-context-answer"/);

const complexResearchPrompt = buildAgentServerGenerationPrompt({
  prompt: '检索最近一周的论文，阅读全文，生成证据矩阵和系统总结报告',
  skillDomain: 'literature',
  contextEnvelope: {
    version: 'sciforge.context-envelope.v1',
    sessionFacts: {
      currentUserRequest: '检索最近一周的论文，阅读全文，生成证据矩阵和系统总结报告',
      recentConversation: ['user: 检索最近一周的论文，阅读全文，生成证据矩阵和系统总结报告'],
    },
    scenarioFacts: {
      expectedArtifactTypes: ['paper-list', 'research-report'],
      selectedComponentIds: ['paper-card-list', 'report-viewer'],
      executionModeRecommendation: 'multi-stage-project',
      complexityScore: 0.88,
      uncertaintyScore: 0.6,
      reproducibilityLevel: 'staged',
      stagePlanHint: ['Return only the next full-text retrieval stage.'],
      executionModeReason: 'Python classifier selected staged project.',
    },
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  availableRuntimeCapabilities: {},
  artifactSchema: { types: ['paper-list', 'research-report'] },
  uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
  uiStateSummary: { rawUserPrompt: '检索最近一周的论文，阅读全文，生成证据矩阵和系统总结报告' },
  artifacts: [],
  recentExecutionRefs: [],
  expectedArtifactTypes: ['paper-list', 'research-report'],
  selectedComponentIds: ['paper-card-list', 'report-viewer'],
  priorAttempts: [],
});

assert.match(complexResearchPrompt, /"executionModeRecommendation": "multi-stage-project"/);
assert.match(complexResearchPrompt, /Return only the next full-text retrieval stage/);

const pythonThinPrompt = promptFromPythonPolicy('帮我搜索一下最近某个国际局势', {
  executionMode: 'thin-reproducible-adapter',
  complexityScore: 0.29,
  uncertaintyScore: 0.46,
  reproducibilityLevel: 'light',
  stagePlanHint: ['Use one small adapter.'],
  reason: 'Python output fixture.',
});
assert.match(pythonThinPrompt, /"executionModeRecommendation": "thin-reproducible-adapter"/);

const pythonMultiStagePrompt = promptFromPythonPolicy('检索论文并写报告', {
  executionMode: 'multi-stage-project',
  complexityScore: 0.86,
  uncertaintyScore: 0.51,
  reproducibilityLevel: 'staged',
  stagePlanHint: ['Plan next stage from Python.'],
  reason: 'Python staged fixture.',
}, {
  expectedArtifactTypes: ['paper-list', 'research-report'],
});
assert.match(pythonMultiStagePrompt, /stagePlanHint/);
assert.match(pythonMultiStagePrompt, /Plan next stage from Python/);
assert.match(pythonMultiStagePrompt, /executionModeRecommendation=multi-stage-project/);
assert.match(pythonMultiStagePrompt, /return only the next stage/i);

const pythonSingleStagePrompt = promptFromPythonPolicy('读取一个 CSV 并生成一张小表', {
  executionMode: 'single-stage-task',
  complexityScore: 0.48,
  uncertaintyScore: 0.22,
  reproducibilityLevel: 'full',
  stagePlanHint: ['Run one bounded transform.'],
  reason: 'Python single-stage fixture.',
});
assert.match(pythonSingleStagePrompt, /"executionModeRecommendation": "single-stage-task"/);
assert.match(pythonSingleStagePrompt, /executionModeRecommendation=single-stage-task/);
assert.match(pythonSingleStagePrompt, /one bounded local computation/);

const pythonRepairContinuePrompt = promptFromPythonPolicy('继续上一轮失败的检索，按日志修复后重跑', {
  executionMode: 'repair-or-continue-project',
  complexityScore: 0.74,
  uncertaintyScore: 0.55,
  reproducibilityLevel: 'staged',
  stagePlanHint: ['Create repair stage.'],
  reason: 'Python repair fixture.',
});
assert.match(pythonRepairContinuePrompt, /"executionModeRecommendation": "repair-or-continue-project"/);
assert.match(pythonRepairContinuePrompt, /executionModeRecommendation=repair-or-continue-project/);
assert.match(pythonRepairContinuePrompt, /minimal repair\/continue stage/);

const fallbackPrompt = promptFromPythonPolicy('普通问题', undefined);
assert.match(fallbackPrompt, /"executionModeRecommendation": "unknown"/);
assert.match(fallbackPrompt, /"stagePlanHint": "backend-decides"/);

const noPythonOutputPrompt = buildAgentServerGenerationPrompt({
  prompt: '普通问题',
  skillDomain: 'literature',
  contextEnvelope: {
    version: 'sciforge.context-envelope.v1',
    sessionFacts: { currentUserRequest: '普通问题' },
    scenarioFacts: {},
  },
  workspaceTreeSummary: [],
  availableSkills: [],
  availableTools: [],
  availableRuntimeCapabilities: {},
  artifactSchema: { types: [] },
  uiManifestContract: { expectedKeys: ['componentId', 'artifactRef'] },
  uiStateSummary: { rawUserPrompt: '普通问题' },
  artifacts: [],
  recentExecutionRefs: [],
  expectedArtifactTypes: [],
  selectedComponentIds: [],
  priorAttempts: [],
});
assert.match(noPythonOutputPrompt, /"executionModeRecommendation": "unknown"/);
assert.match(noPythonOutputPrompt, /"executionModeReason": "backend-decides"/);

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
assert.match(text, /executionModeRecommendation/);
assert.match(text, /complexityScore/);
assert.match(text, /uncertaintyScore/);
assert.match(text, /reproducibilityLevel/);
assert.match(text, /stagePlanHint/);
assert.match(text, /executionModeReason/);
assert.match(text, /AgentServerGenerationResponse|SciForge ToolPayload|outputContract/);
assert.match(generationPrompt, /External I\/O reliability contract/);
assert.match(text, /externalIo/);
assert.match(text, /429\/5xx\/network timeout\/empty-result/);
assert.ok(text.length < generationPrompt.length, 'handoff should still be compacted');

console.log('[ok] compact AgentServer handoff preserves current turn snapshot and output contract');
