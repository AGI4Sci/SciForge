import type { ReactNode } from 'react';

export {
  RUNTIME_AGENTSERVER_MANAGED_COMPACTION_BACKENDS,
  SUPPORTED_RUNTIME_AGENT_BACKENDS,
  compactCapabilityForAgentBackend,
  estimateRuntimeAgentBackendModelContextWindow,
  fallbackCompactCapabilityForRuntimeAgentBackend,
  normalizeRuntimeLlmEndpoint,
  normalizeRuntimeAgentBackendContextWindowSource,
  normalizeRuntimeWorkspaceCompactCapability,
  normalizeRuntimeWorkspaceContextWindowSource,
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendConfigurationNextStep,
  runtimeAgentBackendConfigurationFailureIsBlocking,
  runtimeAgentBackendConfigurationRecoverActions,
  runtimeAgentBackendFallbackCompactionMessage,
  runtimeAgentBackendFallbackCompactionStrategy,
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendProvider,
  runtimeAgentBackendProviderLabel,
  runtimeAgentBackendRateLimitRecoverActions,
  runtimeAgentBackendRecoverActions,
  runtimeAgentBackendHandoffFallbackCompactCapability,
  runtimeAcceptanceDiagnostic,
  runtimeAgentBackendSupported,
  runtimeAgentBackendUsesAgentServerManagedCompaction,
  readableRuntimeAcceptanceFailure,
  redactRuntimeAgentBackendSecretText,
  sanitizeRuntimeAgentBackendFailureDetail,
  withRuntimeAgentBackendUserFacingDiagnostic,
} from './agent-backend-policy';
export type {
  RuntimeAgentBackendCapabilities,
  RuntimeAgentBackend,
  RuntimeBackendContextWindowSource,
  RuntimeAgentBackendFailureDiagnostic,
  RuntimeAgentBackendFailureKind,
  RuntimeAcceptanceDiagnostic,
  RuntimeAcceptanceFailureLike,
  RuntimeLlmEndpointConfig,
} from './agent-backend-policy';
export {
  extractAgentServerCurrentUserRequest,
  normalizeConfiguredAgentServerLlmEndpoint,
} from './agentserver-prompt-policy';
export type {
  ConfiguredAgentServerLlmEndpoint,
} from './agentserver-prompt-policy';
export {
  buildBackendInputTextAnchors,
  handoffArtifactDataSummaryReason,
  handoffStringCompactionSchema,
  inferHandoffJsonSchema,
  isBinaryLikeHandoffArtifact,
  isBinaryLikeHandoffString,
} from './handoff-input-policy';
export type {
  BackendInputTextAnchorOptions,
  HandoffArtifactDataSummaryReason,
} from './handoff-input-policy';
export type {
  BuiltInScenarioId,
  ScenarioInstanceId,
  ScenarioPackageRef,
} from './app';
export type {
  RuntimeArtifact,
  RuntimeArtifactExportPolicy,
  RuntimeArtifactVisibility,
} from './artifacts';
export {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_SCHEMA_VERSION,
  ALIGNMENT_CONTRACT_VERSION_ARTIFACT_TYPE,
} from './alignment';
export type {
  AlignmentContractArtifactType,
  AlignmentContractConfirmationStatus,
  AlignmentContractData,
  AlignmentContractRecord,
  AlignmentContractSchemaVersion,
  AlignmentContractVersionArtifactType,
  AlignmentContractVersionRecord,
} from './alignment';
export {
  artifactMatchesReferenceScope,
} from './artifact-reference-policy';
export type {
  ArtifactReferencePolicyRecord,
  ArtifactReferenceScope,
} from './artifact-reference-policy';
export {
  CURRENT_REFERENCE_DIGEST_RECOVERY_CLAIM_TYPE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVIDENCE_LEVEL,
  CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_TYPE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL,
  CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID,
  CURRENT_REFERENCE_GATE_TOOL_ID,
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  agentServerArtifactSelectionPromptPolicyLines,
  agentServerBibliographicVerificationPromptPolicyLines,
  agentServerCurrentReferencePromptPolicyLines,
  agentServerToolPayloadProtocolContractLines,
  artifactDataForUnparsedPathText,
  artifactDataReadRequestsForPolicy,
  buildCurrentReferenceDigestRecoveryMarkdown,
  buildCurrentReferenceDigestRecoveryPayload,
  buildDirectContextFastPathItems,
  currentReferenceDigestFailureCanRecover,
  currentReferenceDigestRecoveryCandidates,
  currentReferenceDigestRecoveryMarkdownSections,
  defaultArtifactSchemaForSkillDomain,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
  materializedMarkdownMetadataForArtifact,
  materializedMarkdownTextForArtifact,
  normalizeArtifactDataWithPolicy,
} from './artifact-policy';
export type {
  ArtifactPolicyReadKind,
  ArtifactPolicyReadRequest,
  ArtifactPolicyReadResults,
  ArtifactPolicyRecord,
  CurrentReferenceDigestRecoveryCandidate,
  CurrentReferenceDigestRecoveryPayloadRequest,
  CurrentReferenceDigestRecoverySource,
  DirectContextFastPathInputs,
  DirectContextFastPathItem,
} from './artifact-policy';
export type {
  BackendArtifactToolName,
  BackendObjectRefKind,
  BackendToolContext,
  ListSessionArtifactsInput,
  ListSessionArtifactsResult,
  ReadArtifactInput,
  ReadArtifactResult,
  RenderArtifactFormat,
  RenderArtifactInput,
  RenderArtifactResult,
  ResolveObjectReferenceInput,
  ResolveObjectReferenceResult,
  ResumeRunInput,
  ResumeRunResult,
} from './backend-tools';
export type {
  ArtifactPreviewAction,
  PreviewDerivative,
  PreviewDerivativeKind,
  PreviewDescriptor,
  PreviewDescriptorKind,
  PreviewDescriptorSource,
  PreviewInlinePolicy,
  PreviewLocatorHintKind,
} from './preview';
export {
  artifactPreviewActions,
  previewDerivativeKinds,
  previewDescriptorKinds,
  previewDescriptorSources,
  previewInlinePolicies,
  previewLocatorHintKinds,
} from './preview';
export type {
  ObjectAction,
  ObjectReference,
  ObjectReferenceKind,
  ObjectReferenceStatus,
  ObjectResolution,
  SciForgeReference,
  SciForgeReferenceKind,
} from './references';
export {
  objectActions,
  objectReferenceKinds,
} from './references';
export {
  CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
  contractValidationFailureFromErrors,
  contractValidationFailureFromRepairReason,
  contractValidationFailureSchema,
  validationScopeForToolPayloadSchemaErrors,
} from './validation-failure';
export type {
  ContractValidationFailure,
  ContractValidationFailureKind,
  ContractValidationFailureOptions,
  ContractValidationIssue,
} from './validation-failure';
export {
  WORKSPACE_OPEN_ACTIONS,
  normalizeWorkspaceOpenAction,
  workspaceOpenExternalBlockedExtensionReason,
} from './workspace-open';
export type {
  WorkspaceOpenAction,
  WorkspaceOpenResult,
} from './workspace-open';
export {
  BELIEF_EDGE_KINDS,
  BELIEF_NODE_KINDS,
  DECISION_REVISION_STATUSES,
  FEEDBACK_COMMENT_STATUSES,
  FEEDBACK_PRIORITIES,
  RESEARCHER_DECISION_STATUSES,
  TIMELINE_DECISION_STATUSES,
  TIMELINE_VARIANT_KINDS,
  TIMELINE_VISIBILITIES,
  isFeedbackCommentStatus,
  isTimelineDecisionStatus,
  isTimelineVisibility,
} from './research-workspace';
export type {
  BeliefEdgeKind,
  BeliefNodeKind,
  DecisionRevisionStatus,
  FeedbackCommentStatus,
  FeedbackPriority,
  ResearcherDecisionStatus,
  TimelineDecisionStatus,
  TimelineVariantKind,
  TimelineVisibility,
} from './research-workspace';
export {
  WORK_EVIDENCE_KINDS,
  WORK_EVIDENCE_SCHEMA,
  WORK_EVIDENCE_STATUSES,
  collectWorkEvidence,
  collectWorkEvidenceFromBackendEvent,
  parseWorkEvidence,
  summarizeWorkEvidenceForHandoff,
} from './work-evidence';
export type {
  WorkEvidence,
  WorkEvidenceHandoffSummary,
  WorkEvidenceKind,
  WorkEvidenceSchemaIssue,
  WorkEvidenceSchemaResult,
  WorkEvidenceStatus,
} from './work-evidence';
export {
  TASK_PROJECT_STATUSES,
  TASK_STAGE_STATUSES,
} from './task-project';
export type {
  TaskProjectStatus,
  TaskStageStatus,
} from './task-project';
export {
  adaptBackendToolEventToWorkEvidence,
} from './work-evidence-adapter';
export type {
  BackendToolWorkEvidenceAdapterOptions,
} from './work-evidence-adapter';
export {
  WORK_EVIDENCE_POLICY_CONTRACT_ID,
  WORK_EVIDENCE_POLICY_SCHEMA_PATH,
  evaluateWorkEvidencePolicy,
} from './work-evidence-policy';
export type {
  WorkEvidencePolicyFinding,
  WorkEvidencePolicyPayload,
  WorkEvidencePolicyRequest,
} from './work-evidence-policy';
export {
  VERIFICATION_POLICY_CONTRACT_ID,
  VERIFICATION_POLICY_SCHEMA_PATH,
  createRuntimeVerificationArtifact,
  evaluateRuntimeVerificationGate,
  inferVerificationRiskLevel,
  mostDecisiveVerificationResult,
  normalizeHumanApproval,
  normalizeRuntimeVerificationPolicy,
  verificationIsNonBlocking,
} from './verification-policy';
export type {
  RuntimeHumanApprovalPolicy,
  RuntimeHumanApprovalSnapshot,
  RuntimeVerificationGate,
  RuntimeVerificationMode,
  RuntimeVerificationPolicy,
  RuntimeVerificationPolicyPayload,
  RuntimeVerificationPolicyRequest,
  RuntimeVerificationRiskLevel,
} from './verification-policy';
export {
  VERIFICATION_RESULT_CONTRACT_ID,
  VERIFICATION_RESULT_SCHEMA_PATH,
  VERIFICATION_RESULT_ARTIFACT_TYPE,
  failedRuntimeVerificationResults,
  isRuntimeVerificationResultArtifact,
  normalizeRuntimeVerificationResults,
  normalizeRuntimeVerificationResultsOrUndefined,
  normalizeRuntimeVerificationVerdict,
  runtimeVerificationResultArtifacts,
  verificationResultFailureActual,
  verificationResultFailureMessages,
} from './verification-result';
export type {
  RuntimeVerificationArtifactRecord,
  RuntimeVerificationResult,
  RuntimeVerificationVerdict,
} from './verification-result';
export type {
  CapabilityManifest,
  CapabilityManifestBrief,
  CapabilityManifestKind,
  CapabilityManifestLifecycle,
  CapabilityManifestRisk,
  CapabilityManifestSideEffect,
  CapabilityProviderManifest,
  CapabilityRepairHint,
  CapabilityValidatorManifest,
} from './capability-manifest';
export {
  CAPABILITY_EVOLUTION_BROKER_DIGEST_CONTRACT_ID,
  CAPABILITY_EVOLUTION_CANDIDATE_SET_CONTRACT_ID,
  CAPABILITY_EVOLUTION_COMPACT_SUMMARY_CONTRACT_ID,
  CAPABILITY_EVOLUTION_RECORD_CONTRACT_ID,
} from './capability-evolution';
export {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  CORE_CAPABILITY_MANIFESTS,
  capabilityManifestSchema,
  compactCapabilityManifestBrief,
  validateCapabilityManifestRegistry,
  validateCapabilityManifestShape,
} from './capability-manifest';
export {
  agentServerCapabilityRoutingPolicy,
  WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
  WORKSPACE_RUNTIME_GATEWAY_REPAIR_TOOL_ID,
} from './capabilities';
export type {
  CapabilityEvolutionBrokerDigest,
  CapabilityEvolutionCandidate,
  CapabilityEvolutionCandidateKind,
  CapabilityEvolutionCandidateSet,
  CapabilityEvolutionCompactRecord,
  CapabilityEvolutionCompactSummary,
  CapabilityEvolutionRecord,
  CapabilityEvolutionRecordStatus,
  CapabilityFallbackBlocker,
  CapabilityFallbackTrigger,
  CapabilityLatencyCostSummary,
  CapabilityPromotionCandidate,
  CapabilityProviderRef,
  CapabilityRepairAttemptRef,
  CapabilityValidationResultRef,
  ComposedCapabilityAtomicTrace,
  ComposedCapabilityFallbackPolicy,
  ComposedCapabilityResult,
  ComposedCapabilityResultStatus,
  SelectedCapabilityRef,
} from './capability-evolution';
export type {
  ExecutionUnitStatus,
  RuntimeExecutionUnit,
} from './execution';
export type {
  BackgroundCompletionEventType,
  BackgroundCompletionRef,
  BackgroundCompletionRuntimeEvent,
  BackgroundCompletionStatus,
  ProcessProgressModel,
  ProcessProgressPhase,
  ProcessProgressReason,
  ProcessProgressStatus,
  ProjectToolEventType,
  RuntimeHealthStatus,
  RuntimeRecoverAction,
  RuntimeRequestAcceptedProgressCopy,
  RuntimeStreamEventType,
  RuntimeEventIdentity,
  RuntimeStageRecordLike,
  RuntimeToolEventActionKind,
  RuntimeWorkEventClassificationInput,
  RuntimeWorkEventKind,
  RuntimeWorkEventRecordLike,
  TargetIssueEventType,
  WorkspaceRuntimePolicyEvent,
  WorkspaceRuntimeCompletionStatus,
  WorkspaceRuntimeResultCompletion,
} from './events';
export {
  ACCEPTANCE_REPAIR_RERUN_TOOL_ID,
  AGENTSERVER_CONVERGENCE_GUARD_EVENT_TYPE,
  AGENTSERVER_CONTEXT_WINDOW_RECOVERY_EVENT_TYPE,
  AGENTSERVER_CONTEXT_WINDOW_STATE_EVENT_TYPE,
  AGENTSERVER_DISPATCH_EVENT_TYPE,
  AGENTSERVER_EVENT_TYPE_PREFIX,
  AGENTSERVER_GENERATION_RETRY_EVENT_TYPE,
  AGENTSERVER_GENERATION_RETRY_SCHEMA_VERSION,
  AGENTSERVER_SILENT_STREAM_GUARD_EVENT_TYPE,
  BACKEND_EVENT_TYPE,
  BACKGROUND_COMPLETION_CONTRACT_ID,
  BACKGROUND_COMPLETION_TOOL_ID,
  CONTEXT_COMPACTION_EVENT_TYPE,
  CONTEXT_WINDOW_STATE_EVENT_TYPE,
  CONVERSATION_POLICY_STARTED_EVENT_TYPE,
  CONVERSATION_POLICY_EVENT_TYPE,
  DEFAULT_EMPTY_ARTIFACT_RECOVER_ACTIONS,
  DEFAULT_WORKSPACE_EVENT_TYPE,
  DIRECT_CONTEXT_FAST_PATH_EVENT_TYPE,
  GATEWAY_REQUEST_RECEIVED_EVENT_TYPE,
  GUIDANCE_QUEUED_EVENT_TYPE,
  GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT,
  LATENCY_DIAGNOSTICS_CACHE_POLICY_KEYS,
  LATENCY_DIAGNOSTICS_EVENT_TYPE,
  LATENCY_DIAGNOSTICS_LOG_KIND,
  LATENCY_DIAGNOSTICS_REF,
  LATENCY_DIAGNOSTICS_SCHEMA_VERSION,
  OUTPUT_EVENT_TYPE,
  PROCESS_EVENTS_SCHEMA_VERSION,
  PROCESS_PROGRESS_EVENT_TYPE,
  PROCESS_PROGRESS_PHASE,
  PROCESS_PROGRESS_PHASES,
  PROCESS_PROGRESS_REASON,
  PROCESS_PROGRESS_STATUS,
  PROCESS_PROGRESS_STATUSES,
  PROJECT_TOOL_DONE_EVENT_TYPE,
  PROJECT_TOOL_FAILED_EVENT_TYPE,
  PROJECT_TOOL_STARTED_EVENT_TYPE,
  RATE_LIMIT_EVENT_TYPE,
  REPAIR_ATTEMPT_RESULT_EVENT_TYPE,
  REPAIR_ATTEMPT_START_EVENT_TYPE,
  SCIFORGE_RUNTIME_PROVIDER,
  RUNTIME_HEALTH_STATUS,
  RUNTIME_HEALTH_STATUSES,
  RUN_PLAN_EVENT_TYPE,
  STAGE_START_EVENT_TYPE,
  STREAM_EVENT_TYPE,
  STREAM_EVENT_TYPES,
  TARGET_INSTANCE_CONTEXT_EVENT_TYPE,
  TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE,
  TARGET_ISSUE_READ_EVENT_TYPE,
  TARGET_REPAIR_MODIFYING_EVENT_TYPE,
  TARGET_REPAIR_TESTING_EVENT_TYPE,
  TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE,
  TARGET_WORKTREE_PREPARING_EVENT_TYPE,
  TEXT_DELTA_EVENT_TYPE,
  TOOL_CALL_EVENT_TYPE,
  TOOL_RESULT_EVENT_TYPE,
  USER_VISIBLE_EVENT_EXCLUSION_TYPES,
  USER_INTERRUPT_EVENT_TYPE,
  USAGE_UPDATE_EVENT_TYPE,
  WORKSPACE_SKILL_SELECTED_EVENT_TYPE,
  WORKSPACE_RUNTIME_EVENT_TYPE,
  WORKSPACE_RUNTIME_SOURCE,
  acceptanceRepairRerunToolId,
  agentServerConvergenceGuardEvent,
  agentServerContextWindowRecoveryStartEvent,
  agentServerContextWindowRecoverySucceededEvent,
  agentServerDispatchEvent,
  agentServerGenerationRecoveryEventType,
  agentServerGenerationRecoveryStartEvent,
  agentServerGenerationRetrySucceededEvent,
  agentServerSilentStreamGuardEvent,
  backgroundCompletionContractId,
  backgroundCompletionToolId,
  compactCapabilityForBackend,
  compactRuntimePromptSummary,
  classifyRuntimeWorkEventKind,
  conversationPolicyStartedEvent,
  directContextFastPathEvent,
  firstBlockingRuntimeResultReason,
  gatewayRequestReceivedEvent,
  guidanceQueuedEvent,
  latencyDiagnosticsCachePolicy,
  normalizeRuntimeCompactCapability,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowSource,
  normalizeRuntimeContextWindowStatus,
  normalizeRuntimeWorkspaceEventType,
  projectToolDoneDetail,
  projectToolDoneEvent,
  projectToolEvent,
  projectToolFailedEvent,
  projectToolFailureDetail,
  projectToolStartDetail,
  projectToolStartedEvent,
  repairAttemptResultEvent,
  repairAttemptStartEvent,
  runtimeDetailIndicatesAbort,
  runtimeEventIsBackend,
  runtimeEventIsUserVisible,
  runtimeOperationKindForStage,
  runtimeOperationKindForWorkEvidence,
  runtimeRequestAcceptedProgressCopy,
  runtimeRecoverActionLabel,
  runtimeStreamCompletionDetailIsKey,
  runtimeStreamEventLabel,
  runtimeStreamEventTypeIsCompletion,
  runtimeStreamEventTypeIsKeyWorkStatus,
  runtimeTextLooksLikeGeneratedWorkDetail,
  runtimeToolEventActionKind,
  runtimeToolOutputLooksLikeFailure,
  summarizeRuntimeGeneratedTaskFiles,
  targetInstanceContextEvent,
  targetIssueLookupFailedEvent,
  targetIssueReadEvent,
  targetRepairModifyingEvent,
  targetRepairTestingEvent,
  targetRepairWrittenBackEvent,
  targetWorktreePreparingEvent,
  userInterruptEvent,
  workspaceSkillSelectedEvent,
  workspaceRuntimeResultCompletion,
} from './events';
export type {
  GuidanceQueueRecord,
  GuidanceQueueStatus,
  MessageRole,
  RunStatus,
  RuntimeClaimType,
  RuntimeEvidenceLevel,
  SciForgeMessage,
  SemanticTurnAcceptance,
  TurnAcceptance,
  TurnAcceptanceFailure,
  TurnAcceptanceSeverity,
  UserGoalSnapshot,
  UserGoalType,
} from './messages';
export * from './observe';
export type {
  EvidenceClaim,
  NotebookRecord,
  SciForgeRun,
  SciForgeSession,
  SessionVersionRecord,
} from './session';
export type {
  AgentCompactCapability,
  AgentContextCompaction,
  AgentContextWindowSource,
  AgentContextWindowState,
  AgentStreamEvent,
  AgentTokenUsage,
} from './stream';
export {
  CONVERSATION_POLICY_AGENTSERVER_GENERATION_ADAPTER,
  CONVERSATION_POLICY_REQUEST_VERSION,
  CONVERSATION_POLICY_RESPONSE_VERSION,
  CONVERSATION_POLICY_SELECTED_COMPONENT_ADAPTER,
  CONVERSATION_POLICY_SELECTED_COMPONENT_KIND,
  CONVERSATION_POLICY_SELECTED_SENSE_ADAPTER,
  CONVERSATION_POLICY_SELECTED_TOOL_ADAPTER,
  CONVERSATION_POLICY_SELECTED_VERIFIER_ADAPTER,
  SAFE_DEFAULT_BACKGROUND_PLAN,
  SAFE_DEFAULT_CACHE_POLICY,
  SAFE_DEFAULT_LATENCY_POLICY,
  SAFE_DEFAULT_RESPONSE_PLAN,
  normalizeConversationPolicyResponse,
  selectedConversationPolicyCapabilityManifests,
} from './conversation-policy';
export type {
  ConversationPolicyRequest,
  ConversationPolicyResponse,
  SelectedConversationPolicyCapabilityManifestInput,
} from './conversation-policy';
export type {
  DisplayIntent,
  ResolvedViewPlan,
  UIManifestSlot,
  UIModuleLifecycle,
  UIModuleManifest,
  ViewCompare,
  ViewEncoding,
  ViewLayout,
  ViewPlanSection,
  ViewPreset,
  ViewSelection,
  ViewSync,
  ViewTransform,
} from './view';
export {
  displayIntentSources,
} from './view';

