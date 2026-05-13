import type { ContractResult, FailureOwnerDecision, FailureOwnerNextStep } from './contract-fns';

export type HookDecisionKind = 'continue' | 'tighten' | 'block' | 'defer' | 'needs-human';

export type HookFn<Facts, Decision> = (
  facts: Readonly<Facts>,
  prior: readonly ContractResult<unknown>[],
) => HookDecision<Decision>;

export interface HookAuditNote {
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceHookId?: string;
}

export interface HookDecision<Decision> {
  kind: HookDecisionKind;
  decision?: Decision;
  ownerDecision?: FailureOwnerDecision;
  auditNotes: HookAuditNote[];
  requiredRefs: string[];
  blockedRefs: string[];
  blockedCapabilities: string[];
  hookId?: string;
}

export interface FailureOwnerRouteDecision {
  action: FailureOwnerNextStep;
  retryable: boolean;
  owner: FailureOwnerDecision['owner'];
  evidenceRefs: string[];
  reason: string;
}

export function hookContinue<Decision>(
  decision?: Decision,
  options: Partial<Omit<HookDecision<Decision>, 'kind' | 'decision'>> = {},
): HookDecision<Decision> {
  return normalizeHookDecision({
    auditNotes: [],
    requiredRefs: [],
    blockedRefs: [],
    blockedCapabilities: [],
    ...options,
    kind: 'continue',
    decision,
  });
}

export function hookTighten<Decision>(
  decision: Decision,
  options: Partial<Omit<HookDecision<Decision>, 'kind' | 'decision'>> = {},
): HookDecision<Decision> {
  return normalizeHookDecision({
    auditNotes: [],
    requiredRefs: [],
    blockedRefs: [],
    blockedCapabilities: [],
    ...options,
    kind: 'tighten',
    decision,
  });
}

export function hookBlock<Decision = never>(
  reason: string,
  options: Partial<Omit<HookDecision<Decision>, 'kind' | 'auditNotes'>> = {},
): HookDecision<Decision> {
  return normalizeHookDecision({
    requiredRefs: [],
    blockedRefs: [],
    blockedCapabilities: [],
    ...options,
    kind: 'block',
    auditNotes: [{ severity: 'error', message: reason, sourceHookId: options.hookId }],
  });
}

export function normalizeHookDecision<Decision>(decision: HookDecision<Decision>): HookDecision<Decision> {
  return {
    ...decision,
    auditNotes: [...(decision.auditNotes ?? [])].sort((left, right) => {
      const severityOrder: HookAuditNote['severity'][] = ['error', 'warning', 'info'];
      return severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity)
        || (left.sourceHookId ?? '').localeCompare(right.sourceHookId ?? '')
        || left.message.localeCompare(right.message);
    }),
    requiredRefs: sortedUnique(decision.requiredRefs ?? []),
    blockedRefs: sortedUnique(decision.blockedRefs ?? []),
    blockedCapabilities: sortedUnique(decision.blockedCapabilities ?? []),
    ownerDecision: decision.ownerDecision
      ? { ...decision.ownerDecision, evidenceRefs: sortedUnique(decision.ownerDecision.evidenceRefs) }
      : undefined,
  };
}

export const failureOwnerRouteHook: HookFn<unknown, FailureOwnerRouteDecision> = (_facts, prior) => {
  const ownerDecision = mostRecentFailureOwner(prior);
  if (!ownerDecision) {
    return hookContinue({
      action: 'needs-human',
      retryable: false,
      owner: 'unknown',
      evidenceRefs: [],
      reason: 'No failure owner decision was available in prior contract results.',
    }, {
      hookId: 'failure-owner-route-hook',
      auditNotes: [{
        severity: 'warning',
        message: 'No failure owner decision was available in prior contract results.',
        sourceHookId: 'failure-owner-route-hook',
      }],
    });
  }

  const kind: HookDecisionKind = ownerDecision.nextStep === 'needs-human' || ownerDecision.nextStep === 'fail-closed'
    ? 'needs-human'
    : ownerDecision.nextStep === 'retry-provider' || ownerDecision.nextStep === 'degraded-result'
      ? 'defer'
      : 'tighten';

  return normalizeHookDecision({
    kind,
    hookId: 'failure-owner-route-hook',
    ownerDecision,
    decision: {
      action: ownerDecision.nextStep,
      retryable: ownerDecision.retryable,
      owner: ownerDecision.owner,
      evidenceRefs: ownerDecision.evidenceRefs,
      reason: ownerDecision.reason,
    },
    auditNotes: [{
      severity: ownerDecision.owner === 'unknown' ? 'warning' : 'info',
      message: `Routed ${ownerDecision.owner} to ${ownerDecision.nextStep}.`,
      sourceHookId: 'failure-owner-route-hook',
    }],
    requiredRefs: ownerDecision.evidenceRefs,
    blockedRefs: [],
    blockedCapabilities: ownerDecision.owner === 'external-provider' ? ['backend-code-repair'] : [],
  });
};

export function mostRecentFailureOwner(prior: readonly ContractResult<unknown>[]): FailureOwnerDecision | undefined {
  for (let index = prior.length - 1; index >= 0; index -= 1) {
    const ownerDecision = prior[index]?.ownerDecision;
    if (ownerDecision) return ownerDecision;
  }
  return undefined;
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
