import type { z } from 'zod'
import { redactCredentials } from './core.js'
import {
  agentNodeSchema,
  endpointChallengeSchema,
  humanAnswerSchema,
  humanEndpointBindingSchema,
  humanNeededSchema,
  participantProfileSchema,
  projectInputSchema,
  projectRecordSchema,
  projectSchema,
  remoteSessionProjectionSchema,
  taskSchema,
  userPrincipalSchema
} from './entities.js'
import {
  agentInboxMessageSchema,
  agentInboxPayloadSchema,
  operationReceiptSchema,
  restRequestSchema,
  webSocketMessageSchema
} from './protocol.js'
import {
  providerEventSchema,
  providerIdentitySchema,
  providerLocatorSchema
} from './provider.js'

export const TEST_TIMESTAMP = '2026-08-15T08:00:00.000Z'
export const TEST_LATER_TIMESTAMP = '2026-08-15T08:01:00.000Z'
export const TEST_HASH = 'a'.repeat(64)

export const TEST_IDS = Object.freeze({
  userId: 'usr_User00000001',
  secondUserId: 'usr_User00000002',
  humanEndpointId: 'hep_Endp00000001',
  agentId: 'agt_Agent0000001',
  secondAgentId: 'agt_Agent0000002',
  participantId: 'par_Part00000001',
  projectionId: 'rsp_Proj00000001',
  projectInputId: 'pin_Input0000001',
  projectId: 'prj_Proj00000001',
  projectMembershipId: 'pmb_Member000001',
  taskAuthorityId: 'tau_Authority0001',
  providerPrincipalFactId: 'ppf_Principal00001',
  providerObservationId: 'pob_Observe000001',
  provisioningIntentId: 'pci_Provision00001',
  provisioningAttestationId: 'pca_Attest0000001',
  projectContentBindingId: 'pcb_Binding000001',
  contentRecoveryJournalEntryId: 'crj_Journal000001',
  recoveryActionId: 'rca_Recovery00001',
  taskId: 'tsk_Task00000001',
  executionId: 'exe_Exec00000001',
  taskOfferId: 'ofr_Offer00000001',
  projectPlanId: 'pln_ProjectPlan01',
  resultSubmissionId: 'rsu_Result000001',
  reviewDecisionId: 'rvw_Review000001',
  resourceRefId: 'rrf_Reso00000001',
  projectRecordId: 'rec_Rec000000001',
  inboxMessageId: 'ibx_Inbox0000001',
  receiptId: 'rcp_Receip000001',
  humanRequestId: 'hrq_Human0000001',
  humanAnswerId: 'han_Answer000001',
  challengeId: 'chl_Chall0000001',
  requestId: 'req_Reque0000001',
  localItemId: 'lit_Local0000001',
  turnId: 'trn_Turn00000001',
  deviceId: 'dev_Device000001',
  installationId: 'ins_Insta0000001'
})

export const providerIdentityFixture = providerIdentitySchema.parse({
  type: 'provider_identity',
  provider: 'example-im',
  realmId: 'realm-hong-kong',
  providerUserId: 'provider-user-42',
  displayName: '测试用户'
})

export const chineseProviderLocatorFixture = providerLocatorSchema.parse({
  type: 'provider_locator',
  provider: 'example-im',
  realmId: 'realm-hong-kong',
  containerId: 'container-100',
  topicId: 'topic-stable-100',
  containerDisplayName: '科研协作',
  topicDisplayName: '蛋白质结构分析（上海样本）'
})

