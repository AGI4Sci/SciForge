import type { ContractResult, FailureOwnerDecision, FailureOwnerLayer, FailureOwnerNextStep } from './contract-fns';
import { normalizeContractResult } from './contract-fns';
import type { HookDecision } from './hook-fns';
import { normalizeHookDecision } from './hook-fns';

export interface ThinWaistMergeDiagnostics {
  selectedFailureOwner?: FailureOwnerDecision;
  contractResultKinds: Record<string, number>;
  hookDecisionKinds: Record<string, number>;
  auditNotes: string[];
}

export interface ThinWaistMergeResult<Decision> {
  contractResults: ContractResult<unknown>[];
  hookDecisions: HookDecision<Decision>[];
  ownerDecision?: FailureOwnerDecision;
  diagnostics: ThinWaistMergeDiagnostics;
}

export function mergeContractResults(results: readonly ContractResult<unknown>[]): ContractResult<unknown>[] {
  return [...results].map((result) => normalizeContractResult(result)).sort((left, right) => {
    const kindOrder: ContractResult<unknown>['kind'][] = ['fail', 'warn', 'pass'];
    return kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind)
      || (left.contractId ?? '').localeCompare(right.contractId ?? '')
      || (left.inputDigest ?? '').localeCompare(right.inputDigest ?? '');
  });
}

export function mergeHookDecisions<Decision>(decisions: readonly HookDecision<Decision>[]): HookDecision<Decision>[] {
  return [...decisions].map((decision) => normalizeHookDecision(decision)).sort((left, right) => {
    const kindOrder: HookDecision<Decision>['kind'][] = ['block', 'needs-human', 'tighten', 'defer', 'continue'];
    return kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind)
      || (left.hookId ?? '').localeCompare(right.hookId ?? '');
  });
}

export function mergeThinWaistDecisions<Decision>(
  contractResults: readonly ContractResult<unknown>[],
  hookDecisions: readonly HookDecision<Decision>[],
): ThinWaistMergeResult<Decision> {
  const normalizedContractResults = mergeContractResults(contractResults);
  const normalizedHookDecisions = mergeHookDecisions(hookDecisions);
  const ownerDecision = mergeFailureOwnerDecisions([
    ...normalizedContractResults.map((result) => result.ownerDecision).filter(isOwnerDecision),
    ...normalizedHookDecisions.map((decision) => decision.ownerDecision).filter(isOwnerDecision),
  ]);
  return {
    contractResults: normalizedContractResults,
    hookDecisions: normalizedHookDecisions,
    ownerDecision,
    diagnostics: {
      selectedFailureOwner: ownerDecision,
      contractResultKinds: countBy(normalizedContractResults.map((result) => result.kind)),
      hookDecisionKinds: countBy(normalizedHookDecisions.map((decision) => decision.kind)),
      auditNotes: normalizedHookDecisions.flatMap((decision) => decision.auditNotes.map((note) => note.message)).sort(),
    },
  };
}

export function mergeFailureOwnerDecisions(
  decisions: readonly FailureOwnerDecision[],
): FailureOwnerDecision | undefined {
  if (decisions.length === 0) return undefined;
  return [...decisions].sort((left, right) => {
    return failureOwnerRank(left) - failureOwnerRank(right)
      || (right.confidence ?? 0) - (left.confidence ?? 0)
      || left.owner.localeCompare(right.owner)
      || left.nextStep.localeCompare(right.nextStep)
      || left.reason.localeCompare(right.reason);
  })[0];
}

function failureOwnerRank(decision: FailureOwnerDecision): number {
  return failureNextStepOrder.indexOf(decision.nextStep) * 10 + failureOwnerOrder.indexOf(decision.owner);
}

const failureNextStepOrder: FailureOwnerNextStep[] = [
  'fail-closed',
  'needs-human',
  'fix-runtime',
  'repair-payload',
  'repair-backend',
  'supplement-verification',
  'fix-presentation',
  'retry-provider',
  'degraded-result',
];

const failureOwnerOrder: FailureOwnerLayer[] = [
  'runtime-runner',
  'payload-contract',
  'backend-generation',
  'verification',
  'ui-presentation',
  'external-provider',
  'unknown',
];

function isOwnerDecision(value: FailureOwnerDecision | undefined): value is FailureOwnerDecision {
  return Boolean(value);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
