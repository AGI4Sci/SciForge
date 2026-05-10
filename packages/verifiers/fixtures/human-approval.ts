import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';

export type HumanApprovalDecisionKind = 'accept' | 'reject' | 'revise' | 'score' | 'timeout' | 'ambiguous';
export type HumanApprovalVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human';

export interface HumanApprovalVerificationPolicy {
  required: boolean;
  mode: 'human' | 'hybrid';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface HumanApprovalDecision {
  decision: HumanApprovalDecisionKind;
  decisionRef?: string;
  approverRef?: string;
  score?: number;
  confidence?: number;
  comment?: string;
  evidenceRefs?: string[];
  repairHints?: string[];
}

export interface HumanApprovalVerifierRequest {
  goal: string;
  resultRefs: string[];
  artifactRefs: string[];
  traceRefs: string[];
  stateRefs?: string[];
  rubric?: string;
  verificationPolicy: HumanApprovalVerificationPolicy;
  decision?: HumanApprovalDecision;
  providerHints?: Record<string, unknown>;
}

export interface HumanApprovalVerifierResult {
  schemaVersion: 'sciforge.verification.result.v1';
  resultRef: string;
  verifierId: string;
  verdict: HumanApprovalVerdict;
  reward?: number;
  confidence: number;
  critique?: string;
  evidenceRefs: string[];
  repairHints: string[];
  auditRefs: string[];
  budgetDebitRefs: string[];
  budgetDebits: CapabilityInvocationBudgetDebitRecord[];
  diagnostics?: Record<string, unknown>;
}

export interface HumanApprovalProvider {
  id: string;
  verify(request: HumanApprovalVerifierRequest): Promise<HumanApprovalVerifierResult>;
}

export function createHumanApprovalFixtureProvider(id = 'fixture.human-approval'): HumanApprovalProvider {
  return {
    id,
    async verify(request) {
      const decision = normalizeDecision(request.decision);
      const verdict = verdictForDecision(decision);
      const reward = rewardForDecision(decision, verdict);
      const confidence = confidenceForDecision(decision, verdict);
      const refs = humanApprovalRefs(id, request, decision, verdict);
      const evidenceRefs = uniqueStrings([
        ...request.resultRefs,
        ...request.artifactRefs,
        ...request.traceRefs,
        ...(request.stateRefs ?? []),
        ...(decision.evidenceRefs ?? []),
      ]);
      const repairHints = repairHintsForDecision(decision, verdict);
      const budgetDebit = humanApprovalBudgetDebit({
        providerId: id,
        request,
        decision,
        resultRef: refs.resultRef,
        auditRef: refs.auditRef,
        verdict,
        evidenceRefs,
      });

      return {
        schemaVersion: 'sciforge.verification.result.v1',
        resultRef: refs.resultRef,
        verifierId: id,
        verdict,
        reward,
        confidence,
        critique: decision.comment,
        evidenceRefs,
        repairHints,
        auditRefs: [refs.auditRef],
        budgetDebitRefs: [budgetDebit.debitId],
        budgetDebits: [budgetDebit],
        diagnostics: {
          provider: 'human-approval-fixture',
          decision: decision.decision,
          decisionRef: decision.decisionRef,
          approverRef: decision.approverRef,
          riskLevel: request.verificationPolicy.riskLevel,
          invocationRef: refs.invocationRef,
        },
      };
    },
  };
}

function humanApprovalBudgetDebit(input: {
  providerId: string;
  request: HumanApprovalVerifierRequest;
  decision: HumanApprovalDecision;
  resultRef: string;
  auditRef: string;
  verdict: HumanApprovalVerdict;
  evidenceRefs: string[];
}) {
  const debitLines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'providers',
      amount: 1,
      limit: numericHint(input.request.providerHints, 'maxVerifierProviders'),
      remaining: remainingAfter(numericHint(input.request.providerHints, 'maxVerifierProviders'), 1),
      reason: 'human approval verifier provider was invoked',
      sourceRef: `verifier-provider:${input.providerId}`,
    },
    {
      dimension: 'costUnits',
      amount: 1,
      limit: numericHint(input.request.providerHints, 'maxVerifierCostUnits'),
      remaining: remainingAfter(numericHint(input.request.providerHints, 'maxVerifierCostUnits'), 1),
      reason: 'human approval decision was mapped to a verifier result',
      sourceRef: input.decision.decisionRef ?? `human-approval:${input.providerId}`,
    },
  ];
  const slug = input.resultRef.split(':').at(-1) ?? 'unknown';

  return createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:human-approval:${slug}`,
    invocationId: `capabilityInvocation:human-approval:${slug}`,
    capabilityId: 'verifier.fixture.human-approval',
    candidateId: 'verifier.fixture.human-approval',
    manifestRef: 'capability:verifier.fixture.human-approval',
    subjectRefs: uniqueStrings([
      input.resultRef,
      ...input.evidenceRefs,
      input.decision.decisionRef ?? '',
      input.decision.approverRef ?? '',
    ]),
    debitLines,
    sinkRefs: {
      auditRefs: [input.auditRef],
    },
    metadata: {
      verifierId: input.providerId,
      verdict: input.verdict,
      decision: input.decision.decision,
      decisionRef: input.decision.decisionRef,
      riskLevel: input.request.verificationPolicy.riskLevel,
    },
  });
}

function humanApprovalRefs(
  providerId: string,
  request: HumanApprovalVerifierRequest,
  decision: HumanApprovalDecision,
  verdict: HumanApprovalVerdict,
) {
  const slug = stableSlug([
    providerId,
    request.goal,
    request.verificationPolicy.mode,
    request.verificationPolicy.riskLevel,
    verdict,
    decision.decision,
    decision.decisionRef ?? '',
    ...request.resultRefs,
    ...request.artifactRefs,
    ...request.traceRefs,
    ...(request.stateRefs ?? []),
    ...(decision.evidenceRefs ?? []),
  ]);
  return {
    resultRef: `verifier-result:human-approval:${slug}`,
    auditRef: `audit:human-approval-verifier:${slug}`,
    invocationRef: `capabilityInvocation:human-approval:${slug}`,
  };
}

function normalizeDecision(decision: HumanApprovalDecision | undefined): HumanApprovalDecision {
  return decision ?? {
    decision: 'timeout',
    repairHints: ['Collect explicit human approval before completing verification.'],
  };
}

function verdictForDecision(decision: HumanApprovalDecision): HumanApprovalVerdict {
  if (decision.decision === 'accept') return 'pass';
  if (decision.decision === 'reject') return 'fail';
  if (decision.decision === 'revise' || decision.decision === 'timeout') return 'needs-human';
  if (decision.decision === 'score') {
    const score = boundedScore(decision.score);
    if (score === undefined) return 'uncertain';
    if (score >= 0.8) return 'pass';
    if (score < 0.5) return 'fail';
    return 'needs-human';
  }
  return 'uncertain';
}

function rewardForDecision(decision: HumanApprovalDecision, verdict: HumanApprovalVerdict): number | undefined {
  const score = boundedScore(decision.score);
  if (score !== undefined) return score;
  if (verdict === 'pass') return 1;
  if (verdict === 'fail') return 0;
  return undefined;
}

function confidenceForDecision(decision: HumanApprovalDecision, verdict: HumanApprovalVerdict): number {
  const confidence = boundedScore(decision.confidence);
  if (confidence !== undefined) return confidence;
  if (verdict === 'pass' || verdict === 'fail') return 0.95;
  if (verdict === 'needs-human') return 0.6;
  return 0.4;
}

function repairHintsForDecision(decision: HumanApprovalDecision, verdict: HumanApprovalVerdict): string[] {
  if (decision.repairHints?.length) return uniqueStrings(decision.repairHints);
  if (verdict === 'pass') return [];
  if (decision.decision === 'timeout') return ['Collect explicit human approval before completing verification.'];
  if (decision.decision === 'revise') return ['Address the requested revision and request human approval again.'];
  if (decision.decision === 'ambiguous') return ['Clarify the human approval decision before closing verification.'];
  if (verdict === 'fail') return ['Treat the rejected result as failed verification and repair before retrying.'];
  return ['Request human approval again with clearer evidence refs.'];
}

function boundedScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function numericHint(hints: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = hints?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function remainingAfter(limit: number | undefined, amount: number): number | undefined {
  return typeof limit === 'number' ? limit - amount : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stableSlug(parts: string[]) {
  const input = parts.join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
