import { z } from 'zod'
import {
  assuranceLevelSchema,
  challengeIdSchema,
  displayNameSchema,
  humanEndpointIdSchema,
  nonEmptyTextSchema,
  protocolVersionSchema,
  providerCursorSchema,
  providerIdSchema,
  providerMessageIdSchema,
  providerOpaqueIdSchema,
  redactedJsonSchema,
  timestampSchema,
  userIdSchema
} from './core.js'

export const providerIdentitySchema = z.object({
  type: z.literal('provider_identity'),
  provider: providerIdSchema,
  realmId: providerOpaqueIdSchema,
  providerUserId: providerOpaqueIdSchema,
  displayName: displayNameSchema.optional()
}).strict()
export type ProviderIdentity = z.infer<typeof providerIdentitySchema>

export const providerDirectRecipientSchema = z.object({
  type: z.literal('provider_direct_recipient'),
  provider: providerIdSchema,
  realmId: providerOpaqueIdSchema,
  providerUserId: providerOpaqueIdSchema
}).strict()
export type ProviderDirectRecipient = z.infer<typeof providerDirectRecipientSchema>

export const providerLocatorSchema = z.object({
  type: z.literal('provider_locator'),
  provider: providerIdSchema,
  realmId: providerOpaqueIdSchema,
  containerId: providerOpaqueIdSchema,
  topicId: providerOpaqueIdSchema,
  containerDisplayName: displayNameSchema.optional(),
  topicDisplayName: displayNameSchema.optional()
}).strict()
export type ProviderLocator = z.infer<typeof providerLocatorSchema>

export const providerManagedContainerRefSchema = z.object({
  type: z.literal('provider_managed_container_ref'),
  provider: providerIdSchema,
  realmId: providerOpaqueIdSchema,
  containerId: providerOpaqueIdSchema
}).strict()
export type ProviderManagedContainerRef = z.infer<typeof providerManagedContainerRefSchema>

export const providerManagedContainerPolicySchema = z.object({
  version: z.literal(1),
  visibility: z.literal('private'),
  history: z.literal('protected'),
  membership: z.literal('owner_and_message_bot'),
  memberManagement: z.literal('provisioning_service_only'),
  channelManagement: z.literal('provisioning_service_only'),
  ownerCanSend: z.literal(true),
  ownerCanCreateTopics: z.literal(true),
  messageBotCanSend: z.literal(true),
  messageBotCreatesProjectTopics: z.literal(false)
}).strict()
export type ProviderManagedContainerPolicy = z.infer<typeof providerManagedContainerPolicySchema>

const providerManagedContainerTargetSchema = z.object({
  protocolVersion: protocolVersionSchema,
  realmId: providerOpaqueIdSchema,
  ownerIdentity: providerIdentitySchema,
  policy: providerManagedContainerPolicySchema
}).strict()

export const providerManagedContainerRequestSchema = z.discriminatedUnion('type', [
  providerManagedContainerTargetSchema.extend({
    type: z.literal('provider.managed_container.ensure'),
    stableKey: providerOpaqueIdSchema,
    displayName: displayNameSchema
  }).strict(),
  providerManagedContainerTargetSchema.extend({
    type: z.literal('provider.managed_container.inspect'),
    container: providerManagedContainerRefSchema
  }).strict(),
  providerManagedContainerTargetSchema.extend({
    type: z.literal('provider.managed_container.reconcile'),
    container: providerManagedContainerRefSchema,
    displayName: displayNameSchema
  }).strict(),
  providerManagedContainerTargetSchema.extend({
    type: z.literal('provider.managed_container.archive'),
    container: providerManagedContainerRefSchema
  }).strict()
])
export type ProviderManagedContainerRequest = z.infer<typeof providerManagedContainerRequestSchema>

