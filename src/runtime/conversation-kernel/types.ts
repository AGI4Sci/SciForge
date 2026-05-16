export type ConversationKernelStatus =
  | 'idle'
  | 'planned'
  | 'dispatched'
  | 'partial-ready'
  | 'output-materialized'
  | 'validated'
  | 'satisfied'
  | 'degraded-result'
  | 'external-blocked'
  | 'repair-needed'
  | 'needs-human'
  | 'background-running';

export type ConversationHistoryEditMode = 'revert' | 'continue';

export type FailureOwnerLayer =
  | 'external-provider'
  | 'payload-contract'
  | 'runtime-runner'
  | 'backend-generation'
  | 'verification'
  | 'ui-presentation';

export type FailureOwnerAction =
  | 'retry-after-backoff'
  | 'repair-rerun'
  | 'supplement'
  | 'ask-user'
  | 'needs-human'
  | 'fail-closed';

export interface ConversationRef {
  ref: string;
  digest?: string;
  mime?: string;
  sizeBytes?: number;
  label?: string;
}

export interface CrossSessionRef {
  schemaVersion: 'sciforge.cross-session-ref.v1';
  sourceSessionId: string;
  sourceRef: string;
  targetSessionId: string;
  importedRef: string;
  digest: string;
  mime?: string;
  sizeBytes?: number;
  reason?: string;
}

export interface InlineEventPayload {
  [key: string]: unknown;
}

export interface RefEventPayload {
  refs: ConversationRef[];
  summary?: string;
  [key: string]: unknown;
}

export interface ExplicitImportEventPayload extends RefEventPayload {
  schemaVersion: 'sciforge.explicit-import-event.v1';
  imports: CrossSessionRef[];
  reason: string;
}

export interface ConversationEventBase {
  id: string;
  type: ConversationEventType;
  timestamp: string;
  actor: 'user' | 'kernel' | 'backend' | 'runtime' | 'verifier' | 'ui';
  turnId?: string;
  runId?: string;
  causationId?: string;
}

export interface InlineConversationEvent extends ConversationEventBase {
  storage: 'inline';
  payload: InlineEventPayload;
}

export interface RefConversationEvent extends ConversationEventBase {
  storage: 'ref';
  payload: RefEventPayload;
}

export type ConversationEvent = InlineConversationEvent | RefConversationEvent;

export type ConversationEventType =
  | 'TurnReceived'
  | 'Planned'
  | 'HarnessDecisionRecorded'
  | 'ExplicitImportRecorded'
  | 'Dispatched'
  | 'PartialReady'
  | 'OutputMaterialized'
  | 'Validated'
  | 'Satisfied'
  | 'DegradedResult'
  | 'ExternalBlocked'
  | 'RepairNeeded'
  | 'NeedsHuman'
  | 'RefArchived'
  | 'RefPinned'
  | 'RefDeleted'
  | 'RefTombstoned'
  | 'HistoryEdited'
  | 'BackgroundRunning'
  | 'BackgroundCompleted'
  | 'VerificationRecorded'
  | 'RunStatusRecorded'
  | 'RunCheckpointRecorded';

export interface ConversationEventLog {
  schemaVersion: 'sciforge.conversation-event-log.v1';
  conversationId: string;
  events: ConversationEvent[];
}

export interface EventAppendResult {
  log: ConversationEventLog;
  rejected?: ConversationKernelDiagnostic;
}

export interface ConversationKernelDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  eventId?: string;
  refs?: ConversationRef[];
}

export interface FailureOwnerDecision {
  ownerLayer: FailureOwnerLayer;
  action: FailureOwnerAction;
  retryable: boolean;
  reason: string;
  evidenceRefs: string[];
  nextStep: string;
}

export interface ConversationState {
  schemaVersion: 'sciforge.conversation-state.v1';
  conversationId: string;
  status: ConversationKernelStatus;
  currentTurnId?: string;
  activeRunId?: string;
  terminal: boolean;
  diagnostics: ConversationKernelDiagnostic[];
  failureOwner?: FailureOwnerDecision;
  verification?: VerificationState;
  background?: BackgroundState;
  historyEdit?: HistoryEditState;
  harnessDecision?: HarnessDecisionState;
}

export interface VerificationState {
  status: 'unverified' | 'verified' | 'failed' | 'not-required';
  verifierRef?: string;
  verdict?: string;
}

export interface BackgroundState {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  checkpointRefs: string[];
  revisionPlan: string;
  foregroundPartialRef?: string;
}

export interface HistoryEditState {
  schemaVersion: 'sciforge.conversation-history-edit.v1';
  branchId: string;
  mode: ConversationHistoryEditMode;
  sourceMessageRef: string;
  boundaryAt: string;
  invalidatedRefs: string[];
  affectedRefs: string[];
  projectionInvalidated: boolean;
  requiresUserConfirmation: boolean;
  nextStep: string;
}

export interface HarnessDecisionState {
  schemaVersion: 'sciforge.harness-decision-record.v1';
  decisionId: string;
  profileId: string;
  digest: string;
  summary?: string;
  refs: string[];
  contractRef?: string;
  traceRef?: string;
  source?: string;
}

export interface ConversationProjection {
  schemaVersion: 'sciforge.conversation-projection.v1';
  conversationId: string;
  projectionVersion?: number;
  currentTurn?: {
    id: string;
    prompt?: string;
  };
  visibleAnswer?: {
    status: ConversationKernelStatus;
    text?: string;
    artifactRefs: string[];
    diagnostic?: string;
  };
  activeRun?: {
    id: string;
    status: ConversationKernelStatus;
  };
  artifacts: ConversationRef[];
  executionProcess: Array<{
    eventId: string;
    type: ConversationEventType;
    summary: string;
    timestamp: string;
  }>;
  recoverActions: string[];
  verificationState: VerificationState;
  backgroundState?: BackgroundState;
  historyEdit?: HistoryEditState;
  harnessDecision?: HarnessDecisionState;
  auditRefs: string[];
  diagnostics: ConversationKernelDiagnostic[];
}

export interface MaterializedResultLike {
  status?: unknown;
  text?: unknown;
  artifactRefs?: unknown;
  evidenceRefs?: unknown;
  verificationRef?: unknown;
  failureReason?: unknown;
  error?: unknown;
  nextStep?: unknown;
}