export type UIComponentLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type UIComponentSection = 'primary' | 'supporting' | 'provenance' | 'raw';
export type PresentationDedupeScope = 'entity' | 'document' | 'collection' | 'none';

/** Inline payload for the UI component workbench demo preview (`artifact.data` shape). */
export interface UIComponentWorkbenchDemo {
  artifactData: Record<string, unknown>;
  artifactType?: string;
  schemaVersion?: string;
}

export interface UIComponentManifest {
  packageName: string;
  moduleId: string;
  version: string;
  title: string;
  description: string;
  componentId: string;
  lifecycle: UIComponentLifecycle;
  acceptsArtifactTypes: string[];
  outputArtifactTypes?: string[];
  requiredFields?: string[];
  requiredAnyFields?: string[][];
  viewParams?: string[];
  interactionEvents?: string[];
  roleDefaults?: string[];
  fallbackModuleIds?: string[];
  defaultSection?: UIComponentSection;
  priority?: number;
  /** Built-in sample payload for the component workbench smoke preview. */
  workbenchDemo?: UIComponentWorkbenchDemo;
  safety?: {
    sandbox?: boolean;
    externalResources?: 'none' | 'declared-only' | 'allowed';
    executesCode?: boolean;
  };
  presentation?: {
    dedupeScope?: PresentationDedupeScope;
    identityFields?: string[];
  };
  docs: {
    readmePath: string;
    agentSummary: string;
  };
}