export const providerManagedContainerResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.managed_container.result'),
  container: providerManagedContainerRefSchema,
  displayName: displayNameSchema,
  status: z.enum(['active', 'drifted', 'archived']),
  policyVersion: z.literal(1),
  checks: z.object({
    private: z.boolean(),
    protectedHistory: z.boolean(),
    exactMembership: z.boolean(),
    ownerCanSend: z.boolean(),
    messageBotCanSend: z.boolean(),
    ownerCanCreateTopics: z.boolean(),
    memberManagementRestricted: z.boolean(),
    channelManagementRestricted: z.boolean()
  }).strict(),
  safeIssueCodes: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u)).max(32),
  observedAt: timestampSchema
}).strict()
export type ProviderManagedContainerResult = z.infer<typeof providerManagedContainerResultSchema>

/** Versioned, short-lived display reference. The server stores only its digest. */
export const remoteApprovalReferenceSchema = z.string().regex(/^AP1-[A-Z2-9]{20}$/u)
export type RemoteApprovalReference = z.infer<typeof remoteApprovalReferenceSchema>

const providerEventEnvelopeShape = {
  protocolVersion: protocolVersionSchema,
  provider: providerIdSchema,
  eventId: providerOpaqueIdSchema,
  eventCursor: providerCursorSchema,
  occurredAt: timestampSchema
} as const

export const providerMessageCreatedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.message.created'),
  identity: providerIdentitySchema,
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema,
  text: nonEmptyTextSchema,
  isSelfEcho: z.boolean()
}).strict()

export const providerMessageEditedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.message.edited'),
  identity: providerIdentitySchema,
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema,
  replacementText: nonEmptyTextSchema
}).strict()

export const providerMessageDeletedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.message.deleted'),
  identity: providerIdentitySchema,
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema
}).strict()

export const providerReactionEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.message.reaction'),
  identity: providerIdentitySchema,
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema,
  reaction: z.string().trim().min(1).max(100),
  operation: z.enum(['added', 'removed'])
}).strict()

export const providerLocatorChangedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.locator.changed'),
  actorIdentity: providerIdentitySchema.optional(),
  previousLocator: providerLocatorSchema,
  currentLocator: providerLocatorSchema
}).strict()

export const providerChallengeRespondedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.challenge.responded'),
  identity: providerIdentitySchema,
  challengeId: challengeIdSchema,
  challengeResponse: z.string().min(8).max(512)
}).strict()

export const providerChallengeInvalidEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.challenge.invalid'),
  identity: providerIdentitySchema
}).strict()

export const providerRemoteApprovalRespondedEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.remote_approval.responded'),
  identity: providerIdentitySchema,
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema,
  approvalReference: remoteApprovalReferenceSchema,
  decision: z.enum(['allow_once', 'deny_once'])
}).strict()
export type ProviderRemoteApprovalRespondedEvent = z.infer<
  typeof providerRemoteApprovalRespondedEventSchema
>

export const providerLifecycleEventSchema = z.object({
  ...providerEventEnvelopeShape,
  type: z.literal('provider.lifecycle.changed'),
  status: z.enum(['connected', 'disconnected', 'degraded']),
  reason: z.string().trim().min(1).max(500).optional()
}).strict()

export const providerEventSchema = z.discriminatedUnion('type', [
  providerMessageCreatedEventSchema,
  providerMessageEditedEventSchema,
  providerMessageDeletedEventSchema,
  providerReactionEventSchema,
  providerLocatorChangedEventSchema,
  providerChallengeRespondedEventSchema,
  providerChallengeInvalidEventSchema,
  providerRemoteApprovalRespondedEventSchema,
  providerLifecycleEventSchema
])
export type ProviderEvent = z.infer<typeof providerEventSchema>

const providerMessagePresentationSchema = z.object({
  disposition: z.literal('collapsible'),
  summary: z.string().trim().min(1).max(120)
}).strict()

const providerLocatorMessageSendRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.send.message'),
  locator: providerLocatorSchema,
  clientMessageId: providerOpaqueIdSchema,
  text: nonEmptyTextSchema,
  presentation: providerMessagePresentationSchema.optional()
}).strict()

const providerDirectMessageSendRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.send.message'),
  recipient: providerDirectRecipientSchema,
  clientMessageId: providerOpaqueIdSchema,
  text: nonEmptyTextSchema,
  presentation: providerMessagePresentationSchema.optional()
}).strict()

