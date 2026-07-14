/** Renderer-safe, bounded snapshots emitted by the BioGym design controller. */
export type BioGymWorkflow =
  | 'de_novo_scaffold'
  | 'fixed_backbone'
  | 'target_binder'

export type BioGymRunStatus =
  | 'starting'
  | 'running'
  | 'awaiting_agent'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'indeterminate'

export type BioGymStageKind = 'backbone' | 'sequence' | 'verify' | 'binder'

export type BioGymStageStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'indeterminate'

export type BioGymCandidateSummary = {
  id: string
  label: string
  assetId?: string
  relativePath?: string
  score?: number
  scoreLabel?: string
  metrics?: Record<string, number | string | null>
}

export type BioGymStageAttemptSnapshot = {
  id: string
  kind: BioGymStageKind
  attempt: number
  status: BioGymStageStatus
  backend?: string
  startedAt?: string
  completedAt?: string
  candidateCount: number
  activeCandidateId?: string
  assetIds: string[]
  candidates: BioGymCandidateSummary[]
  error?: string
}

export type BioGymBudgetSnapshot = {
  maxGpuJobs: number
  usedGpuJobs: number
  remainingGpuJobs: number
  maxWallclockHours: number
  elapsedSeconds: number
}

export type BioGymRunSnapshot = {
  designRunId: string
  roomId: string
  workflow: BioGymWorkflow
  objective: string
  status: BioGymRunStatus
  revision: number
  currentStageAttemptId?: string
  stages: BioGymStageAttemptSnapshot[]
  budget: BioGymBudgetSnapshot
  updatedAt: string
}

export type BioGymRunEventType =
  | 'snapshot'
  | 'stage_terminal'
  | 'artifact_ready'
  | 'run_status'

/**
 * Full snapshots make events independently useful after reconnect and avoid a
 * second renderer-to-controller query. Paths are workspace-relative.
 */
export type BioGymRunEvent = {
  type: BioGymRunEventType
  eventId: string
  emittedAt: string
  workspaceRoot: string
  threadId: string
  designRunId: string
  roomId: string
  revision: number
  activeCandidateId?: string
  activeAssetId?: string
  activeAssetPath?: string
  snapshot: BioGymRunSnapshot
}

export const BIOGYM_RUN_EVENT_CHANNEL = 'biogym:run-event'

export type BioGymDoctorResult = {
  ok: boolean
  message: string
  details?: unknown
}