export interface UIComponentRenderSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  transform?: Array<{
    type: 'filter' | 'sort' | 'limit' | 'group' | 'derive';
    field?: string;
    op?: string;
    value?: unknown;
  }>;
  encoding?: {
    colorBy?: string;
    splitBy?: string;
    overlayBy?: string;
    facetBy?: string;
    syncViewport?: boolean;
  };
  layout?: { mode?: string };
  compare?: { mode?: string };
}

export interface UIComponentRuntimeArtifact {
  id: string;
  type: string;
  producerScenario: string;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
  path?: string;
}

export interface UIComponentRenderHelpers {
  ArtifactSourceBar?: (props: { artifact?: UIComponentRuntimeArtifact; session?: unknown }) => ReactNode;
  ArtifactDownloads?: (props: { artifact?: UIComponentRuntimeArtifact }) => ReactNode;
  ComponentEmptyState?: (props: { componentId: string; artifactType?: string; title?: string; detail?: string }) => ReactNode;
  MarkdownBlock?: (props: { markdown?: string }) => ReactNode;
  readWorkspaceFile?: (ref: string) => Promise<{ content: string }>;
}

export interface UIComponentRendererProps {
  slot: UIComponentRenderSlot;
  artifact?: UIComponentRuntimeArtifact;
  session?: unknown;
  config?: unknown;
  helpers?: UIComponentRenderHelpers;
}

export type UIComponentRenderer = (props: UIComponentRendererProps) => ReactNode;
