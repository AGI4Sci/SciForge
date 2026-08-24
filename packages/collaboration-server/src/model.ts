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

export type StoredChallenge = {
  challengeId: string
  requestedUserId?: string
  provider: string
  realmId: string
  expectedProviderUserId?: string
  challengeDigest: string
  pollSecretDigest: string
  requestedDisplayName: string
  expiresAt: string
  createdAt: string
  verifiedUserId?: string
  verifiedEndpointId?: string
  verifiedAt?: string
  consumedAt?: string
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
  installationId: string
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
  kind: 'user' | 'agent_device'
  subjectUserId: string
  subjectAgentId?: string
  tokenDigest: string
  assurance: Exclude<Assurance, 'unverified'>
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

export type ProjectBudgets = {
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
  status: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  coordinatorAgentId: string
  budgets: ProjectBudgets
  coordinationRound: number
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredProjectMember = {
  projectId: string
  userId: string
  role: 'owner' | 'member' | 'observer'
  active: boolean
  createdAt: string
}

export type TaskStatus =
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'in_progress'
  | 'needs_human'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StoredTask = {
  taskId: string
  projectId: string
  assigneeAgentId: string
  createdByAgentId: string
  title: string
  objective: string
  completionCriteria: string[]
  dependencyTaskIds: string[]
  fileIntent: import('@sciforge/collaboration-contracts').TaskFileIntent | null
  resourceRefIds: string[]
  executionFence: import('@sciforge/collaboration-contracts').TaskExecutionFence
  status: TaskStatus
  retryCount: number
  maxRetries: number
  coordinationRound: number
  activeTurnId?: string
  resultSummary?: string
  failureSummary?: string
  revision: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type StoredProjectContentSpaceBinding = {
  projectId: string
  rootLocator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator
  rootLocatorDigest: string
  authorization: {
    proofId: string
    issuer: string
    proofDigest: string
    principal: import('@sciforge/collaboration-contracts').ContentSpacePrincipalBinding
    scopes: ['content-space.read', 'content-space.upload-new']
    issuedAt: string
    expiresAt: string
  }
  status: 'active' | 'closed'
  revision: number
  createdAt: string
  updatedAt: string
}

export type StoredCloudResourceRef = {
  resourceRefId: string
  projectId: string
  taskId: string
  executionId: string
  taskRevision: number
  bindingRevision: number
  intentDigest: string
  role: 'input-file' | 'output-container'
  ordinal: number
  locator: import('@sciforge/collaboration-contracts').PortableContentSpaceLocator
  locatorDigest: string
  status: 'available' | 'invalidated' | 'revoked'
  invalidatedAt?: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type ProjectRecordKind = 'observation' | 'proposal' | 'decision' | 'summary' | 'task_result'

export type StoredProjectRecord = {
  projectRecordId: string
  projectId: string
  kind: ProjectRecordKind
  status: 'candidate' | 'accepted' | 'rejected'
  summary: string
  authorUserId?: string
  authorAgentId?: string
  sourceTaskId?: string
  sourceRevision?: number
  acceptedByUserId?: string
  acceptedByAgentId?: string
  acceptedAt?: string
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
  taskId: string
  executionId: string
  targetUserId: string
  requestedByAgentId: string
  requiredAssurance: 'basic' | 'verified' | 'strong'
  prompt: string
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
  taskId: string
  executionId: string
  requestRevision: number
  answeredByUserId: string
  answeredFromHumanEndpointId: string
  assurance: 'basic' | 'verified' | 'strong'
  answer: string
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