export const providerSendRequestSchema = z.union([
  providerLocatorMessageSendRequestSchema,
  providerDirectMessageSendRequestSchema,
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.send.status'),
    locator: providerLocatorSchema,
    clientMessageId: providerOpaqueIdSchema,
    status: z.enum(['queued', 'running', 'needs_desktop_approval', 'failed', 'completed']),
    text: z.string().trim().min(1).max(2_000)
  }).strict()
])
export type ProviderSendRequest = z.infer<typeof providerSendRequestSchema>

export const providerUpdateMessageRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.update.message'),
  locator: providerLocatorSchema,
  providerMessageId: providerMessageIdSchema,
  clientMessageId: providerOpaqueIdSchema,
  text: nonEmptyTextSchema
}).strict()
export type ProviderUpdateMessageRequest = z.infer<typeof providerUpdateMessageRequestSchema>

export const providerSendResultSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.send.succeeded'),
    clientMessageId: providerOpaqueIdSchema,
    providerMessageId: providerMessageIdSchema,
    sentAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.send.failed'),
    clientMessageId: providerOpaqueIdSchema,
    retryable: z.boolean(),
    providerErrorCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u),
    safeMessage: z.string().trim().min(1).max(500)
  }).strict()
])
export type ProviderSendResult = z.infer<typeof providerSendResultSchema>

export const providerLocatorMutationRequestSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.locator.rename'),
    locator: providerLocatorSchema,
    newTopicDisplayName: displayNameSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.locator.move'),
    locator: providerLocatorSchema,
    destinationContainerId: providerOpaqueIdSchema,
    destinationContainerDisplayName: displayNameSchema.optional()
  }).strict()
])
export type ProviderLocatorMutationRequest = z.infer<typeof providerLocatorMutationRequestSchema>

export const providerLocatorMutationResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.locator.updated'),
  locator: providerLocatorSchema,
  updatedAt: timestampSchema
}).strict()
export type ProviderLocatorMutationResult = z.infer<typeof providerLocatorMutationResultSchema>

export const providerLocatorListRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.locator.list'),
  realmId: providerOpaqueIdSchema,
  container: providerManagedContainerRefSchema.optional(),
  containerDisplayName: displayNameSchema.optional(),
  query: z.string().trim().max(200).optional(),
  cursor: providerCursorSchema.optional(),
  limit: z.number().int().min(1).max(500)
}).strict()
export type ProviderLocatorListRequest = z.infer<typeof providerLocatorListRequestSchema>

export const providerLocatorListResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.locator.page'),
  locators: z.array(providerLocatorSchema).max(500),
  nextCursor: providerCursorSchema.optional()
}).strict()
export type ProviderLocatorListResult = z.infer<typeof providerLocatorListResultSchema>

export const providerVerifyIdentityRequestSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.identity.verify'),
  challengeId: challengeIdSchema,
  expectedIdentity: providerIdentitySchema,
  challengeResponse: z.string().min(8).max(512)
}).strict()
export type ProviderVerifyIdentityRequest = z.infer<typeof providerVerifyIdentityRequestSchema>

export const providerVerifyIdentityResultSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.identity.verified'),
    identity: providerIdentitySchema,
    assurance: assuranceLevelSchema,
    verifiedAt: timestampSchema
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.identity.rejected'),
    reason: z.enum(['invalid', 'expired', 'identity_mismatch', 'already_consumed'])
  }).strict()
])
export type ProviderVerifyIdentityResult = z.infer<typeof providerVerifyIdentityResultSchema>

export const providerLifecycleRequestSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.lifecycle.start'),
    afterCursor: providerCursorSchema.optional()
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.lifecycle.stop')
  }).strict(),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal('provider.lifecycle.health')
  }).strict()
])
export type ProviderLifecycleRequest = z.infer<typeof providerLifecycleRequestSchema>

export const providerLifecycleResultSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.lifecycle.status'),
  status: z.enum(['connected', 'disconnected', 'degraded']),
  cursor: providerCursorSchema.optional(),
  checkedAt: timestampSchema
}).strict()
export type ProviderLifecycleResult = z.infer<typeof providerLifecycleResultSchema>

