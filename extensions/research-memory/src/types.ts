export const RESEARCH_MEMORY_TOOL_NAMES = [
  'research_memory_record_experiment',
  'research_memory_propose_insight',
  'research_memory_reflect_experiments',
  'research_memory_reflect_thread',
  'research_memory_resolve_context',
  'research_memory_review_item',
  'research_memory_snapshot'
] as const

export type ResearchMemoryToolName = typeof RESEARCH_MEMORY_TOOL_NAMES[number]

export type ExperimentRunStatus = 'completed' | 'failed' | 'aborted' | 'running'

export type ExperimentRun = {
  id: string
  projectId: string
  title: string
  status: ExperimentRunStatus
  command?: string
  scriptPath?: string
  datasetVersion?: string
  environment?: Record<string, unknown>
  parameters?: Record<string, unknown>
  seed?: number | string
  metrics?: Record<string, unknown>
  logsExcerpt?: string
  artifactRefs: string[]
  threadRef?: string
  turnRef?: string
  createdAt: string
  updatedAt: string
}

export type ExperimentRunDraft = Partial<Omit<ExperimentRun, 'id' | 'createdAt' | 'updatedAt' | 'artifactRefs'>> & {
  id?: string
  projectId?: string
  title: string
  status?: ExperimentRunStatus
  artifactRefs?: string[]
  metricsPath?: string
  logPath?: string
  artifactManifestPath?: string
}

export const MEMORY_ITEM_TYPES = [
  'experiment_insight',
  'negative_result',
  'method_choice',
  'analysis_insight',
  'debug_insight',
  'research_principle',
  'hypothesis',
  'metric_interpretation',
  'data_insight',
  'model_behavior_insight',
  'paper_claim',
  'figure_decision',
  'workflow_skill',
  'review_critique'
] as const

export type MemoryItemType = typeof MEMORY_ITEM_TYPES[number]

export type MemoryItemStatus =
  | 'candidate'
  | 'active'
  | 'hypothesis'
  | 'rejected'
  | 'invalidated'
  | 'superseded'

export type EvidenceLevel =
  | 'model_reflection'
  | 'discussion'
  | 'log_supported'
  | 'metric_supported'
  | 'artifact_supported'
  | 'multi_run_supported'
  | 'human_approved'

export type MemoryItem = {
  id: string
  projectId: string
  type: MemoryItemType
  status: MemoryItemStatus
  claim: string
  rationale?: string
  recommendedAction?: string
  applicability?: Record<string, unknown>
  evidenceRefs: string[]
  sourceRunIds: string[]
  sourceThreadRefs: string[]
  confidence: number
  evidenceLevel: EvidenceLevel
  reviewReason?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type MemoryItemDraft = {
  projectId?: string
  type: MemoryItemType
  claim: string
  rationale?: string
  recommendedAction?: string
  applicability?: Record<string, unknown>
  evidenceRefs?: string[]
  sourceRunIds?: string[]
  sourceThreadRefs?: string[]
  confidence?: number
  metadata?: Record<string, unknown>
}

export type MemoryReviewAction =
  | 'approve'
  | 'reject'
  | 'invalidate'
  | 'supersede'
  | 'mark_hypothesis'

export type MemoryPacket = Pick<
  MemoryItem,
  | 'id'
  | 'type'
  | 'status'
  | 'claim'
  | 'rationale'
  | 'recommendedAction'
  | 'confidence'
  | 'evidenceLevel'
  | 'evidenceRefs'
  | 'sourceRunIds'
>

export type ResolveContextInput = {
  projectId?: string
  query: string
  budgetChars?: number
  includeHypotheses?: boolean
}

export type ResolveContextOutput = {
  relevantInsights: MemoryPacket[]
  negativeResults: MemoryPacket[]
  methodChoices: MemoryPacket[]
  hypotheses: MemoryPacket[]
  evidenceRefs: string[]
  warnings: string[]
}

export type ReflectionOutput = {
  created: MemoryItem[]
  activeCount: number
  candidateCount: number
  hypothesisCount: number
}

export type ResearchMemoryServiceOptions = {
  workspaceRoot: string
  projectId?: string
  sqlitePath?: string
  nowIso?: () => string
  idGenerator?: (prefix: string) => string
}

export type ResearchMemoryExtensionManifest = {
  id: string
  name: string
  kind: 'project-extension'
  activation: string[]
  storage: string
  headless: boolean
  runtimeModule?: string
  contributes?: {
    agentTools?: string[]
    skills?: string[]
  }
}
