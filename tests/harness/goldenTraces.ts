import assert from 'node:assert/strict';

import type { HarnessEvaluation } from '../../packages/agent-harness/src/contracts';

export interface HarnessGoldenTraceSummary {
  id: string;
  traceId: string;
  profileId: string;
  requestId?: string;
  stageKeys: string[];
  final: {
    intentMode: string;
    explorationMode: string;
    contextBudget: {
      maxPromptTokens: number;
      maxHistoryTurns: number;
      maxReferenceDigests: number;
      maxFullTextRefs: number;
    };
    toolBudget: {
      maxWallMs: number;
      maxToolCalls: number;
      maxNetworkCalls: number;
      maxDownloadBytes: number;
      maxProviders: number;
      costUnits: number;
      exhaustedPolicy: string;
    };
    verification: {
      intensity: string;
      requireCitations: boolean;
      requireCurrentRefs: boolean;
      requireArtifactRefs: boolean;
    };
    repair: {
      kind: string;
      maxAttempts: number;
    };
    sideEffects: {
      network: string;
      workspaceWrite: string;
    };
    blockedCapabilities: string[];
    blockedContextRefs: string[];
    requiredContextRefs: string[];
    candidateIds: string[];
    progressInitialStatus: string;
    conflictCount: number;
    auditNoteCount: number;
  };
}

export const EXPECTED_HARNESS_GOLDEN_TRACE_SUMMARIES: Record<string, HarnessGoldenTraceSummary> = {
  'fresh-research.fast-answer': {
    id: 'fresh-research.fast-answer',
    traceId: 'replay:t124-fresh-research:fast-answer',
    profileId: 'fast-answer',
    requestId: 't124-fresh-research',
    stageKeys: [
      'setExplorationBudget/fast-answer.budget',
      'onBudgetAllocate/fast-answer.budget',
      'beforeUserProgressEvent/fast-answer.budget',
    ],
    final: {
      intentMode: 'fresh',
      explorationMode: 'minimal',
      contextBudget: { maxPromptTokens: 3000, maxHistoryTurns: 0, maxReferenceDigests: 3, maxFullTextRefs: 0 },
      toolBudget: {
        maxWallMs: 30000,
        maxToolCalls: 2,
        maxNetworkCalls: 1,
        maxDownloadBytes: 2000000,
        maxProviders: 1,
        costUnits: 2,
        exhaustedPolicy: 'partial-payload',
      },
      verification: { intensity: 'standard', requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: true },
      repair: { kind: 'supplement', maxAttempts: 1 },
      sideEffects: { network: 'requires-approval', workspaceWrite: 'block' },
      blockedCapabilities: [],
      blockedContextRefs: [],
      requiredContextRefs: ['paper:crispr-screen-a'],
      candidateIds: ['literature.retrieval', 'citation.verification'],
      progressInitialStatus: 'Answering',
      conflictCount: 0,
      auditNoteCount: 0,
    },
  },
  'fresh-research.research-grade': {
    id: 'fresh-research.research-grade',
    traceId: 'replay:t124-fresh-research:research-grade',
    profileId: 'research-grade',
    requestId: 't124-fresh-research',
    stageKeys: [
      'setExplorationBudget/research-grade.verification',
      'onBudgetAllocate/research-grade.verification',
      'beforeResultValidation/research-grade.verification',
    ],
    final: {
      intentMode: 'fresh',
      explorationMode: 'deep',
      contextBudget: { maxPromptTokens: 10000, maxHistoryTurns: 2, maxReferenceDigests: 16, maxFullTextRefs: 2 },
      toolBudget: {
        maxWallMs: 240000,
        maxToolCalls: 12,
        maxNetworkCalls: 8,
        maxDownloadBytes: 60000000,
        maxProviders: 4,
        costUnits: 20,
        exhaustedPolicy: 'partial-payload',
      },
      verification: { intensity: 'strict', requireCitations: true, requireCurrentRefs: true, requireArtifactRefs: true },
      repair: { kind: 'supplement', maxAttempts: 1 },
      sideEffects: { network: 'requires-approval', workspaceWrite: 'block' },
      blockedCapabilities: [],
      blockedContextRefs: [],
      requiredContextRefs: ['paper:crispr-screen-a'],
      candidateIds: ['literature.retrieval', 'citation.verification'],
      progressInitialStatus: 'Researching',
      conflictCount: 0,
      auditNoteCount: 0,
    },
  },
  'fresh-research.privacy-strict': {
    id: 'fresh-research.privacy-strict',
    traceId: 'replay:t124-fresh-research:privacy-strict',
    profileId: 'privacy-strict',
    requestId: 't124-fresh-research',
    stageKeys: [
      'onToolPolicy/privacy-strict.safety',
      'onBudgetAllocate/privacy-strict.safety',
      'beforeResultValidation/privacy-strict.safety',
    ],
    final: {
      intentMode: 'fresh',
      explorationMode: 'normal',
      contextBudget: { maxPromptTokens: 6000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 0 },
      toolBudget: {
        maxWallMs: 120000,
        maxToolCalls: 8,
        maxNetworkCalls: 0,
        maxDownloadBytes: 0,
        maxProviders: 0,
        costUnits: 10,
        exhaustedPolicy: 'partial-payload',
      },
      verification: { intensity: 'strict', requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: true },
      repair: { kind: 'supplement', maxAttempts: 1 },
      sideEffects: { network: 'block', workspaceWrite: 'block' },
      blockedCapabilities: ['external-upload', 'network', 'workspace-write'],
      blockedContextRefs: [],
      requiredContextRefs: ['paper:crispr-screen-a'],
      candidateIds: ['literature.retrieval', 'citation.verification'],
      progressInitialStatus: 'Planning request',
      conflictCount: 0,
      auditNoteCount: 3,
    },
  },
  'repair-after-validation-failure.debug-repair': {
    id: 'repair-after-validation-failure.debug-repair',
    traceId: 'replay:t124-repair-validation-failure:debug-repair',
    profileId: 'debug-repair',
    requestId: 't124-repair-validation-failure',
    stageKeys: [
      'classifyIntent/debug-repair.policy',
      'onRepairRequired/debug-repair.policy',
    ],
    final: {
      intentMode: 'repair',
      explorationMode: 'normal',
      contextBudget: { maxPromptTokens: 6000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 0 },
      toolBudget: {
        maxWallMs: 120000,
        maxToolCalls: 8,
        maxNetworkCalls: 4,
        maxDownloadBytes: 20000000,
        maxProviders: 2,
        costUnits: 10,
        exhaustedPolicy: 'partial-payload',
      },
      verification: { intensity: 'standard', requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: true },
      repair: { kind: 'repair-rerun', maxAttempts: 2 },
      sideEffects: { network: 'requires-approval', workspaceWrite: 'block' },
      blockedCapabilities: [],
      blockedContextRefs: [],
      requiredContextRefs: ['validation:missing-artifact-ref'],
      candidateIds: [],
      progressInitialStatus: 'Repairing',
      conflictCount: 0,
      auditNoteCount: 0,
    },
  },
  'capability-budget-exhaustion.fast-answer': {
    id: 'capability-budget-exhaustion.fast-answer',
    traceId: 'replay:t124-capability-budget-exhaustion:fast-answer',
    profileId: 'fast-answer',
    requestId: 't124-capability-budget-exhaustion',
    stageKeys: [
      'setExplorationBudget/fast-answer.budget',
      'onBudgetAllocate/fast-answer.budget',
      'beforeUserProgressEvent/fast-answer.budget',
    ],
    final: {
      intentMode: 'fresh',
      explorationMode: 'minimal',
      contextBudget: { maxPromptTokens: 1200, maxHistoryTurns: 0, maxReferenceDigests: 1, maxFullTextRefs: 0 },
      toolBudget: {
        maxWallMs: 30000,
        maxToolCalls: 0,
        maxNetworkCalls: 0,
        maxDownloadBytes: 0,
        maxProviders: 0,
        costUnits: 2,
        exhaustedPolicy: 'fail-with-reason',
      },
      verification: { intensity: 'standard', requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: true },
      repair: { kind: 'supplement', maxAttempts: 1 },
      sideEffects: { network: 'requires-approval', workspaceWrite: 'block' },
      blockedCapabilities: [],
      blockedContextRefs: ['ref:private-upload'],
      requiredContextRefs: [],
      candidateIds: ['web.search', 'local.reference-digest'],
      progressInitialStatus: 'Answering',
      conflictCount: 0,
      auditNoteCount: 0,
    },
  },
};