export const providerDiagnosticSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('provider.diagnostic'),
  provider: providerIdSchema,
  status: z.enum(['healthy', 'degraded', 'unavailable']),
  checkedAt: timestampSchema,
  safeSummary: z.string().trim().min(1).max(500),
  details: redactedJsonSchema.optional()
}).strict()
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>

export const humanEndpointProviderContractSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal('human_endpoint_provider_contract'),
  provider: providerIdSchema,
  displayName: displayNameSchema,
  capabilities: z.object({
    textMessages: z.literal(true),
    stableLocators: z.literal(true),
    eventCursor: z.literal(true),
    locatorRename: z.boolean(),
    locatorMove: z.boolean(),
    locatorDiscovery: z.boolean(),
    identityChallenge: z.literal(true),
    directMessages: z.literal(true),
    managedContainers: z.boolean().optional(),
    messageUpdates: z.boolean().optional()
  }).strict(),
  onboarding: z.object({
    realmLabel: displayNameSchema,
    accountLabel: displayNameSchema,
    containerLabel: displayNameSchema,
    topicLabel: displayNameSchema
  }).strict(),
  limits: z.object({
    maxTextLength: z.number().int().min(1).max(1_000_000),
    maxLocatorDisplayLength: z.number().int().min(1).max(10_000)
  }).strict()
}).strict()
export type HumanEndpointProviderContract = z.infer<typeof humanEndpointProviderContractSchema>

export interface HumanEndpointProvider {
  readonly contract: HumanEndpointProviderContract
  verifyIdentity(request: ProviderVerifyIdentityRequest): Promise<ProviderVerifyIdentityResult>
  events(request: Extract<ProviderLifecycleRequest, { type: 'provider.lifecycle.start' }>): AsyncIterable<ProviderEvent>
  send(request: ProviderSendRequest): Promise<ProviderSendResult>
  updateMessage?(request: ProviderUpdateMessageRequest): Promise<ProviderSendResult>
  listLocators(request: ProviderLocatorListRequest): Promise<ProviderLocatorListResult>
  updateLocator(request: ProviderLocatorMutationRequest): Promise<ProviderLocatorMutationResult>
  manageContainer?(request: ProviderManagedContainerRequest): Promise<ProviderManagedContainerResult>
  lifecycle(request: ProviderLifecycleRequest): Promise<ProviderLifecycleResult>
  diagnose(): Promise<ProviderDiagnostic>
}

export interface HumanEndpointProviderServices {
  resolveLocator(input: Readonly<{
    provider: string
    realmId: string
    containerId: string
    topicDisplayName: string
  }>): Promise<ProviderLocator | undefined>
  claimEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
    dedupeKey: string
  }>): Promise<'claimed' | 'duplicate'>
  readDelivery(clientMessageId: string): Promise<ProviderSendResult | undefined>
  reconcileDelivery(request: ProviderSendRequest): Promise<ProviderSendResult | undefined>
  recordDelivery(clientMessageId: string, result: ProviderSendResult): Promise<void>
  verifyChallenge(request: ProviderVerifyIdentityRequest): Promise<ProviderVerifyIdentityResult>
  reportDiagnostic(diagnostic: ProviderDiagnostic): void
}

export interface HumanEndpointProviderFactoryContext {
  readonly provider: string
  readonly configuration: Readonly<Record<string, string | number | boolean>>
  /** Non-secret root containing provider-owned secret files named by configuration references. */
  readonly secretFileDirectory: string
  readonly services: HumanEndpointProviderServices
  readonly now: () => string
}

export type HumanEndpointProviderFactory = (
  context: HumanEndpointProviderFactoryContext
) => HumanEndpointProvider | Promise<HumanEndpointProvider>

export const verifiedProviderActorSchema = z.object({
  type: z.literal('verified_provider_actor'),
  userId: userIdSchema,
  humanEndpointId: humanEndpointIdSchema,
  identity: providerIdentitySchema,
  assurance: assuranceLevelSchema
}).strict()
export type VerifiedProviderActor = z.infer<typeof verifiedProviderActorSchema>
