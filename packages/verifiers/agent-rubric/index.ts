import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';

export type AgentVerifierVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';

export interface AgentVerifierRubricCriterion {
  id: string;
  description: string;
  weight: number;
  requiredEvidenceKinds?: Array<'artifact' | 'trace' | 'result' | 'state'>;
}

export interface AgentVerifierRubric {
  id: string;
  version: string;
  summary: string;
  criteria: AgentVerifierRubricCriterion[];
  passThreshold: number;
  needsHumanThreshold?: number;
}

export interface AgentVerifierRequest {
  goal: string;
  resultRefs: string[];
  artifactRefs: string[];
  traceRefs: string[];
  stateRefs?: string[];
  rubric: AgentVerifierRubric;
  providerHints?: Record<string, unknown>;
}

export interface AgentVerifierCriterionScore {
  criterionId: string;
  reward: number;
  confidence: number;
  critique: string;
  evidenceRefs: string[];
  repairHints: string[];
}

export interface AgentVerifierResult {
  schemaVersion: 'sciforge.agent-verifier-rubric.v1';
  resultRef: string;
  verifierId: string;
  verdict: AgentVerifierVerdict;
  reward: number;
  confidence: number;
  critique: string;
  evidenceRefs: string[];
  repairHints: string[];
  criterionScores: AgentVerifierCriterionScore[];
  auditRefs: string[];
  budgetDebitRefs: string[];
  budgetDebits: CapabilityInvocationBudgetDebitRecord[];
  diagnostics?: Record<string, unknown>;
}

export interface AgentVerifierProvider {
  id: string;
  verify(request: AgentVerifierRequest): Promise<AgentVerifierResult>;
}

export function createMockAgentVerifierProvider(id = 'mock.agent-verifier.rubric'): AgentVerifierProvider {
  return {
    id,
    async verify(request) {
      const scores = request.rubric.criteria.map((criterion) => scoreCriterion(request, criterion));
      const totalWeight = scores.reduce((sum, score) => sum + Math.max(0, weightFor(request.rubric, score.criterionId)), 0) || 1;
      const reward = scores.reduce((sum, score) => sum + score.reward * Math.max(0, weightFor(request.rubric, score.criterionId)), 0) / totalWeight;
      const confidence = scores.reduce((sum, score) => sum + score.confidence, 0) / Math.max(1, scores.length);
      const evidenceRefs = uniqueStrings(scores.flatMap((score) => score.evidenceRefs));
      const repairHints = uniqueStrings(scores.flatMap((score) => score.repairHints));
      const verdict = verdictForReward(reward, confidence, request.rubric);
      const refs = agentVerifierRefs(id, request, verdict);
      const budgetDebit = agentVerifierBudgetDebit({
        providerId: id,
        request,
        resultRef: refs.resultRef,
        auditRef: refs.auditRef,
        verdict,
        criterionScoreCount: scores.length,
        evidenceRefs,
      });
      return {
        schemaVersion: 'sciforge.agent-verifier-rubric.v1',
        resultRef: refs.resultRef,
        verifierId: id,
        verdict,
        reward,
        confidence,
        critique: scores.map((score) => score.critique).join('\n'),
        evidenceRefs,
        repairHints,
        criterionScores: scores,
        auditRefs: [refs.auditRef],
        budgetDebitRefs: [budgetDebit.debitId],
        budgetDebits: [budgetDebit],
        diagnostics: {
          provider: 'mock',
          rubricId: request.rubric.id,
          rubricVersion: request.rubric.version,
          invocationRef: refs.invocationRef,
        },
      };
    },
  };
}

function agentVerifierRefs(providerId: string, request: AgentVerifierRequest, verdict: AgentVerifierVerdict) {
  const slug = stableSlug([
    providerId,
    request.goal,
    request.rubric.id,
    request.rubric.version,
    verdict,
    ...request.resultRefs,
    ...request.artifactRefs,
    ...request.traceRefs,
    ...(request.stateRefs ?? []),
  ]);
  return {
    resultRef: `verifier-result:agent-rubric:${slug}`,
    auditRef: `audit:agent-rubric-verifier:${slug}`,
    invocationRef: `capabilityInvocation:agent-rubric:${slug}`,
  };
}

