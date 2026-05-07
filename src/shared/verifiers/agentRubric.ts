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
  verifierId: string;
  verdict: AgentVerifierVerdict;
  reward: number;
  confidence: number;
  critique: string;
  evidenceRefs: string[];
  repairHints: string[];
  criterionScores: AgentVerifierCriterionScore[];
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
      return {
        schemaVersion: 'sciforge.agent-verifier-rubric.v1',
        verifierId: id,
        verdict: verdictForReward(reward, confidence, request.rubric),
        reward,
        confidence,
        critique: scores.map((score) => score.critique).join('\n'),
        evidenceRefs,
        repairHints,
        criterionScores: scores,
        diagnostics: {
          provider: 'mock',
          rubricId: request.rubric.id,
          rubricVersion: request.rubric.version,
        },
      };
    },
  };
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
