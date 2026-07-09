import type {
  EvidenceLevel,
  MemoryItemDraft,
  MemoryItemStatus,
  MemoryItemType
} from './types.js'

export type EvidenceGateDecision = {
  status: MemoryItemStatus
  evidenceLevel: EvidenceLevel
  confidence: number
  reviewReason?: string
}

const ANALYSIS_TYPES = new Set<MemoryItemType>([
  'analysis_insight',
  'debug_insight',
  'research_principle',
  'metric_interpretation',
  'data_insight',
  'model_behavior_insight',
  'paper_claim',
  'figure_decision',
  'workflow_skill',
  'review_critique'
])

export function decideEvidenceStatus(draft: MemoryItemDraft): EvidenceGateDecision {
  const evidenceRefs = uniqueStrings(draft.evidenceRefs ?? [])
  const sourceRunIds = uniqueStrings(draft.sourceRunIds ?? [])
  const confidence = clampConfidence(draft.confidence)
  const typedEvidence = evidenceKinds(evidenceRefs)
  const hasHumanApproval = typedEvidence.human
  const hasMetric = typedEvidence.metric
  const hasExperiment = typedEvidence.experiment || sourceRunIds.length > 0
  const hasArtifactOrLog = typedEvidence.artifact || typedEvidence.log
  const hasDiscussionEvidence = typedEvidence.thread || typedEvidence.turn
  const hasConcreteAnalysisEvidence = hasDiscussionEvidence || typedEvidence.file || typedEvidence.log

  if (hasHumanApproval) {
    return { status: 'active', evidenceLevel: 'human_approved', confidence: Math.max(confidence, 0.9) }
  }

  if (draft.type === 'hypothesis') {
    return {
      status: 'hypothesis',
      evidenceLevel: evidenceLevelFor(typedEvidence),
      confidence: Math.min(confidence, 0.55),
      reviewReason: 'Hypotheses require later experimental or human review before becoming active.'
    }
  }

  if (evidenceRefs.length === 0 && sourceRunIds.length === 0) {
    return {
      status: confidence < 0.45 ? 'hypothesis' : 'candidate',
      evidenceLevel: 'model_reflection',
      confidence: Math.min(confidence, 0.6),
      reviewReason: 'No evidence refs were supplied.'
    }
  }

  if (hasExperiment && hasMetric && hasArtifactOrLog) {
    const multiRun = sourceRunIds.length > 1 || evidenceRefs.filter((ref) => ref.startsWith('experiment:')).length > 1
    return {
      status: 'active',
      evidenceLevel: multiRun ? 'multi_run_supported' : 'metric_supported',
      confidence: Math.max(confidence, multiRun ? 0.82 : 0.72)
    }
  }

  if (ANALYSIS_TYPES.has(draft.type) && hasConcreteAnalysisEvidence) {
    return {
      status: 'candidate',
      evidenceLevel: evidenceLevelFor(typedEvidence),
      confidence: Math.max(Math.min(confidence, 0.7), 0.55),
      reviewReason: 'Analysis insights with concrete refs remain candidate until reviewed or experimentally supported.'
    }
  }

  return {
    status: 'candidate',
    evidenceLevel: evidenceLevelFor(typedEvidence),
    confidence: Math.min(Math.max(confidence, 0.5), 0.7),
    reviewReason: 'Evidence is traceable but not strong enough for active status.'
  }
}

function evidenceKinds(evidenceRefs: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const ref of evidenceRefs) {
    const kind = ref.split(':', 1)[0]?.trim()
    if (kind) out[kind] = true
  }
  return out
}

function evidenceLevelFor(kinds: Record<string, boolean>): EvidenceLevel {
  if (kinds.human) return 'human_approved'
  if (kinds.metric) return 'metric_supported'
  if (kinds.artifact) return 'artifact_supported'
  if (kinds.log) return 'log_supported'
  if (kinds.thread || kinds.turn || kinds.file) return 'discussion'
  return 'model_reflection'
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
