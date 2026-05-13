import type { FailureOwnerDecision, FailureOwnerLayer, MaterializedResultLike } from './types';

const externalTransientPatterns = [
  /429|rate limit|quota/i,
  /timeout|timed out/i,
  /remote end closed|connection closed|socket hang up|network/i,
  /dns|enotfound|econnreset|econnrefused/i,
  /\b5\d\d\b|service unavailable|bad gateway/i,
];

const payloadContractPatterns = [
  /schema|contract|malformed|missing .*artifact|invalid .*ref|payload/i,
];

const runtimeRunnerPatterns = [
  /exit code|argv|sandbox|permission denied|enoent|spawn|workspace task|runner/i,
];

const backendGenerationPatterns = [
  /no task code changes|taskFiles|process narration|could not parse|generation response/i,
];

const verificationPatterns = [
  /verification|verifier|release gate|claim check/i,
];

export function classifyFailureOwner(input: {
  reason?: string;
  evidenceRefs?: string[];
  layerHint?: FailureOwnerLayer;
}): FailureOwnerDecision {
  const reason = input.reason?.trim() || 'Failure owner could not be inferred from the materialized result.';
  const evidenceRefs = input.evidenceRefs ?? [];
  const ownerLayer = input.layerHint ?? inferOwnerLayer(reason);
  const action = actionForOwner(ownerLayer);
  return {
    ownerLayer,
    action,
    retryable: action === 'retry-after-backoff' || action === 'repair-rerun' || action === 'supplement',
    reason,
    evidenceRefs,
    nextStep: nextStepForOwner(ownerLayer),
  };
}

export function classifyMaterializedFailure(result: MaterializedResultLike): FailureOwnerDecision | undefined {
  const reason = stringField(result.failureReason) ?? stringField(result.error);
  const status = stringField(result.status);
  if (!reason && status !== 'failed' && status !== 'repair-needed') return undefined;
  return classifyFailureOwner({
    reason: reason ?? `Materialized result ended with status ${status}`,
    evidenceRefs: stringArrayField(result.evidenceRefs),
  });
}

function inferOwnerLayer(reason: string): FailureOwnerLayer {
  if (externalTransientPatterns.some((pattern) => pattern.test(reason))) return 'external-provider';
  if (backendGenerationPatterns.some((pattern) => pattern.test(reason))) return 'backend-generation';
  if (payloadContractPatterns.some((pattern) => pattern.test(reason))) return 'payload-contract';
  if (runtimeRunnerPatterns.some((pattern) => pattern.test(reason))) return 'runtime-runner';
  if (verificationPatterns.some((pattern) => pattern.test(reason))) return 'verification';
  return 'runtime-runner';
}

function actionForOwner(owner: FailureOwnerLayer): FailureOwnerDecision['action'] {
  switch (owner) {
    case 'external-provider':
      return 'retry-after-backoff';
    case 'payload-contract':
    case 'backend-generation':
    case 'runtime-runner':
      return 'repair-rerun';
    case 'verification':
      return 'supplement';
    case 'ui-presentation':
      return 'fail-closed';
  }
}

function nextStepForOwner(owner: FailureOwnerLayer): string {
  switch (owner) {
    case 'external-provider':
      return 'Retry after provider recovery or switch to an available provider while preserving refs.';
    case 'payload-contract':
      return 'Repair or normalize the materialized payload under the contract gate.';
    case 'runtime-runner':
      return 'Repair runtime execution inputs, argv, sandbox, or output path and rerun.';
    case 'backend-generation':
      return 'Ask backend to regenerate a valid handoff or task payload with compact repair evidence.';
    case 'verification':
      return 'Supplement verifier evidence before presenting as verified.';
    case 'ui-presentation':
      return 'Fail closed in the presentation layer and keep raw refs in audit view.';
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}