export function summarizeGoldenTrace(id: string, evaluation: HarnessEvaluation): HarnessGoldenTraceSummary {
  const contract = evaluation.contract;
  return {
    id,
    traceId: evaluation.trace.traceId,
    profileId: contract.profileId,
    requestId: evaluation.trace.requestId,
    stageKeys: evaluation.trace.stages.map((stage) => `${stage.stage}/${stage.callbackId}`),
    final: {
      intentMode: contract.intentMode,
      explorationMode: contract.explorationMode,
      contextBudget: {
        maxPromptTokens: contract.contextBudget.maxPromptTokens,
        maxHistoryTurns: contract.contextBudget.maxHistoryTurns,
        maxReferenceDigests: contract.contextBudget.maxReferenceDigests,
        maxFullTextRefs: contract.contextBudget.maxFullTextRefs,
      },
      toolBudget: {
        maxWallMs: contract.toolBudget.maxWallMs,
        maxToolCalls: contract.toolBudget.maxToolCalls,
        maxNetworkCalls: contract.toolBudget.maxNetworkCalls,
        maxDownloadBytes: contract.toolBudget.maxDownloadBytes,
        maxProviders: contract.toolBudget.maxProviders,
        costUnits: contract.toolBudget.costUnits,
        exhaustedPolicy: contract.toolBudget.exhaustedPolicy,
      },
      verification: {
        intensity: contract.verificationPolicy.intensity,
        requireCitations: contract.verificationPolicy.requireCitations,
        requireCurrentRefs: contract.verificationPolicy.requireCurrentRefs,
        requireArtifactRefs: contract.verificationPolicy.requireArtifactRefs,
      },
      repair: {
        kind: contract.repairContextPolicy.kind,
        maxAttempts: contract.repairContextPolicy.maxAttempts,
      },
      sideEffects: {
        network: contract.capabilityPolicy.sideEffects.network,
        workspaceWrite: contract.capabilityPolicy.sideEffects.workspaceWrite,
      },
      blockedCapabilities: contract.capabilityPolicy.blockedCapabilities,
      blockedContextRefs: contract.blockedContextRefs,
      requiredContextRefs: contract.requiredContextRefs,
      candidateIds: contract.capabilityPolicy.candidates.map((candidate) => candidate.id),
      progressInitialStatus: contract.progressPlan.initialStatus,
      conflictCount: evaluation.trace.conflicts.length,
      auditNoteCount: evaluation.trace.auditNotes.length,
    },
  };
}

export function assertGoldenTraceSummary(id: string, evaluation: HarnessEvaluation): HarnessGoldenTraceSummary {
  const actual = summarizeGoldenTrace(id, evaluation);
  assert.deepEqual(actual, EXPECTED_HARNESS_GOLDEN_TRACE_SUMMARIES[id], `golden trace summary drifted: ${id}`);
  return actual;
}
