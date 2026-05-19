import type { GatewayRequest } from '../runtime-types.js';

export function directDecision(
  intent: 'context-summary' | 'context-summary:risk' | 'context-summary:method' | 'context-summary:timeline' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown' = 'context-summary',
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 'sciforge.direct-context-decision.v1',
    decisionRef: `decision:test-${intent}`,
    decisionOwner: 'agentserver',
    intent,
    requiredTypedContext: intent === 'capability-status'
      ? ['capability-registry', 'provider-registry']
      : ['current-session-context'],
    usedRefs: ['artifact:research-report'],
    sufficiency: 'sufficient',
    allowDirectContext: true,
    ...overrides,
  };
}

export function appliedDirectContextPolicy(decision = directDecision()) {
  return {
    applicationStatus: 'applied',
    policySource: 'python-conversation-policy',
    directContextDecision: decision,
    harnessContract: { directContextDecision: decision },
    executionModePlan: { executionMode: 'direct-context-answer' },
    responsePlan: { initialResponseMode: 'direct-context-answer' },
    latencyPolicy: { blockOnContextCompaction: false },
  };
}

export function canonicalDirectDecision(
  intent: 'context-summary' | 'context-summary:risk' | 'context-summary:method' | 'context-summary:timeline' | 'run-diagnostic' | 'artifact-status' | 'capability-status' | 'fresh-execution' | 'unknown' = 'context-summary',
  overrides: Record<string, unknown> = {},
) {
  return {
    harnessContract: {
      directContextDecision: directDecision(intent, overrides),
    },
    directContextDecision: directDecision(intent, overrides),
  };
}