export const userPrincipalFixture = userPrincipalSchema.parse({
  schemaVersion: 1,
  type: 'user_principal',
  userId: TEST_IDS.userId,
  displayName: '测试用户',
  status: 'active',
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const humanEndpointBindingFixture = humanEndpointBindingSchema.parse({
  schemaVersion: 1,
  type: 'human_endpoint_binding',
  humanEndpointId: TEST_IDS.humanEndpointId,
  userId: TEST_IDS.userId,
  identity: providerIdentityFixture,
  displayName: '测试手机',
  assurance: 'verified',
  status: 'active',
  verifiedAt: TEST_TIMESTAMP,
  lastSeenAt: TEST_LATER_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const endpointChallengeFixture = endpointChallengeSchema.parse({
  schemaVersion: 1,
  type: 'endpoint_challenge',
  challengeId: TEST_IDS.challengeId,
  userId: TEST_IDS.userId,
  expectedIdentity: providerIdentityFixture,
  status: 'pending',
  expiresAt: TEST_LATER_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const agentNodeFixture = agentNodeSchema.parse({
  schemaVersion: 1,
  type: 'agent_node',
  agentId: TEST_IDS.agentId,
  deviceId: TEST_IDS.deviceId,
  ownerUserId: TEST_IDS.userId,
  displayName: '实验室桌面机',
  nodeType: 'desktop',
  capabilities: ['agent.execute', 'workspace.read'],
  lifecycleStatus: 'active',
  connectionStatus: 'online',
  credentialVersion: 1,
  lastSeenAt: TEST_LATER_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const participantProfileFixture = participantProfileSchema.parse({
  schemaVersion: 1,
  type: 'participant_profile',
  participantId: TEST_IDS.participantId,
  userId: TEST_IDS.userId,
  primaryHumanEndpointId: TEST_IDS.humanEndpointId,
  primaryAgentId: TEST_IDS.agentId,
  status: 'active',
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const remoteSessionProjectionFixture = remoteSessionProjectionSchema.parse({
  schemaVersion: 1,
  type: 'remote_session_projection',
  projectionId: TEST_IDS.projectionId,
  ownerUserId: TEST_IDS.userId,
  agentId: TEST_IDS.agentId,
  humanEndpointId: TEST_IDS.humanEndpointId,
  locator: chineseProviderLocatorFixture,
  locatorRevision: 1,
  displayName: '蛋白质结构分析',
  status: 'active',
  allowedSenderUserIds: [TEST_IDS.userId],
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const projectInputFixture = projectInputSchema.parse({
  schemaVersion: 1,
  type: 'project_input',
  projectInputId: TEST_IDS.projectInputId,
  projectId: TEST_IDS.projectId,
  senderUserId: TEST_IDS.userId,
  sourceHumanEndpointId: TEST_IDS.humanEndpointId,
  providerMessageId: 'provider-message-1',
  sequence: 1,
  text: '请分析这批样本。',
  status: 'queued',
  occurredAt: TEST_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const projectFixture = projectSchema.parse({
  schemaVersion: 1,
  type: 'project',
  projectId: TEST_IDS.projectId,
  ownerUserId: TEST_IDS.userId,
  displayName: '联合研究项目',
  goal: '完成样本分析并形成可审查结论。',
  coordinatorAgentId: TEST_IDS.agentId,
  coordinatorAuthorityEpoch: 1,
  executionAuthorityEpoch: 1,
  contentMode: 'none',
  status: 'active',
  budget: {
    maxTasks: 20,
    maxTasksPerRound: 4,
    maxCoordinationRounds: 10,
    maxTaskRetries: 2
  },
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const taskFixture = taskSchema.parse({
  schemaVersion: 1,
  type: 'task',
  taskId: TEST_IDS.taskId,
  projectId: TEST_IDS.projectId,
  createdByCoordinatorAgentId: TEST_IDS.agentId,
  title: '分析样本',
  objective: '验证样本质量并总结异常。',
  completionCriteria: ['提交结果摘要', '标记异常样本'],
  dependencyTaskIds: [],
  fileIntent: null,
  currentExecutionId: TEST_IDS.executionId,
  currentExecutionState: 'offered',
  status: 'offered',
  executionCount: 1,
  maxRetries: 2,
  completedAt: null,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const projectRecordFixture = projectRecordSchema.parse({
  schemaVersion: 1,
  type: 'project_record',
  projectRecordId: TEST_IDS.projectRecordId,
  projectId: TEST_IDS.projectId,
  kind: 'observation',
  status: 'proposed',
  body: '样本质量满足后续分析要求。',
  authorUserId: TEST_IDS.userId,
  authorAgentId: TEST_IDS.agentId,
  sourceTaskId: TEST_IDS.taskId,
  sourceRevision: 1,
  acceptedByUserId: null,
  acceptedByAgentId: null,
  acceptedAt: null,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const humanNeededFixture = humanNeededSchema.parse({
  schemaVersion: 1,
  type: 'human_needed',
  humanRequestId: TEST_IDS.humanRequestId,
  projectId: TEST_IDS.projectId,
  taskId: TEST_IDS.taskId,
  executionId: TEST_IDS.executionId,
  targetUserId: TEST_IDS.userId,
  requestedByAgentId: TEST_IDS.agentId,
  requiredAssurance: 'verified',
  prompt: '是否继续处理异常样本？',
  confirmableAction: null,
  status: 'pending',
  expiresAt: TEST_LATER_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_TIMESTAMP
})

export const humanAnswerFixture = humanAnswerSchema.parse({
  schemaVersion: 1,
  type: 'human_answer',
  humanAnswerId: TEST_IDS.humanAnswerId,
  humanRequestId: TEST_IDS.humanRequestId,
  projectId: TEST_IDS.projectId,
  taskId: TEST_IDS.taskId,
  executionId: TEST_IDS.executionId,
  requestRevision: 1,
  answeredByUserId: TEST_IDS.userId,
  answeredFromOidcIdentityId: 'oid_TestIdentity001',
  assurance: 'verified',
  answer: '继续，但请保留原始结果。',
  decision: null,
  confirmationId: null,
  answeredAt: TEST_LATER_TIMESTAMP,
  revision: 1,
  createdAt: TEST_TIMESTAMP,
  updatedAt: TEST_LATER_TIMESTAMP
})

export const providerEventFixture = providerEventSchema.parse({
  protocolVersion: '1.0',
  type: 'provider.message.created',
  provider: 'example-im',
  eventId: 'provider-event-1',
  eventCursor: 'cursor-1',
  occurredAt: TEST_TIMESTAMP,
  identity: providerIdentityFixture,
  locator: chineseProviderLocatorFixture,
  providerMessageId: 'provider-message-1',
  text: '从手机发送的测试消息',
  isSelfEcho: false
})

export const projectionUpdatedPayloadFixture = agentInboxPayloadSchema.parse({
  protocolVersion: '1.0',
  type: 'projection.updated',
  projectionId: TEST_IDS.projectionId,
  revision: 2
})

export const agentInboxMessageFixture = agentInboxMessageSchema.parse({
  schemaVersion: 1,
  type: 'inbox_message',
  inboxMessageId: TEST_IDS.inboxMessageId,
  recipientType: 'agent',
  recipientAgentId: TEST_IDS.agentId,
  sequence: 1,
  status: 'pending',
  createdAt: TEST_TIMESTAMP,
  payload: {
    protocolVersion: '1.0',
    type: 'personal.message.received',
    projectionId: TEST_IDS.projectionId,
    projectionRevision: 1,
    senderUserId: TEST_IDS.userId,
    humanEndpointId: TEST_IDS.humanEndpointId,
    providerMessageId: 'provider-message-1',
    text: '从手机发送的测试消息',
    occurredAt: TEST_TIMESTAMP
  }
})

export const operationReceiptFixture = operationReceiptSchema.parse({
  schemaVersion: 1,
  type: 'operation.receipt',
  receiptId: TEST_IDS.receiptId,
  actor: {
    actorType: 'agent',
    userId: TEST_IDS.userId,
    agentId: TEST_IDS.agentId,
    assurance: 'strong'
  },
  idempotencyKey: 'idem_fixture_operation_0001',
  requestHash: TEST_HASH,
  status: 'succeeded',
  resultHash: TEST_HASH,
  createdAt: TEST_TIMESTAMP
})

export const restRequestFixture = restRequestSchema.parse({
  protocolVersion: '1.0',
  requestId: TEST_IDS.requestId,
  type: 'project.get',
  projectId: TEST_IDS.projectId
})

export const webSocketMessageFixture = webSocketMessageSchema.parse({
  protocolVersion: '1.0',
  type: 'inbox.available',
  recipientType: 'agent',
  highestSequence: 1
})

export function invalidTestOnlyValue(label: string): string {
  return ['INVALID', 'TEST', 'ONLY', label].join('_')
}

export const INVALID_TEST_ONLY_CREDENTIAL_FIXTURE = Object.freeze({
  authorization: ['Bearer', invalidTestOnlyValue('BEARER_VALUE')].join(' '),
  nested: {
    deviceToken: invalidTestOnlyValue('DEVICE_VALUE'),
    apiKey: invalidTestOnlyValue('API_VALUE'),
    privateKey: [
      ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
      invalidTestOnlyValue('KEY_MATERIAL'),
      ['-----END', 'PRIVATE', 'KEY-----'].join(' ')
    ].join('\n')
  },
  safe: 'diagnostic-safe-value'
})

export const redactedCredentialFixture = redactCredentials(INVALID_TEST_ONLY_CREDENTIAL_FIXTURE)

export const agentRegisteredResponseFixture = {
  protocolVersion: '1.0' as const,
  type: 'agent.registered' as const,
  requestId: TEST_IDS.requestId,
  agent: agentNodeFixture,
  sealedCredential: {
    schemaVersion: 1 as const,
    algorithm: 'X25519-HKDF-SHA256+A256GCM' as const,
    agentId: TEST_IDS.agentId,
    deviceId: TEST_IDS.deviceId,
    credentialGeneration: 1,
    issuedAt: TEST_TIMESTAMP,
    ephemeralPublicKey: { kty: 'OKP' as const, crv: 'X25519' as const,
      x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    salt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'AQID',
    authenticationTag: 'AAAAAAAAAAAAAAAAAAAAAA'
  }
}

export const collaborationFixtures = Object.freeze({
  userPrincipal: userPrincipalFixture,
  humanEndpointBinding: humanEndpointBindingFixture,
  endpointChallenge: endpointChallengeFixture,
  agentNode: agentNodeFixture,
  participantProfile: participantProfileFixture,
  remoteSessionProjection: remoteSessionProjectionFixture,
  projectInput: projectInputFixture,
  project: projectFixture,
  task: taskFixture,
  projectRecord: projectRecordFixture,
  humanNeeded: humanNeededFixture,
  humanAnswer: humanAnswerFixture,
  providerEvent: providerEventFixture,
  projectionUpdatedPayload: projectionUpdatedPayloadFixture,
  agentInboxMessage: agentInboxMessageFixture,
  operationReceipt: operationReceiptFixture,
  restRequest: restRequestFixture,
  webSocketMessage: webSocketMessageFixture
})

export type CollaborationFixtures = typeof collaborationFixtures
export type TestIds = typeof TEST_IDS
export type FixtureSchemaOutput<Schema extends z.ZodType> = z.output<Schema>