function agentVerifierBudgetDebit(input: {
  providerId: string;
  request: AgentVerifierRequest;
  resultRef: string;
  auditRef: string;
  verdict: AgentVerifierVerdict;
  criterionScoreCount: number;
  evidenceRefs: string[];
}) {
  const criterionScoreCount = Math.max(1, input.criterionScoreCount);
  const debitLines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'providers',
      amount: 1,
      limit: numericHint(input.request.providerHints, 'maxVerifierProviders'),
      remaining: remainingAfter(numericHint(input.request.providerHints, 'maxVerifierProviders'), 1),
      reason: 'agent rubric verifier provider was invoked',
      sourceRef: `verifier-provider:${input.providerId}`,
    },
    {
      dimension: 'costUnits',
      amount: criterionScoreCount,
      limit: numericHint(input.request.providerHints, 'maxVerifierCostUnits'),
      remaining: remainingAfter(numericHint(input.request.providerHints, 'maxVerifierCostUnits'), criterionScoreCount),
      reason: 'rubric criterion scores were evaluated',
      sourceRef: `rubric:${input.request.rubric.id}@${input.request.rubric.version}`,
    },
  ];

  return createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:agent-rubric:${input.resultRef.split(':').at(-1) ?? 'unknown'}`,
    invocationId: `capabilityInvocation:agent-rubric:${input.resultRef.split(':').at(-1) ?? 'unknown'}`,
    capabilityId: 'verifier.agent-rubric',
    candidateId: 'verifier.agent-rubric',
    manifestRef: 'capability:verifier.agent-rubric',
    subjectRefs: uniqueStrings([
      input.resultRef,
      `rubric:${input.request.rubric.id}@${input.request.rubric.version}`,
      ...input.request.resultRefs,
      ...input.request.artifactRefs,
      ...input.request.traceRefs,
      ...(input.request.stateRefs ?? []),
      ...input.evidenceRefs,
    ]),
    debitLines,
    sinkRefs: {
      auditRefs: [input.auditRef],
    },
    metadata: {
      verifierId: input.providerId,
      verdict: input.verdict,
      rubricId: input.request.rubric.id,
      rubricVersion: input.request.rubric.version,
      criterionScoreCount: input.criterionScoreCount,
    },
  });
}

function scoreCriterion(request: AgentVerifierRequest, criterion: AgentVerifierRubricCriterion): AgentVerifierCriterionScore {
  const evidenceRefs = evidenceRefsFor(request, criterion.requiredEvidenceKinds);
  const hasGoal = request.goal.trim().length > 0;
  const hasRequiredEvidence = !criterion.requiredEvidenceKinds?.length || evidenceRefs.length > 0;
  const reward = hasGoal && hasRequiredEvidence ? 1 : 0;
  return {
    criterionId: criterion.id,
    reward,
    confidence: hasRequiredEvidence ? 0.72 : 0.38,
    critique: reward === 1
      ? `${criterion.description}: evidence refs are available.`
      : `${criterion.description}: required evidence refs are missing or the goal is empty.`,
    evidenceRefs,
    repairHints: reward === 1 ? [] : [`补充 ${criterion.requiredEvidenceKinds?.join('/') || 'goal'} 证据后重新验证。`],
  };
}

function evidenceRefsFor(request: AgentVerifierRequest, kinds: AgentVerifierRubricCriterion['requiredEvidenceKinds'] = []) {
  const refs: string[] = [];
  if (kinds.includes('artifact')) refs.push(...request.artifactRefs);
  if (kinds.includes('trace')) refs.push(...request.traceRefs);
  if (kinds.includes('result')) refs.push(...request.resultRefs);
  if (kinds.includes('state')) refs.push(...(request.stateRefs ?? []));
  return uniqueStrings(refs);
}

function verdictForReward(reward: number, confidence: number, rubric: AgentVerifierRubric): AgentVerifierVerdict {
  if (confidence < 0.45) return 'uncertain';
  if (reward >= rubric.passThreshold) return 'pass';
  if (rubric.needsHumanThreshold !== undefined && reward >= rubric.needsHumanThreshold) return 'needs-human';
  return 'fail';
}

function weightFor(rubric: AgentVerifierRubric, criterionId: string) {
  return rubric.criteria.find((criterion) => criterion.id === criterionId)?.weight ?? 0;
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
