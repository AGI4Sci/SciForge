import { computerUseVisibleArtifactGapReason } from '../../../packages/actions/computer-use/runtime-policy.js';
import type { GenericVisionAction } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import { finalVisibleArtifactForTrace } from './package-bridge-final-artifacts.js';

export type PackageBridgeFinalVisibleArtifactPolicyInput = {
  packageResult: Record<string, unknown>;
  task: string;
  executedActions: GenericVisionAction[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export type PackageBridgeVisibleArtifactPolicyInput = {
  task: string;
  executedActions: GenericVisionAction[];
  finalAttempt?: boolean;
  finalVisibleArtifact?: VirtualRemoteVisibleArtifact;
};

export function applyPackageBridgeFinalVisibleArtifactPolicy(
  input: PackageBridgeFinalVisibleArtifactPolicyInput,
): Record<string, unknown> {
  const { packageResult } = input;
  if (stringAt(packageResult, 'status') !== 'completed') return packageResult;
  const finalGap = packageBridgeVisibleArtifactPolicy({
    task: input.task,
    executedActions: input.executedActions,
    finalAttempt: true,
    finalVisibleArtifact: finalVisibleArtifactForTrace(input.visibleArtifacts),
  });
  if (!finalGap) return packageResult;
  return {
    ...packageResult,
    status: 'failed-with-reason',
    reason: finalGap,
    failureDiagnostics: {
      ...recordAt(packageResult, 'failureDiagnostics'),
      failedStage: 'visible-artifact-final-guard',
      reason: finalGap,
    },
  };
}

export function packageBridgeVisibleArtifactPolicy(
  input: PackageBridgeVisibleArtifactPolicyInput,
) {
  const gap = computerUseVisibleArtifactGapReason(input.task, input.executedActions, {
    finalAttempt: input.finalAttempt,
  });
  if (!gap) return undefined;
  if (input.finalAttempt && input.finalVisibleArtifact) return undefined;
  return gap;
}

export function normalizePackageBridgeBlockedReason(
  packageResult: Record<string, unknown>,
  status: string | undefined,
) {
  const reason = stringAt(packageResult, 'reason')
    || stringAt(packageResult, 'message')
    || `Computer Use package returned status=${status || 'unknown'}.`;
  if (status === 'max-steps') {
    return reason.replace(/\bmax_steps=/g, 'maxSteps=');
  }
  if (status === 'needs-confirmation' && /high-risk|confirmation/i.test(reason)) {
    return `High-risk Computer Use action blocked: ${reason}`;
  }
  return reason;
}

export function packageBridgeLedgerCompletionQuotaIssue(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  executedActions: GenericVisionAction[],
  maxSteps: number,
) {
  const progress = recordAt(plannerAcceptanceContract, 'acceptanceProgress');
  if (!progress) return undefined;
  const remainingStepBudget = Math.max(0, maxSteps - executedActions.length);
  if (remainingStepBudget <= 0) return undefined;
  const actionTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundActionTarget));
  const nonWaitTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundNonWaitActionTarget));
  const actionCount = executedActions.length;
  const nonWaitActionCount = executedActions.filter((action) => action.type !== 'wait').length;
  const issues = [
    actionTarget !== undefined && actionCount < actionTarget
      ? `actions=${actionCount}/${actionTarget}`
      : '',
    nonWaitTarget !== undefined && nonWaitActionCount < nonWaitTarget
      ? `nonWaitActions=${nonWaitActionCount}/${nonWaitTarget}`
      : '',
  ].filter(Boolean);
  if (!issues.length) return undefined;
  return `Action-ledger completion policy is satisfied, but current-round acceptance quota is not met yet (${issues.join(', ')}); continue with another safe generic action or return structured failure if no safe visible action remains.`;
}

function positiveQuota(value: number | undefined) {
  if (value === undefined || value <= 0) return undefined;
  return Math.ceil(value);
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function numberAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
