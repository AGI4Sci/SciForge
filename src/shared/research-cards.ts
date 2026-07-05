export const RESEARCH_CARD_SCHEMA_VERSION = 1

export const RESEARCH_CARD_KINDS = [
  'source_triage',
  'evidence_item',
  'hypothesis',
  'claim',
  'method_choice',
  'protocol_step',
  'quality_issue',
  'artifact_review',
  'approval_gate',
  'next_action'
] as const

export type ResearchCardKind = typeof RESEARCH_CARD_KINDS[number]

export const RESEARCH_CARD_STATUSES = [
  'open',
  'needs_evidence',
  'needs_review',
  'approved',
  'rejected',
  'superseded',
  'done'
] as const

export type ResearchCardStatus = typeof RESEARCH_CARD_STATUSES[number]

export const RESEARCH_CARD_STAGE_BY_KIND = {
  source_triage: ['new', 'shortlisted', 'accepted', 'deferred', 'rejected', 'routed'],
  evidence_item: ['captured', 'needs_source', 'verified', 'disputed', 'superseded'],
  hypothesis: ['proposed', 'evidence_needed', 'supported', 'contested', 'approved', 'dropped'],
  claim: ['draft', 'evidence_needed', 'supported', 'inserted', 'reviewer_flagged', 'rejected'],
  method_choice: ['proposed', 'comparing', 'selected', 'rejected', 'superseded'],
  protocol_step: ['draft', 'needs_controls', 'ready_for_review', 'approved', 'executed', 'blocked'],
  quality_issue: ['open', 'investigating', 'resolved', 'waived', 'escalated'],
  artifact_review: ['generated', 'needs_revision', 'approved', 'exported', 'rejected'],
  approval_gate: ['pending', 'approved', 'rejected', 'expired'],
  next_action: ['open', 'in_progress', 'blocked', 'done', 'dropped']
} as const

export type ResearchCardStageByKind = {
  [K in ResearchCardKind]: typeof RESEARCH_CARD_STAGE_BY_KIND[K][number]
}

export type ResearchCardStage = ResearchCardStageByKind[ResearchCardKind]

export const RESEARCH_CARD_STAGES = [
  ...RESEARCH_CARD_STAGE_BY_KIND.source_triage,
  ...RESEARCH_CARD_STAGE_BY_KIND.evidence_item,
  ...RESEARCH_CARD_STAGE_BY_KIND.hypothesis,
  ...RESEARCH_CARD_STAGE_BY_KIND.claim,
  ...RESEARCH_CARD_STAGE_BY_KIND.method_choice,
  ...RESEARCH_CARD_STAGE_BY_KIND.protocol_step,
  ...RESEARCH_CARD_STAGE_BY_KIND.quality_issue,
  ...RESEARCH_CARD_STAGE_BY_KIND.artifact_review,
  ...RESEARCH_CARD_STAGE_BY_KIND.approval_gate,
  ...RESEARCH_CARD_STAGE_BY_KIND.next_action
] as const

export const RESEARCH_CARD_DEFAULT_STAGE = {
  source_triage: 'new',
  evidence_item: 'captured',
  hypothesis: 'proposed',
  claim: 'draft',
  method_choice: 'proposed',
  protocol_step: 'draft',
  quality_issue: 'open',
  artifact_review: 'generated',
  approval_gate: 'pending',
  next_action: 'open'
} as const satisfies { [K in ResearchCardKind]: ResearchCardStageByKind[K] }

export const RESEARCH_CARD_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const
export type ResearchCardPriority = typeof RESEARCH_CARD_PRIORITIES[number]

export const RESEARCH_CARD_REF_KINDS = [
  'paper',
  'dataset',
  'file',
  'evidence',
  'artifact',
  'card',
  'thread',
  'turn',
  'workflow',
  'url',
  'other'
] as const

export type ResearchCardRefKind = typeof RESEARCH_CARD_REF_KINDS[number]

export type ResearchCardRef = {
  kind: ResearchCardRefKind
  id: string
  label?: string
  uri?: string
  metadata?: Record<string, unknown>
}

