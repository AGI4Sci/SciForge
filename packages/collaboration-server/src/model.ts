export type Assurance = 'basic' | 'verified' | 'strong' | 'device'
export type ResourceStatus = 'active' | 'suspended' | 'revoked'

export type StoredUser = {
  userId: string
  displayName: string
  status: ResourceStatus
  revision: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export type StoredOidcIdentity = {
  identityId: string
  userId: string
  issuer: string
  subject: string
  emailAtLinkTime?: string
  status: 'active' | 'revoked'
  revision: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export type StoredDeviceEnrollment = {
  enrollmentId: string
  userId: string
  installationId: string
  nonceDigest: string
  status: 'pending' | 'consumed' | 'expired'
  revision: number
  expiresAt: string
  createdAt: string
  updatedAt: string
  consumedAt?: string
}

export type StoredDevice = {
  deviceId: string
  userId: string
  installationId: string
  displayName: string
  platform: import('@sciforge/collaboration-contracts').DevicePlatform
  publicKeyJwk: import('@sciforge/collaboration-contracts').Ed25519PublicJwk
  capabilitySummary: string[]
  status: 'active' | 'revoked'
  revision: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export type StoredChallenge = {
  challengeId: string
  requestedUserId: string
  provider: string
  realmId: string
  expectedProviderUserId: string
  challengeDigest: string
  expiresAt: string
  createdAt: string
  verifiedUserId?: string
  verifiedEndpointId?: string
  verifiedAt?: string
}

export type StoredEndpoint = {
  humanEndpointId: string
  userId: string
  provider: string
  realmId: string
  providerUserId: string
  displayName?: string
  assurance: Exclude<Assurance, 'device'>
  status: ResourceStatus
  revision: number
  verifiedAt: string
  updatedAt: string
  revokedAt?: string
}

export type StoredAgent = {
  agentId: string
  deviceId: string
  ownerUserId: string
  displayName: string
  nodeType: string
  capabilities: string[]
  status: ResourceStatus
  connectionStatus: 'online' | 'offline'
  credentialGeneration: number
  revision: number
  lastSeenAt?: string
  updatedAt: string
  revokedAt?: string
}

export type StoredCredential = {
  credentialId: string
  kind: 'agent_device'
  subjectUserId: string
  subjectAgentId: string
  tokenDigest: string
  assurance: 'device'
  generation: number
  createdAt: string
  expiresAt?: string
  revokedAt?: string
}

export type StoredParticipant = {
  userId: string
  primaryHumanEndpointId?: string
  primaryAgentId?: string
  status: 'incomplete' | 'complete'
  revision: number
  updatedAt: string
}

export type ProjectBudget = {
  maxTasks: number
  maxTasksPerRound: number
  maxTaskRetries: number
  maxCoordinationRounds: number
}

export type StoredProject = {
  projectId: string
  ownerUserId: string
  displayName: string
  goal: string
  contentMode: 'none' | 'required'
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'
  coordinatorAgentId: string
  coordinatorAuthorityEpoch: number
  executionAuthorityEpoch: number
  contentOwnerUserId: string | null
  budget: ProjectBudget
  coordinationRound: number
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectMember = {
  projectMembershipId: string
  projectId: string
  userId: string
  state: 'pending_membership' | 'active' | 'membership_removal_pending' | 'removed'
  authorityEpoch: number
  activatedAt: string | null
  removalRequestedAt: string | null
  removalRequestedByUserId: string | null
  removedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

/**
 * A global, expiring observation of one exact Agent/Device. Project eligibility
 * is deliberately derived elsewhere from Membership, Content Readiness and
 * Task Authority; discovery must not require a Project to exist first.
 */
export type StoredWorkerAvailability = {
  agentId: string
  userId: string
  deviceId: string
  agentActive: boolean
  deviceActive: boolean
  connectionStatus: 'online' | 'offline'
  lastHeartbeatAt: string | null
  runtimeReadiness: 'ready' | 'unavailable'
  runtimeCapabilityTags: string[]
  acceptsNewOffers: boolean
  activeTaskCount: number
  observedAt: string
  expiresAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProviderDirectoryPrincipalFact = {
  providerPrincipalFactId: string
  userId: string
  providerPrincipal: import('@sciforge/collaboration-contracts').ProviderDirectoryPrincipalReference
  principalIdentityRevision: number
  providerBindingAttestationDigest: string
  publishedByDeviceId: string
  readiness: 'ready' | 'degraded'
  readinessReason: 'provider_binding_changed' | 'provider_unavailable' | 'provider_unauthorized' | null
  observedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

/** Append-only Provider fact. It is evidence, never a cached ACL grant. */
export type StoredProjectProviderMembershipObservation = {
  providerObservationId: string
  projectId: string
  userId: string
  providerPrincipalFactId: string
  snapshottedFactRevision: number
  providerPrincipal: import('@sciforge/collaboration-contracts').ProviderDirectoryPrincipalReference
  bindingRevision: number
  provisioningRevision: number
  source: 'provisioning_attestation' | 'explicit_reconcile' | 'download_check' | 'upload_new'
  outcome: 'present' | 'absent' | 'unauthorized' | 'unavailable'
  observerUserId: string
  observerDeviceId: string
  observerAgentId: string | null
  provisioningAttestationId: string | null
  evidenceDigest: string
  observedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectContentReadiness = {
  projectId: string
  userId: string
  providerInstance: import('@sciforge/collaboration-contracts').ProviderInstanceReference
  state: 'missing_identity' | 'pending' | 'ready' | 'degraded'
  reason:
    | 'identity_missing'
    | 'provisioning_pending'
    | 'provider_member_absent'
    | 'provider_unavailable'
    | 'provider_unauthorized'
    | 'binding_degraded'
    | 'content_owner_lost_root'
    | null
  providerPrincipalFactId: string | null
  snapshottedFactRevision: number | null
  providerPrincipal: import('@sciforge/collaboration-contracts').ProviderDirectoryPrincipalReference | null
  bindingRevision: number | null
  lastObservationId: string | null
  effectiveAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

/** Exactly one Cloud safety switch per Project User and non-overlapping Task scope. */
export type StoredTaskAuthority = {
  taskAuthorityId: string
  projectId: string
  userId: string
  scope: 'text_tasks' | 'file_tasks'
  state: 'eligible' | 'suspended' | 'fenced'
  authorityEpoch: number
  reason:
    | 'project_paused'
    | 'project_terminal'
    | 'membership_pending'
    | 'membership_removal_pending'
    | 'membership_removed'
    | 'content_identity_missing'
    | 'content_not_ready'
    | 'content_binding_degraded'
    | null
  effectiveAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type TaskStatus =
  | 'planned'
  | 'offered'
  | 'in_progress'
  | 'needs_human'
  | 'awaiting_review'
  | 'revision_requested'
  | 'manual_recovery_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StoredTask = {
  taskId: string
  projectId: string
  createdByCoordinatorAgentId: string
  title: string
  objective: string
  completionCriteria: string[]
  dependencyTaskIds: string[]
  requiredCapabilityTags: string[]
  fileIntent: import('@sciforge/collaboration-contracts').TaskFileIntent | null
  currentExecutionId: string | null
  currentExecutionState: import('@sciforge/collaboration-contracts').TaskExecutionState | null
  status: TaskStatus
  executionCount: number
  maxRetries: number
  coordinationRound: number
  revision: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type StoredProjectContentSpaceBinding = {
  projectContentBindingId: string
  projectId: string
  contentOwnerUserId: string
  providerInstance: import('@sciforge/collaboration-contracts').ProviderInstanceReference
  rootLocator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator | null
  rootLocatorDigest: string | null
  provisioningIntentId: string
  provisioningRevision: number
  attestationId: string | null
  attestationDigest: string | null
  status: 'provisioning' | 'active' | 'degraded' | 'closed'
  statusReason:
    | 'provisioning_incomplete'
    | 'provider_unavailable'
    | 'owner_access_lost'
    | 'rebind_required'
    | 'content_owner_transfer_pending'
    | 'project_archived'
    | 'project_deleted'
    | 'owner_requested'
    | null
  activatedAt: string | null
  degradedAt: string | null
  closedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectContentProvisioningIntent = {
  provisioningIntentId: string
  projectId: string
  provisioningRevision: number
  kind: 'initial_provisioning' | 'membership_change' | 'reconcile' | 'rebind' | 'content_owner_transfer'
  state:
    | 'pending'
    | 'in_progress'
    | 'awaiting_attestation'
    | 'manual_recovery_required'
    | 'completed'
    | 'superseded'
    | 'cancelled'
  createdByOwnerUserId: string
  contentOwnerUserId: string
  providerInstance: import('@sciforge/collaboration-contracts').ProviderInstanceReference
  desiredMembers: import('@sciforge/collaboration-contracts').ProjectContentDesiredMember[]
  containerDisplayName: string
  currentRootLocator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator | null
  currentBindingRevision: number | null
  intentDigest: string
  revision: number
  createdAt: string
  updatedAt: string
}

/**
 * Device-signed, non-secret observation metadata. The signature proves who
 * observed the facts; it never grants or extends Provider authorization.
 */
export type StoredProjectContentProvisioningAttestation = {
  provisioningAttestationId: string
  provisioningIntentId: string
  projectId: string
  provisioningRevision: number
  ownerUserId: string
  principalIdentityRevision: number
  providerBindingAttestationDigest: string
  providerInstance: import('@sciforge/collaboration-contracts').ProviderInstanceReference
  rootLocator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator
  rootLocatorDigest: string
  observedOperations: import('@sciforge/collaboration-contracts').ProvisioningObservedOperation[]
  memberObservations: import('@sciforge/collaboration-contracts').ProvisionedMemberObservation[]
  memberSetDigest: string
  observationStartedAt: string
  observationCompletedAt: string
  deviceSignature: import('@sciforge/collaboration-contracts').DeviceFactSignatureMetadata
  revision: number
  createdAt: string
  updatedAt: string
}

export type ExternalOperationState =
  | 'prepared'
  | 'dispatched'
  | 'observed_success'
  | 'observed_failure'
  | 'outcome_unknown'
  | 'abandoned'

export type StoredExternalOperationJournal = {
  contentRecoveryJournalEntryId: string
  scope: 'project_provisioning' | 'project_membership' | 'task_content_transfer'
  logicalInvocationId: string
  projectId: string
  taskId: string | null
  preparedTaskRevision: number | null
  provisioningIntentId: string | null
  provisioningRevision: number | null
  executionId: string | null
  preparedExecutionRevision: number | null
  operation:
    | 'create_shared_container'
    | 'list_members'
    | 'add_member'
    | 'remove_member'
    | 'observe_root'
    | 'download'
    | 'upload_new'
    | 'observe_output'
  requestDigest: string
  state: ExternalOperationState
  observationDigest: string | null
  receiptDigest: string | null
  safeFailureCode: string | null
  preparedAt: string
  dispatchedAt: string | null
  resolvedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

/**
 * Human-visible recovery state is derived directly from the public contract.
 * Fixed wire metadata is reconstructed at the API boundary, not duplicated in
 * the persistence representation.
 */
export type StoredVisibleRecoveryAction = Omit<
  import('@sciforge/collaboration-contracts').VisibleRecoveryAction,
  'schemaVersion' | 'type'
>

/** Preserved assignment attempt. Only state/fence/timestamps advance by CAS. */
export type StoredTaskExecution = {
  executionId: string
  taskId: string
  projectId: string
  attempt: number
  offeredByCoordinatorAgentId: string
  assigneeUserId: string
  assigneeAgentId: string
  assigneeDeviceId: string
  state: import('@sciforge/collaboration-contracts').TaskExecutionState
  stateRevision: number
  fence: import('@sciforge/collaboration-contracts').TaskExecutionFence
  fileIntent: import('@sciforge/collaboration-contracts').TaskExecutionFileIntent | null
  currentResultSubmissionId: string | null
  offeredAt: string
  acceptedAt: string
  startedAt: string | null
  terminalAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredTaskOffer = {
  taskOfferId: string
  executionId: string | null
  taskId: string
  projectId: string
  workerUserId: string
  offeredByCoordinatorAgentId: string
  state: 'pending' | 'accepted' | 'withdrawn' | 'timed_out'
  offeredAt: string
  expiresAt: string
  respondedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectPlan = {
  projectPlanId: string
  projectId: string
  coordinatorAuthorityEpoch: number
  state: 'draft' | 'awaiting_confirmation' | 'confirmed' | 'superseded'
  planRevision: number
  sourceInputLocators: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator[]
  tasks: import('@sciforge/collaboration-contracts').ProjectPlanTask[]
  rationale: string
  runtimeProvenance: import('@sciforge/collaboration-contracts').ProjectPlanRuntimeProvenance
  planDigest: string
  submittedAt: string | null
  revision: number
  confirmedByUserId: string | null
  confirmedAt: string | null
  supersededAt: string | null
  createdAt: string
  updatedAt: string
}

export type StoredTaskResultSubmission = {
  resultSubmissionId: string
  projectId: string
  taskId: string
  executionId: string
  submittedByUserId: string
  submittedByAgentId: string
  submittedTaskRevision: number
  submittedExecutionRevision: number
  summary: string
  runtimeProvenance: import('@sciforge/collaboration-contracts').TaskResultSubmission['runtimeProvenance']
  outputs: import('@sciforge/collaboration-contracts').TaskResultOutput[]
  recoveryJournalEntryIds: string[]
  submissionDigest: string
  revision: number
  submittedAt: string
  createdAt: string
  updatedAt: string
}

export type StoredTaskResultReview = {
  reviewDecisionId: string
  resultSubmissionId: string
  projectId: string
  taskId: string
  executionId: string
  reviewedResultRevision: number
  decidedByUserId: string
  decidedByCoordinatorAgentId: string
  coordinatorAuthorityEpoch: number
  decision: 'accept' | 'request_revision'
  instruction: string | null
  acceptedProjectRecordId: string | null
  nextTaskOfferId: string | null
  decidedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectFinalSummary = {
  projectId: string
  projectRecordId: string
  projectPlanId: string
  confirmedPlanRevision: number
  summary: string
  acceptedResultSubmissionIds: string[]
  createdByUserId: string
  createdByCoordinatorAgentId: string
  coordinatorAuthorityEpoch: number
  completedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredEndpointChallengeRateWindow = {
  userId: string
  provider: string
  realmId: string
  windowStartedAt: string
  expiresAt: string
  attemptCount: number
  revision: number
  updatedAt: string
}

export type EndpointChallengeRateConsumeResult = {
  allowed: boolean
  window: StoredEndpointChallengeRateWindow
}

export type StoredCloudResourceRef = {
  resourceRefId: string
  projectId: string
  taskId: string
  executionId: string
  assignmentTaskRevision: number
  bindingRevision: number
  intentDigest: string
  role: 'input-file' | 'output-container' | 'output-file'
  ordinal: number
  locator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator
  locatorDigest: string
  status: 'available' | 'invalidated' | 'revoked'
  invalidatedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type ProjectRecordKind = 'observation' | 'decision' | 'summary'

export type StoredProjectRecord = {
  projectRecordId: string
  projectId: string
  kind: ProjectRecordKind
  status: 'accepted'
  summary: string
  authorUserId: string
  authorAgentId: string
  sourceTaskId?: string
  sourceResultSubmissionId?: string
  sourceHumanAnswerId?: string
  sourceRevision?: number
  acceptedByUserId: string
  acceptedByAgentId: string
  acceptedAt: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type ProviderLocatorValue = {
  type: 'provider_locator'
  provider: string
  realmId: string
  containerId: string
  topicId: string
  containerDisplayName?: string
  topicDisplayName?: string
}

export type StoredProjection = {
  projectionId: string
  ownerUserId: string
  agentId: string
  humanEndpointId: string
  locator: ProviderLocatorValue
  locatorRevision: number
  displayName: string
  status: 'active' | 'paused' | 'error' | 'closed'
  allowedSenderUserIds: string[]
  lastErrorCode?: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type ManagedContainerPolicyValue = {
  version: 1
  visibility: 'private'
  history: 'protected'
  membership: 'owner_and_message_bot'
  memberManagement: 'provisioning_service_only'
  channelManagement: 'provisioning_service_only'
  ownerCanSend: true
  ownerCanCreateTopics: true
  messageBotCanSend: true
  messageBotCreatesProjectTopics: false
}

export type StoredManagedContainer = {
  managedContainerId: string
  ownerUserId: string
  humanEndpointId: string
  provider: string
  realmId: string
  ownerProviderUserId: string
  stableKey: string
  displayName: string
  externalContainerId?: string
  policy: ManagedContainerPolicyValue
  observedChecks?: {
    private: boolean
    protectedHistory: boolean
    exactMembership: boolean
    ownerCanSend: boolean
    messageBotCanSend: boolean
    ownerCanCreateTopics: boolean
    memberManagementRestricted: boolean
    channelManagementRestricted: boolean
  }
  status: 'requested' | 'provisioning' | 'active' | 'drifted' | 'suspended' | 'archived' | 'failed'
  lastVerifiedAt?: string
  safeErrorCode?: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredManagedContainerJob = {
  jobId: string
  managedContainerId: string
  operation: 'ensure' | 'inspect' | 'reconcile' | 'archive'
  desiredRevision: number
  state: 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed'
  attemptCount: number
  nextAttemptAt: string
  leaseOwner?: string
  leaseExpiresAt?: string
  safeErrorCode?: string
  createdAt: string
  updatedAt: string
}

export type StoredProjectEndpointBinding = {
  projectEndpointBindingId: string
  projectId: string
  locator: ProviderLocatorValue
  locatorRevision: number
  status: 'active' | 'error' | 'closed'
  lastErrorCode?: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectInput = {
  projectInputId: string
  projectId: string
  senderUserId: string
  sourceHumanEndpointId: string
  providerMessageId: string
  sequence: number
  text: string
  status: 'queued' | 'processed' | 'rejected' | 'expired'
  revision: number
  occurredAt: string
  createdAt: string
  updatedAt: string
}

export type StoredHumanRequest = {
  humanRequestId: string
  projectId: string
  context: import('@sciforge/collaboration-contracts').HumanNeededContext
  targetUserId: string
  requestedByAgentId: string
  requiredAssurance: 'basic' | 'verified' | 'strong'
  prompt: string
  confirmableAction: import('@sciforge/collaboration-contracts').ConfirmableHumanAction | null
  status: 'pending' | 'answered' | 'expired' | 'cancelled'
  revision: number
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export type StoredHumanAnswer = {
  humanAnswerId: string
  humanRequestId: string
  projectId: string
  context: import('@sciforge/collaboration-contracts').HumanNeededContext
  requestRevision: number
  answeredByUserId: string
  answeredFrom: import('@sciforge/collaboration-contracts').HumanAnswerSource
  assurance: 'basic' | 'verified' | 'strong'
  answer: string
  decision: 'approve' | 'reject' | null
  confirmationId: string | null
  revision: number
  answeredAt: string
  createdAt: string
  updatedAt: string
}

export type StoredRemoteCapabilityApproval = {
  remoteApprovalId: string
  ownerUserId: string
  agentId: string
  projectionId: string
  locator: ProviderLocatorValue
  locatorRevision: number
  runtimeId: string
  threadId: string
  turnId: string
  capabilityRequestId: string
  desktopApprovalId: string
  referenceDigest: string
  safeSummary: string
  effect: 'workspace-write' | 'external-write' | 'destructive'
  remoteEligible: boolean
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'superseded' | 'desktop_only' | 'delivery_pending' | 'completed'
  providerCardMessageId?: string
  decisionEventId?: string
  decisionId?: string
  revision: number
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export type InboxRecipient = {
  kind: 'user' | 'human_endpoint' | 'agent' | 'provider_identity'
  id: string
}

export type StoredInboxMessage = {
  recipient: InboxRecipient
  sequence: number
  messageId: string
  messageType: string
  payload: Record<string, unknown>
  createdAt: string
  expiresAt: string
}

export type StoredInboxCursor = {
  recipient: InboxRecipient
  nextSequence: number
  ackedSequence: number
  updatedAt: string
}

export type StoredReceipt = {
  receiptId: string
  actorKey: string
  idempotencyKey: string
  requestDigest: string
  operation: string
  resourceKind?: string
  resourceId?: string
  response: Record<string, unknown>
  createdAt: string
  expiresAt: string
}

export type StoredAuditEvent = {
  auditEventId: string
  actorKind: string
  actorUserId?: string
  actorEndpointId?: string
  actorAgentId?: string
  action: string
  resourceKind?: string
  resourceId?: string
  outcome: 'accepted' | 'rejected'
  metadata: Record<string, unknown>
  createdAt: string
}
