import type { HarnessEvaluation, HarnessInput, HarnessStage } from '../../packages/agent-harness/src/contracts';

export interface HarnessExperimentMetrics {
  id: string;
  requestId?: string;
  profileId: string;
  stageCount: number;
  callbackCount: number;
  conflictCount: number;
  auditNoteCount: number;
  stageHistogram: Partial<Record<HarnessStage, number>>;
  latencyBudgetMs: number;
  promptTokenBudget: number;
  historyTurnBudget: number;
  toolCallBudget: number;
  networkCallBudget: number;
  downloadByteBudget: number;
  validationFailures: number;
  repairAttempts: number;
  blockedRefCount: number;
  blockedCapabilityCount: number;
  candidateCount: number;
  finalArtifactQualityScore: number;
}

export function collectHarnessExperimentMetrics(
  id: string,
  input: HarnessInput,
  evaluation: HarnessEvaluation,
): HarnessExperimentMetrics {
  const contract = evaluation.contract;
  const validationFailures = countValidationFailures(input);
  const repairAttempts = contract.repairContextPolicy.kind === 'none' ? 0 : contract.repairContextPolicy.maxAttempts;
  const finalArtifactQualityScore = scoreFinalArtifactQuality({
    requireArtifactRefs: contract.verificationPolicy.requireArtifactRefs,
    requireCitations: contract.verificationPolicy.requireCitations,
    requireCurrentRefs: contract.verificationPolicy.requireCurrentRefs,
    validationFailures,
    repairAttempts,
  });

  return {
    id,
    requestId: input.requestId,
    profileId: contract.profileId,
    stageCount: evaluation.trace.stages.length,
    callbackCount: new Set(evaluation.trace.stages.map((stage) => stage.callbackId)).size,
    conflictCount: evaluation.trace.conflicts.length,
    auditNoteCount: evaluation.trace.auditNotes.length,
    stageHistogram: evaluation.trace.stages.reduce<Partial<Record<HarnessStage, number>>>((histogram, stage) => {
      histogram[stage.stage] = (histogram[stage.stage] ?? 0) + 1;
      return histogram;
    }, {}),
    latencyBudgetMs: contract.toolBudget.maxWallMs,
    promptTokenBudget: contract.contextBudget.maxPromptTokens,
    historyTurnBudget: contract.contextBudget.maxHistoryTurns,
    toolCallBudget: contract.toolBudget.maxToolCalls,
    networkCallBudget: contract.toolBudget.maxNetworkCalls,
    downloadByteBudget: contract.toolBudget.maxDownloadBytes,
    validationFailures,
    repairAttempts,
    blockedRefCount: contract.blockedContextRefs.length,
    blockedCapabilityCount: contract.capabilityPolicy.blockedCapabilities.length,
    candidateCount: contract.capabilityPolicy.candidates.length,
    finalArtifactQualityScore,
  };
}

function countValidationFailures(input: HarnessInput): number {
  const validationFailure = input.conversationSignals?.validationFailure;
  if (!validationFailure) return 0;
  return Array.isArray(validationFailure) ? validationFailure.length : 1;
}

function scoreFinalArtifactQuality(input: {
  requireArtifactRefs: boolean;
  requireCitations: boolean;
  requireCurrentRefs: boolean;
  validationFailures: number;
  repairAttempts: number;
}): number {
  const base = 0.45;
  const verificationBonus = [
    input.requireArtifactRefs ? 0.15 : 0,
    input.requireCurrentRefs ? 0.15 : 0,
    input.requireCitations ? 0.15 : 0,
  ].reduce((total, value) => total + value, 0);
  const repairPenalty = Math.min(0.2, input.validationFailures * 0.1 + Math.max(0, input.repairAttempts - 1) * 0.05);
  return Number(Math.max(0, Math.min(1, base + verificationBonus - repairPenalty)).toFixed(2));
}