export const RESEARCH_CARD_ORIGINS = [
  'manual',
  'chat',
  'paper_radar',
  'workflow',
  'canvas',
  'ppt_master',
  'write_assist',
  'scientific_plotting',
  'evidence_dag',
  'model_router',
  'other'
] as const

export type ResearchCardOriginKind = typeof RESEARCH_CARD_ORIGINS[number]

export type ResearchCardOrigin = {
  kind: ResearchCardOriginKind
  id?: string
  label?: string
}

export const RESEARCH_CARD_DECISIONS = [
  'accept',
  'defer',
  'reject',
  'revise',
  'approve',
  'request_changes',
  'route',
  'drop',
  'complete'
] as const

export type ResearchCardDecisionValue = typeof RESEARCH_CARD_DECISIONS[number]

export type ResearchCardDecision = {
  value: ResearchCardDecisionValue
  reason?: string
  decidedBy?: string
  decidedAt: string
}

export type ResearchCard = {
  schemaVersion: typeof RESEARCH_CARD_SCHEMA_VERSION
  id: string
  kind: ResearchCardKind
  title: string
  summary?: string
  status: ResearchCardStatus
  stage: ResearchCardStage
  priority: ResearchCardPriority
  workspaceRoot?: string
  runtimeId?: 'sciforge' | 'codex' | 'claude'
  threadId?: string
  turnId?: string
  evidenceRefs: ResearchCardRef[]
  artifactRefs: ResearchCardRef[]
  sourceRefs: ResearchCardRef[]
  relatedCardIds: string[]
  tags: string[]
  decision?: ResearchCardDecision
  nextAction?: string
  createdFrom: ResearchCardOrigin
  metadata?: Record<string, unknown>
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export type ResearchCardListInput = {
  workspaceRoot?: string
  kind?: ResearchCardKind
  status?: ResearchCardStatus
  stage?: ResearchCardStage
  threadId?: string
  query?: string
  tags?: string[]
  includeArchived?: boolean
  limit?: number
}

export type ResearchCardCreateInput = {
  id?: string
  kind: ResearchCardKind
  title: string
  summary?: string
  status?: ResearchCardStatus
  stage?: ResearchCardStage
  priority?: ResearchCardPriority
  workspaceRoot?: string
  runtimeId?: 'sciforge' | 'codex' | 'claude'
  threadId?: string
  turnId?: string
  evidenceRefs?: ResearchCardRef[]
  artifactRefs?: ResearchCardRef[]
  sourceRefs?: ResearchCardRef[]
  relatedCardIds?: string[]
  tags?: string[]
  decision?: ResearchCardDecision
  nextAction?: string
  createdFrom?: ResearchCardOrigin
  metadata?: Record<string, unknown>
}

export type ResearchCardUpdatePatch = Partial<{
  title: string
  summary: string | null
  status: ResearchCardStatus
  stage: ResearchCardStage
  priority: ResearchCardPriority
  workspaceRoot: string | null
  runtimeId: 'sciforge' | 'codex' | 'claude' | null
  threadId: string | null
  turnId: string | null
  evidenceRefs: ResearchCardRef[]
  artifactRefs: ResearchCardRef[]
  sourceRefs: ResearchCardRef[]
  relatedCardIds: string[]
  tags: string[]
  decision: ResearchCardDecision | null
  nextAction: string | null
  createdFrom: ResearchCardOrigin
  metadata: Record<string, unknown> | null
  archived: boolean
}>

export type ResearchCardUpdateInput = {
  cardId: string
  patch: ResearchCardUpdatePatch
}

export type ResearchCardArchiveInput = {
  cardId: string
  archived?: boolean
}

export function defaultResearchCardStage(kind: ResearchCardKind): ResearchCardStage {
  return RESEARCH_CARD_DEFAULT_STAGE[kind]
}

export function isResearchCardStageForKind(
  kind: ResearchCardKind,
  stage: ResearchCardStage
): boolean {
  return (RESEARCH_CARD_STAGE_BY_KIND[kind] as readonly string[]).includes(stage)
}
