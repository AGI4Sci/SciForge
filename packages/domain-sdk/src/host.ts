import { z } from 'zod'

import type { DomainMainAgentExecutionHost } from './agent-execution.js'
import type { DomainMainExternalNavigationHost } from './external-navigation.js'
import type {
  DomainMainFileTransferHost,
  DomainRendererFileTransferHost
} from './file-transfer.js'
import {
  domainPackageJsonValueSchema,
  domainPackageModuleIdSchema,
  domainPackagePermissionIdSchema,
  domainPackageStableVersionSchema,
  type DomainPackageContributionPublicReleasePolicy,
  type DomainPackageJsonValue
} from './contract.js'
import {
  canonicalizeReproValue,
  type DomainExecutionEventInput,
  type DomainExecutionEventV1
} from './reproducibility.js'
import type { DomainMainPowerHost } from './power.js'
import type { DomainMainRemoteCapabilityApprovalHost } from './remote-approval.js'
import type { DomainMainPortableResourceReferencesHost } from './portable-resource-references.js'
import type {
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from './principal.js'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost
} from './package-storage.js'
import type { TrustedDomainProcessEntryInput } from './process-entry.js'
import {
  domainCapabilityResourceHandleSchema,
  domainWorkbenchRightPanelPlacementSchema,
  type DomainCapabilityResourceHandle,
  type DomainRendererSessionResource,
  type DomainRendererWorkbenchSendMessageInput,
  type DomainRendererWorkbenchSendMessageResult,
  type DomainRendererWorkbenchSurfaceActivation,
  type DomainRendererWorkspaceFilePickerRequest,
  type DomainRendererWorkspacePickResult
} from './renderer-contributions.js'
import type { DomainWorkflowExecutionReceiptProvider } from './workflow-template.js'
import type { DomainMainVisualCaptureHost } from './visual-capture.js'
import type {
  WorkspaceHostArtifact,
  WorkspaceHostOpenRemoteSessionInput
} from './workspace-host.js'
export * from './agent-execution.js'
export * from './external-navigation.js'
export * from './file-transfer.js'
export * from './power.js'
export * from './remote-approval.js'
export * from './portable-resource-references.js'
export * from './package-storage.js'
export * from './renderer-contributions.js'
export * from './visual-capture.js'
export * from './workflow-template.js'

export const MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND = 'main.runtime-lifecycle' as const
export const MAIN_ARTIFACT_CONSUMER_CONTRIBUTION_KIND =
  'main.artifact-consumer' as const
export const MAIN_ACTION_GUARD_CONTRIBUTION_KIND = 'main.action-guard' as const
export const MAIN_RUNTIME_MCP_SERVER_CONTRIBUTION_KIND =
  'main.runtime-mcp-server' as const
export const MAIN_MCP_TRUSTED_INVOCATION_METADATA_CONTRIBUTION_KIND =
  'main.mcp-trusted-invocation-metadata' as const

export type DomainRuntimeMcpServerConfig = Readonly<{
  id: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  timeoutMs?: number
  enabledTools?: readonly string[]
  disabled?: boolean
}>

export type DomainMainRuntimeMcpServerContribution = Readonly<{
  serverId: string
  createConfig: (settings: unknown) => DomainRuntimeMcpServerConfig | null
  isRuntimeEnabled?: (settings: unknown, runtimeId: string) => boolean
}>

export type DomainMcpTrustedInvocationMetadataContribution = Readonly<{
  serverId: string
  tools: readonly string[]
  metadataKey: string
  source: 'trusted-invocation'
}>
export const MAIN_EXTENSION_CONTRIBUTION_KIND = 'main.extension' as const
export const MAIN_INTERNAL_SERVICE_DESCRIPTOR_LOCATION =
  'main.internal-service-descriptor' as const
export const MAIN_SYSTEM_CAPABILITY_GRANT_CONTRIBUTION_KIND =
  'main.system-capability-grant' as const

export const domainMainSystemCapabilityGrantSchema = z.object({
  id: domainPackagePermissionIdSchema,
  // Trusted compile-time packages are part of the bundled Host composition.
  // This eligibility is intentionally package-generic: any such installed
  // package may request the provider-owned grant in its canonical manifest.
  eligibility: z.literal('trusted-domain-runtime'),
  description: z.string().trim().min(1).max(500)
}).strict()

export type DomainMainSystemCapabilityGrant = z.infer<
  typeof domainMainSystemCapabilityGrantSchema
>

export function defineDomainMainSystemCapabilityGrant(
  input: DomainMainSystemCapabilityGrant
): DomainMainSystemCapabilityGrant {
  return Object.freeze(domainMainSystemCapabilityGrantSchema.parse(input))
}

export function isDomainMainSystemCapabilityGrant(
  value: unknown
): value is DomainMainSystemCapabilityGrant {
  return domainMainSystemCapabilityGrantSchema.safeParse(value).success
}

/**
 * Declarative authority request for one package-owned lifecycle. Grant
 * identifiers are provider-owned public contract values; the Host resolves
 * the request against installed providers before issuing scoped authority and
 * does not recognize domain-specific IDs.
 */
export const domainMainRuntimeLifecycleContractSchema = z.object({
  requestedSystemCapabilityGrants: z.array(domainPackagePermissionIdSchema).max(128).default([])
}).strict().superRefine((contract, context) => {
  if (
    new Set(contract.requestedSystemCapabilityGrants).size !==
    contract.requestedSystemCapabilityGrants.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['requestedSystemCapabilityGrants'],
      message: 'Requested system capability grants must be unique.'
    })
  }
})

export type DomainMainRuntimeLifecycleContract = z.infer<
  typeof domainMainRuntimeLifecycleContractSchema
>

export const domainMainExtensionContractSchema = z.object({
  location: z.string().trim().min(1).max(192)
}).passthrough()

export type DomainMainExtensionContract = z.infer<
  typeof domainMainExtensionContractSchema
>

export const domainMainInternalServiceDescriptorSchema = z.object({
  location: z.literal(MAIN_INTERNAL_SERVICE_DESCRIPTOR_LOCATION),
  serviceId: domainPackageModuleIdSchema,
  contractVersion: domainPackageStableVersionSchema,
  allowedConsumerModuleIds: z.array(domainPackageModuleIdSchema).min(1).max(128)
}).strict().superRefine((descriptor, context) => {
  if (new Set(descriptor.allowedConsumerModuleIds).size !==
    descriptor.allowedConsumerModuleIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['allowedConsumerModuleIds'],
      message: 'Internal service consumer module IDs must be unique.'
    })
  }
})

type ParsedDomainMainInternalServiceDescriptor = z.infer<
  typeof domainMainInternalServiceDescriptorSchema
>
export type DomainMainInternalServiceDescriptor = Readonly<
  Omit<ParsedDomainMainInternalServiceDescriptor, 'allowedConsumerModuleIds'> & {
    allowedConsumerModuleIds: readonly string[]
  }
>

export function defineDomainMainInternalServiceDescriptor(
  input: DomainMainInternalServiceDescriptor
): DomainMainInternalServiceDescriptor {
  const descriptor = domainMainInternalServiceDescriptorSchema.parse(input)
  return Object.freeze({
    ...descriptor,
    allowedConsumerModuleIds: Object.freeze([...descriptor.allowedConsumerModuleIds])
  })
}

export type DomainRuntimeContributionOwner = Readonly<{
  moduleId: string
  moduleVersion: string
}>

export type DomainMainContribution = Readonly<{
  id: string
  kind: typeof MAIN_EXTENSION_CONTRIBUTION_KIND
  packageName: string
  owner: DomainRuntimeContributionOwner
  /** Optional manifest declaration version, projected only from trusted metadata. */
  version?: string
  /** Optional manifest policy; absence has the same public-release meaning as allowed. */
  publicRelease?: DomainPackageContributionPublicReleasePolicy
  contract: DomainPackageJsonValue
  value: unknown
}>

export type DomainMainContributionHost = Readonly<{
  list: (kind: typeof MAIN_EXTENSION_CONTRIBUTION_KIND) =>
    readonly DomainMainContribution[]
}>

export type DomainMainRuntimeLogEntry = Readonly<{
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: unknown
}>

export type DomainAgentThreadListInput = Readonly<{
  runtimeId?: string
  limit?: number
  includeArchived?: boolean
  includeSide?: boolean
}>

export type DomainAgentThread = Readonly<{
  id: string
  runtimeId: string
  workspaceRoot?: string
  archived?: boolean
}>

export type DomainAgentThreadTurn = Readonly<{
  id: string
  status?: string
  completedAt?: string
  messages: readonly DomainAgentTranscriptMessage[]
  artifacts: readonly unknown[]
}>

/**
 * Append-only projection of user-visible runtime messages.
 *
 * Assistant progress contains only explicit assistant commentary. Reasoning,
 * tool details, and other runtime artifacts never cross this boundary.
 */
export type DomainAgentTranscriptMessage = Readonly<{
  itemId: string
  turnId?: string
  kind: 'user-message' | 'assistant-progress' | 'assistant-final'
  text: string
  occurredAt?: string
}>

export type DomainAgentTranscriptMessageEvent = DomainAgentTranscriptMessage & Readonly<{
  runtimeId: string
  threadId: string
  /** Monotonic canonical runtime event sequence used for reconnect recovery. */
  sequence: number
}>

export type DomainAgentTranscriptSubscribeInput = Readonly<{
  runtimeId: string
  threadId: string
  afterSequence?: number
  signal?: AbortSignal
}>

export type DomainAgentThreadDetail = DomainAgentThread & Readonly<{
  watermark: string
  turns: readonly DomainAgentThreadTurn[]
  artifacts: readonly unknown[]
}>

type DomainMainTurnLifecycleEventBase = Readonly<{
  runtimeId: string
  threadId: string
  /** Stable Host installation epoch that issued this delivery attempt. */
  issuerEpoch: string
  /** Monotonic Host-issued identity within issuerEpoch. */
  deliveryAttemptOrdinal: number
  /** Host-owned stable identity for the accepted user directive. */
  clientDirectiveId?: string
  workspaceRoot?: string
  /** Immutable Host attribution captured for this exact delivery attempt. */
  principal?: PrincipalSnapshot
  /** Exact signed-in or signed-out Host authorization lease for this attempt. */
  principalContext?: PrincipalContextSnapshot
  occurredAt: string
}>

export type DomainMainBeforeTurnEvent = DomainMainTurnLifecycleEventBase & Readonly<{
  kind: 'before-turn'
  state: 'starting'
  /** Stable Host-owned identity for this exact provider delivery attempt. */
  deliveryAttemptId: string
  /** Stable Host-owned identity for the durable pre-dispatch lease. */
  boundaryLeaseId: string
  clientDirectiveId: string
}>

export type DomainMainAfterTurnEvent = DomainMainTurnLifecycleEventBase & Readonly<{
  kind: 'after-turn'
  deliveryAttemptId: string
  boundaryLeaseId: string
  clientDirectiveId: string
  /** Durable audit source for terminal settlement of this delivery attempt. */
  settlementSource?: 'runtime' | 'explicit-pending-start-release'
}> & (
  | Readonly<{
      state: 'completed' | 'failed' | 'cancelled'
      turnId: string
    }>
  | Readonly<{
      state: 'rejected'
      turnId?: never
    }>
)

/** Terminal ownership event for a persistent child provider turn. */
export type DomainMainPersistentChildAfterTurnEvent = Readonly<{
  kind: 'after-persistent-child-turn'
  state: 'completed' | 'failed' | 'cancelled'
  runtimeId: string
  threadId: string
  turnId: string
  childId: string
  parentThreadId: string
  parentTurnId: string
  workspaceRoot?: string
  occurredAt: string
}>

export type DomainMainTurnLifecycleEvent =
  | DomainMainBeforeTurnEvent
  | DomainMainAfterTurnEvent
  | DomainMainPersistentChildAfterTurnEvent

export type DomainMainDurableTurnBoundary = Readonly<{
  issuerEpoch: string
  deliveryAttemptOrdinal: number
  boundaryLeaseId: string
  deliveryAttemptId: string
  runtimeId: string
  threadId: string
  clientDirectiveId: string
  workspaceRoot?: string
  /** Immutable Host attribution; absent for signed-out or pre-attribution history. */
  principal?: PrincipalSnapshot
  /** Exact Host authorization lease; absent only for legacy unknown attribution. */
  principalContext?: PrincipalContextSnapshot
  phase: 'pending-start' | 'watching' | 'completed-intent' | 'terminal-settlement'
  turnId?: string
  terminalState?: 'completed' | 'failed' | 'cancelled' | 'rejected'
  occurredAt: string
}>

export type DomainMainRetiredTurnBoundaryRange = Readonly<{
  first: number
  last: number
}>

/**
 * Complete Host-authoritative ownership and exact anti-replay state for one
 * issuer epoch. Missing issued ordinals are corruption, never implicit release.
 */
export type DomainMainDurableTurnBoundarySnapshot = Readonly<{
  issuerEpoch: string
  nextDeliveryAttemptOrdinal: number
  retiredThroughOrdinal: number
  retiredOrdinalRanges: readonly DomainMainRetiredTurnBoundaryRange[]
  owners: readonly DomainMainDurableTurnBoundary[]
}>

export type DomainMainTurnLifecycleEventsHost = Readonly<{
  subscribe: (
    listener: (event: DomainMainTurnLifecycleEvent) => void | Promise<void>
  ) => DomainMainRuntimeDisposer
  /** Required pre-dispatch barriers reject before the provider turn starts. */
  subscribeRequiredBeforeTurn: (
    listener: (event: DomainMainBeforeTurnEvent) => void | Promise<void>
  ) => DomainMainRuntimeDisposer
  /**
   * Host-authoritative durable ownership used to reconcile package-local
   * leases after activation. Absence means the Host no longer owns the lease.
   */
  readDurableTurnBoundarySnapshot: () => Promise<DomainMainDurableTurnBoundarySnapshot>
}>

export type DomainMainAgentThreadsHost = Readonly<{
  list: (input?: DomainAgentThreadListInput) => Promise<readonly DomainAgentThread[]>
  read: (input: Readonly<{
    runtimeId: string
    threadId: string
  }>) => Promise<DomainAgentThreadDetail>
  /**
   * Streams accepted user messages, completed user-visible assistant progress,
   * and the final assistant message. The Host suppresses deltas, reasoning,
   * tool details, and repeated snapshots for the same canonical item.
   */
  subscribeMessages: (
    input: DomainAgentTranscriptSubscribeInput
  ) => AsyncIterable<DomainAgentTranscriptMessageEvent>
  hasActiveTurns: () => boolean
}>

export type DomainMainModuleEnablementHost = Readonly<{
  isEnabled: (moduleId: string) => boolean | Promise<boolean>
  subscribe: (
    moduleId: string,
    listener: (enabled: boolean) => void
  ) => DomainMainRuntimeDisposer
}>

export type DomainMainModuleEnablement = Readonly<{
  isEnabled: () => boolean | Promise<boolean>
  subscribe: (listener: (enabled: boolean) => void) => DomainMainRuntimeDisposer
}>

export type DomainCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write' | 'destructive'
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

function deepFreezeHostContract<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreezeHostContract(nested)
  }
  return value
}

const domainMainFiniteCapabilityBatchOperationIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u)

const domainMainFiniteCapabilityBatchOutputPathSegmentSchema = z.union([
  z.string().trim().min(1).max(192),
  z.number().int().nonnegative().max(10_000)
])

export const DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD =
  'confirmedPlanDigest' as const

export const domainMainFiniteCapabilityBatchPlanDigestSchema = z.string()
  .regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 finite batch plan digest.')

export const domainMainFiniteCapabilityBatchResourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fixed'),
    resource: domainCapabilityResourceHandleSchema
  }).strict(),
  z.object({
    kind: z.literal('operation-output'),
    operationId: domainMainFiniteCapabilityBatchOperationIdSchema,
    path: z.array(domainMainFiniteCapabilityBatchOutputPathSegmentSchema).min(1).max(16)
  }).strict()
])

export const domainMainFiniteCapabilityBatchOperationSchema = z.object({
  operationId: domainMainFiniteCapabilityBatchOperationIdSchema,
  actionId: domainPackagePermissionIdSchema,
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  input: domainPackageJsonValueSchema,
  resource: domainMainFiniteCapabilityBatchResourceSchema.optional()
}).strict()

/**
 * One immutable, process-local operation plan derived from a current Human
 * confirmation. Project/revision meaning remains package-owned; the Host binds
 * the exact string, ordered operations, inputs, and resource ancestry without
 * interpreting that domain state.
 */
export const domainMainFiniteCapabilityBatchPlanSchema = z.object({
  requiredSystemCapabilityGrant: domainPackagePermissionIdSchema,
  revision: z.string().trim().min(1).max(256),
  workspaceId: z.string().trim().min(1).max(1_024).optional(),
  operations: z.array(domainMainFiniteCapabilityBatchOperationSchema).min(1).max(64)
}).strict().superRefine((plan, context) => {
  const operationIndexes = new Map<string, number>()
  plan.operations.forEach((operation, index) => {
    if (operationIndexes.has(operation.operationId)) {
      context.addIssue({
        code: 'custom',
        path: ['operations', index, 'operationId'],
        message: 'Finite capability batch operation IDs must be unique.'
      })
      return
    }
    operationIndexes.set(operation.operationId, index)
    if (operation.resource?.kind !== 'operation-output') return
    const sourceIndex = operationIndexes.get(operation.resource.operationId)
    if (sourceIndex === undefined || sourceIndex >= index) {
      context.addIssue({
        code: 'custom',
        path: ['operations', index, 'resource', 'operationId'],
        message: 'A batch resource must come from an earlier operation.'
      })
    }
  })
}).transform((plan) => deepFreezeHostContract(plan))

export type DomainMainFiniteCapabilityBatchPlan = z.infer<
  typeof domainMainFiniteCapabilityBatchPlanSchema
>

/**
 * Canonical bytes for the complete finite batch plan confirmed by a Human.
 * Hashing remains in the Node-owning package or Host; callers cannot use the
 * resulting digest as authority without the matching active confirmation.
 */
export function canonicalizeDomainMainFiniteCapabilityBatchPlan(
  input: unknown
): string {
  const plan = domainMainFiniteCapabilityBatchPlanSchema.parse(input)
  return canonicalizeReproValue(domainPackageJsonValueSchema.parse(plan))
}

export type DomainMainApprovedCapabilityBatch = Readonly<{
  revision: string
  /** Digest of the exact Host-captured plan; it is audit identity, not authority. */
  planDigest: string
  /** Executes only the next enumerated operation and consumes its Host-owned proof. */
  invoke<TInput, TOutput>(
    operationId: string,
    contract: DomainCapabilityContract<TInput, TOutput>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<TOutput>
  /** Irrevocably drops every unconsumed proof in this process-local batch. */
  discard(): void
}>

export type DomainMainSystemCapabilityInvoker = Readonly<{
  /**
   * Invokes a capability through host policy. This system-facing surface has no
   * approval argument: lifecycle code cannot manufacture user approval.
   * Approval-requiring effects fail unless the host already owns a valid grant.
   */
  invoke<TInput, TOutput>(
    contract: DomainCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      idempotencyKey?: string
      resource?: DomainCapabilityResourceHandle
      expectedRevision?: string
      signal?: AbortSignal
      /**
       * Package-owned execution facts carried outside the capability input.
       * The Host must canonicalize and bind these facts to system authority;
       * handlers must never accept caller-authored digests in their input.
       */
      systemExecutionContext?: DomainPackageJsonValue
      authorization?: Readonly<{
        /**
         * The host may propagate an already-approved outer action. It must
         * reject this mode when no matching current action exists.
         */
        mode: 'inherit-current-action'
      }>
    }>
  ): Promise<TOutput>
  /**
   * Derives one finite batch from the exact active Human-confirmed invocation.
   * The package cannot mint, inspect, persist, or replay per-operation proofs.
   */
  createApprovedBatch(
    plan: DomainMainFiniteCapabilityBatchPlan
  ): DomainMainApprovedCapabilityBatch
}>

export type DomainMainTextReasoner = Readonly<{
  baseUrl: string
  apiKey: string
  model: string
}>

export type DomainMainModelAccessHost = Readonly<{
  textReasoner: () => Promise<DomainMainTextReasoner | null>
}>

/**
 * Process-level services shared with runtime lifecycle contributions.
 *
 * The host deliberately exposes data and diagnostics rather than host-private
 * service implementations. Domain packages keep ownership of their runtime.
 */
export type DomainMainRuntimeLifecycleHost = Readonly<{
  userDataDir: string
  appRoot: string
  environment: Readonly<Record<string, string | undefined>>
  agentThreads: DomainMainAgentThreadsHost
  turnEvents?: DomainMainTurnLifecycleEventsHost
  agentExecution?: DomainMainAgentExecutionHost
  remoteCapabilityApprovals?: DomainMainRemoteCapabilityApprovalHost
  power?: DomainMainPowerHost
  capabilities: DomainMainSystemCapabilityInvoker
  modelAccess: DomainMainModelAccessHost
  executionEvents: DomainMainExecutionEventsRouter
  enablement: DomainMainModuleEnablementHost
  log: (entry: DomainMainRuntimeLogEntry) => void
}>

export type DomainMainRuntimeLifecycleContext =
  Omit<DomainMainRuntimeLifecycleHost, 'enablement' | 'executionEvents'> & Readonly<{
    owner: DomainRuntimeContributionOwner
    signal: AbortSignal
    enablement: DomainMainModuleEnablement
    executionEvents: DomainMainExecutionEventsHost
    workflowExecutionReceipts: readonly DomainWorkflowExecutionReceiptProvider[]
    /** Installed package extension values, projected only after every main entry is registered. */
    contributions?: DomainMainContributionHost
  }>

export type DomainMainRuntimeDisposer = () => void | Promise<void>

export type DomainMainRuntimeLifecycleContribution = Readonly<{
  activate: (
    context: DomainMainRuntimeLifecycleContext
  ) => void | DomainMainRuntimeDisposer | Promise<void | DomainMainRuntimeDisposer>
}>

type DomainTurnFileEffectBaseV1 = Readonly<{
  contractVersion: 1
  path: string
  byteLength: number
}>

export type DomainTurnFileEffectV1 =
  | (DomainTurnFileEffectBaseV1 & Readonly<{
      kind: 'created' | 'modified'
      contentDigest: string
      mediaType?: string
      dataBase64: string
    }>)
  | (DomainTurnFileEffectBaseV1 & Readonly<{
      kind: 'deleted'
      baselineFingerprint: string
    }>)

export type DomainTurnFileEffectIssueV1 = Readonly<{
  code: string
  blocking: true
  message: string
  path?: string
}>

/** Ambient observation only; never sufficient to claim producer attribution. */
export type DomainTurnFileEffectsV1 = Readonly<{
  contractVersion: 1
  capture: 'host-turn-boundary'
  baselineDigest: string
  baselineCapturedAt: string
  terminalCapturedAt: string
  effects: readonly DomainTurnFileEffectV1[]
  issues: readonly DomainTurnFileEffectIssueV1[]
}>

/** Exact Host-authenticated apply_patch/fileChange receipt. */
export type DomainTurnFilePatchReceiptV1 = Readonly<{
  contractVersion: 1
  kind: 'host-authenticated-file-patch'
  issuer: 'sciforge.agent-runtime-host'
  source: 'codex-app-server-file-change'
  callId: string
  executorSequence: number
  path: string
  operation: 'add' | 'update' | 'delete'
  patchFormat: 'full-content' | 'unified-hunks'
  patchText: string
  patchDigest: string
}>

/** Opaque completed Agent turn delivered through the canonical artifact stream. */
export type DomainTurnArtifactEvent = Readonly<{
  contractVersion: 1
  kind: 'turn-completed'
  runtimeId: string
  threadId: string
  turnId: string
  issuerEpoch?: string
  deliveryAttemptOrdinal?: number
  deliveryAttemptId?: string
  boundaryLeaseId?: string
  clientDirectiveId?: string
  targetWatermark: string
  sequence?: number
  workspaceRoot?: string
  occurredAt: string
  fileEffects?: DomainTurnFileEffectsV1
  filePatchReceipts?: readonly DomainTurnFilePatchReceiptV1[]
  artifacts: readonly unknown[]
  /** Host-captured immutable attribution; absent for a signed-out turn. */
  principal?: PrincipalSnapshot
  /** Exact Host authorization lease; absent only for legacy unknown attribution. */
  principalContext?: PrincipalContextSnapshot
}>

/** Opaque completed non-Agent execution delivered through the same stream. */
export type DomainExecutionArtifactEvent = Readonly<{
  contractVersion: 1
  kind: 'execution-completed'
  /** Host-minted delivery facts; package event payloads cannot supply these. */
  hostBinding?: Readonly<{
    contractVersion: 1
    acceptanceSequence: number
    workspaceBinding: 'capability-caller' | 'unbound'
    workspaceRoot?: string
  }>
  producer: Readonly<{
    moduleId: string
    moduleVersion: string
  }>
  executionId: string
  runId: string
  activityId?: string
  targetWatermark: string
  runtimeId?: string
  threadId?: string
  turnId?: string
  workspaceRoot?: string
  occurredAt: string
  artifacts: readonly unknown[]
}>

export type DomainArtifactEvent = DomainTurnArtifactEvent | DomainExecutionArtifactEvent

export type DomainArtifactEventScope = Readonly<{
  runtimeId: string
  threadId: string
  turnId?: string
  workspaceRoot?: string
}>

/**
 * Returns the one canonical DAG scope for both Agent turns and package-owned
 * executions. Executions that did not originate in a thread receive a stable
 * synthetic scope shared by every artifact consumer.
 */
export function domainArtifactEventScope(
  event: DomainArtifactEvent
): DomainArtifactEventScope {
  if (event.kind === 'turn-completed') {
    return Object.freeze({
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      ...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {})
    })
  }
  return Object.freeze({
    runtimeId: event.runtimeId?.trim() || `domain:${event.producer.moduleId}`,
    threadId: event.threadId?.trim() || `execution:${event.executionId}`,
    ...(event.turnId?.trim() ? { turnId: event.turnId.trim() } : {}),
    ...(event.workspaceRoot?.trim() ? { workspaceRoot: event.workspaceRoot.trim() } : {})
  })
}

export type DomainArtifactConsumer = Readonly<{
  /**
   * Delivery is at least once: after a partial fan-out the Host retries the
   * identical event for every consumer. Implementations must therefore apply
   * effects idempotently using the event scope and targetWatermark.
   */
  consume: (event: DomainArtifactEvent) => void | Promise<void>
}>

/**
 * The host persists each event to the single Full Trace stream before making
 * completed executions visible to artifact consumers.
 */
export type DomainMainExecutionEventsHost = Readonly<{
  publish: (event: DomainExecutionEventInput) => Promise<DomainExecutionEventV1>
}>

/** Main-process router used to bind a publisher to the activating package owner. */
export type DomainMainExecutionEventsRouter = Readonly<{
  publish: (
    owner: DomainRuntimeContributionOwner,
    event: DomainExecutionEventInput
  ) => Promise<DomainExecutionEventV1>
}>

export type DomainMainActionGuardInput = Readonly<{
  actionId: string
  payload: DomainPackageJsonValue
}>

export type DomainMainActionGuardResult = Readonly<{
  allowed: boolean
  message?: string
  metadata?: DomainPackageJsonValue
}>

export type DomainMainActionGuard = Readonly<{
  actions: readonly string[]
  evaluate: (
    input: DomainMainActionGuardInput
  ) => DomainMainActionGuardResult | Promise<DomainMainActionGuardResult>
}>

export function isDomainMainRuntimeLifecycleContribution(
  value: unknown
): value is DomainMainRuntimeLifecycleContribution {
  return isRecord(value) && typeof value.activate === 'function'
}

export function isDomainArtifactConsumer(
  value: unknown
): value is DomainArtifactConsumer {
  return isRecord(value) && typeof value.consume === 'function'
}

export function isDomainMainActionGuard(
  value: unknown
): value is DomainMainActionGuard {
  if (!isRecord(value) || typeof value.evaluate !== 'function' || !Array.isArray(value.actions)) {
    return false
  }
  const actions = value.actions
  return actions.length > 0 &&
    actions.every((action) => typeof action === 'string' && Boolean(action.trim())) &&
    new Set(actions).size === actions.length
}

export function isDomainMainRuntimeMcpServerContribution(
  value: unknown
): value is DomainMainRuntimeMcpServerContribution {
  if (!isRecord(value)) return false
  return typeof value.serverId === 'string' && Boolean(value.serverId.trim()) &&
    typeof value.createConfig === 'function' &&
    (value.isRuntimeEnabled === undefined || typeof value.isRuntimeEnabled === 'function')
}

export function isDomainMcpTrustedInvocationMetadataContribution(
  value: unknown
): value is DomainMcpTrustedInvocationMetadataContribution {
  if (!isRecord(value) || value.source !== 'trusted-invocation') return false
  if (typeof value.serverId !== 'string' || !value.serverId.trim()) return false
  if (typeof value.metadataKey !== 'string' || !value.metadataKey.trim()) return false
  return Array.isArray(value.tools) && value.tools.length > 0 &&
    value.tools.every((tool) => typeof tool === 'string' && Boolean(tool.trim())) &&
    new Set(value.tools).size === value.tools.length
}

export type DomainWorkbenchRightPanelSession = Readonly<{
  id: string
  runtimeId?: string
  workspaceRoot?: string
  resources?: readonly DomainRendererSessionResource[]
}>

export type DomainWorkbenchRightPanelActivation = Readonly<{
  contributionId: string
  revision: number
  payload: DomainPackageJsonValue
}>

export type DomainWorkbenchRightPanelPlacement = z.infer<
  typeof domainWorkbenchRightPanelPlacementSchema
>

/**
 * Host-owned routing for a right-panel request.
 *
 * A package may omit placement (or request `focused`), explicitly request a
 * `new` pane, or echo a `surfaceId` received from its render context to target
 * that exact mounted pane. Packages must not create surface identities.
 */
export type DomainWorkbenchRightPanelTarget =
  | Readonly<{
      placement?: 'focused' | undefined
      surfaceId?: never
    }>
  | Readonly<{
      placement: 'new'
      surfaceId?: never
    }>
  | Readonly<{
      placement?: never
      surfaceId: string
    }>

export type DomainWorkbenchRightPanelRenderContext = Readonly<{
  /** True only while the Session is foreground and this pane intersects the Dock viewport. */
  active: boolean
  /** Keyboard and command-routing focus within the owning Session dock. */
  focused: boolean
  /** Stable opaque Host identity that nested requests may echo, but never create. */
  surfaceId: string
  className: string
  onCollapse: () => void
  session: DomainWorkbenchRightPanelSession
  activation?: DomainWorkbenchRightPanelActivation
}>

export type DomainWorkbenchOpenRightPanelInput =
  Readonly<{
    contributionId: string
    sessionId: string
    activation?: DomainWorkbenchRightPanelActivation
  }> & DomainWorkbenchRightPanelTarget

/**
 * Exact, domain-neutral resource identity used to request a renderer-owned
 * presentation without naming that renderer contribution or its activation
 * payload contract.
 */
export type DomainWorkbenchExactResource = Readonly<{
  resourceKind: string
  resourceId: string
  /**
   * Optional non-authorizing Broker reference. The target renderer must bind
   * it through the Host before use; this value never carries a capability.
   */
  resourceRef?: string | undefined
  integrity?: Readonly<{
    algorithm: 'sha256'
    expectedDigest: string
  }> | undefined
}>

export type DomainWorkbenchOpenResourceInput =
  Readonly<{
    sessionId: string
    resource: DomainWorkbenchExactResource
  }> & DomainWorkbenchRightPanelTarget

export type DomainWorkbenchOpenSurfaceInput = Readonly<{
  contributionId: string
  sessionId?: string
  activation?: DomainRendererWorkbenchSurfaceActivation
}>

export type DomainWorkbenchToggleGlobalOverlayInput =
  DomainWorkbenchOpenSurfaceInput & Readonly<{
    open?: boolean
  }>

export type DomainWorkspacePreviewTarget =
  Readonly<{
    path: string
    sessionId: string
    workspaceRoot?: string
    mimeType?: string
    kind?: 'file' | 'directory'
    line?: number
    column?: number
    selection?: DomainPackageJsonValue
    anchor?: DomainPackageJsonValue
    integrity?: Readonly<{
      algorithm: 'sha256'
      expectedDigest: string
    }>
    returnTo?: Readonly<{
      contributionId: string
      label?: string
      activation?: DomainWorkbenchRightPanelActivation
    }>
  }> & DomainWorkbenchRightPanelTarget

export type DomainRendererWorkspacePreviewHost = Readonly<{
  open: (target: DomainWorkspacePreviewTarget) => void
}>

export type DomainRendererWorkspaceHost = Readonly<{
  pickFile: (
    request: DomainRendererWorkspaceFilePickerRequest
  ) => Promise<DomainRendererWorkspacePickResult>
  openRemoteSession?: (
    input: WorkspaceHostOpenRemoteSessionInput
  ) => Promise<void>
}>

export type DomainRendererWorkbenchHost = Readonly<{
  canOpenResource?: (resourceKind: string) => boolean
  openResource?: (input: DomainWorkbenchOpenResourceInput) => boolean
  openRightPanel: (input: DomainWorkbenchOpenRightPanelInput) => void
  openBottomPanel?: (input: DomainWorkbenchOpenSurfaceInput) => void
  toggleGlobalOverlay?: (input: DomainWorkbenchToggleGlobalOverlayInput) => void
  sendMessage?: (
    input: DomainRendererWorkbenchSendMessageInput
  ) => Promise<DomainRendererWorkbenchSendMessageResult>
}>

/**
 * Host-owned persistence-boundary text sanitization.
 *
 * Domain packages must still apply their own structural redaction. This
 * optional service additionally removes opaque secret values known only to
 * current Host settings without exposing that secret inventory to packages.
 */
export type DomainMainTextSanitizerHost = Readonly<{
  sanitizeText: (value: string) => string
}>

export type DomainMainInternalServiceRegistration<Service extends object = object> = Readonly<{
  serviceId: string
  contractVersion: string
  allowedConsumerModuleIds: readonly string[]
  service: Service
}>

/**
 * Owner-scoped main-process service mediation. The Host derives both owners
 * from generated composition; runtime input cannot name either package owner.
 */
export type DomainMainInternalServiceHost = Readonly<{
  register<Service extends object>(
    registration: DomainMainInternalServiceRegistration<Service>
  ): void
  acquire<Service extends object>(serviceId: string, contractVersion: string): Service
}>

/**
 * Main-process services available to every trusted domain package.
 *
 * Capability definitions deliberately cross this boundary as unknown values:
 * the application host owns their concrete type and performs the authoritative
 * validation when the definition enters its registry.
 */
export type DomainMainHost = Readonly<{
  getUserDataDir: () => string
  /** Stable opaque Host installation identity; introduced in Host API 1.3. */
  getDeviceId?: () => string
  /** Canonical application version reported by the Host runtime; introduced in Host API 1.4. */
  getAppVersion?: () => string
  /** Application root used to resolve trusted bundled process entries. */
  getAppRoot?: () => string
  /** Executable used to launch trusted bundled Node process entries. */
  getExecutablePath?: () => string
  /** Whether the current application is running from a packaged build. */
  isPackaged?: () => boolean
  defineCapability: (options: unknown) => unknown
  /** Owner-scoped non-secret settings; introduced in Host API 1.2. */
  packageSettings?: DomainMainPackageSettingsHost
  /** Owner-scoped main-process-only secrets; introduced in Host API 1.2. */
  packageSecrets?: DomainMainPackageSecretStoreHost
  /** Opens one absolute local path with the operating system's configured application. */
  openPath?: (path: string) => Promise<void>
  resolveWorkspaceServerArtifact?: () => Promise<WorkspaceHostArtifact>
  capabilities?: DomainMainSystemCapabilityInvoker
  /**
   * Owner-scoped Host facade. It derives caller and Principal exclusively from
   * the active capability invocation; packages cannot supply either value.
   */
  fileTransfers?: DomainMainFileTransferHost
  /** Owner-scoped, active-invocation-bound, one-shot safe navigation targets. */
  externalNavigation?: DomainMainExternalNavigationHost
  /** Owner-scoped materialization/export facade bound to the active capability invocation. */
  portableResources?: DomainMainPortableResourceReferencesHost
  /** Owner-scoped, main-process-only package service mediation. */
  internalServices?: DomainMainInternalServiceHost
  visualCapture?: DomainMainVisualCaptureHost
  textSanitizer?: DomainMainTextSanitizerHost
}>

export type DomainRendererCapabilityContract<TInput, TOutput> =
  DomainCapabilityContract<TInput, TOutput>

export type DomainRendererCapabilityObservationContract<TState> = Readonly<{
  resourceKind: string
  stateSchema: z.ZodType<TState>
}>

export type DomainRendererCapabilityObservation<TState> = Readonly<{
  resource: DomainCapabilityResourceHandle
  resourceRef: string
  resourceKind: string
  semanticRevision: string
  layoutRevision?: string
  observedAt: string
  state: TState
}>

type DomainRendererCapabilityChangeBase = Readonly<{
  resourceRef: string
  resourceKind: string
  beforeRevision: string
  afterRevision: string
  changedAt: string
}>

export type DomainRendererCapabilityChange =
  | Readonly<DomainRendererCapabilityChangeBase & {
      origin: 'capability'
      actionId: string
    }>
  | Readonly<DomainRendererCapabilityChangeBase & {
      origin: 'provider'
      actionId?: never
    }>

export type DomainRendererCapabilityChangeDisposer = () => void

export type DomainRendererContribution = Readonly<{
  id: string
  kind: string
  packageName: string
  owner: DomainRuntimeContributionOwner
  contract?: DomainPackageJsonValue
  value: unknown
}>

export type DomainRendererContributionHost = Readonly<{
  list: (kind: string) => readonly DomainRendererContribution[]
}>

export type DomainVisibleContextResource = Readonly<{
  kind: string
  role?: string
  title?: string
  accessHint?: string
  capability?: Readonly<{
    resourceRef: string
    operations: readonly Readonly<{
      operationRef: string
      schemaRef: string
    }>[]
  }>
  metadata?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextComponent = Readonly<{
  id: string
  region: string
  component: string
  title?: string
  visible: boolean
  priority?: number
  updatedAt: string
  summary: string
  resources?: readonly DomainVisibleContextResource[]
  state?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextTarget = Readonly<{
  id: string
  kind: 'component' | 'document-page' | 'region' | 'window'
  contentType?: string
  active?: boolean
  redact?: boolean
  metadata?: Readonly<Record<string, unknown>>
}>

export type DomainVisibleContextPoint = Readonly<{
  clientX: number
  clientY: number
}>

export type DomainVisibleContextViewportBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type DomainVisibleContextInspection =
  | Readonly<{
    selectable: true
    /** Opaque, host-signed reference accepted by the visual-capture port. */
    targetRef: string
    componentId: string
    target: DomainVisibleContextTarget
    bounds: DomainVisibleContextViewportBounds
  }>
  | Readonly<{
    selectable: false
    reason: 'redacted'
  }>

export type DomainVisibleContextSelectionInspection = Readonly<{
  /** Opaque, host-signed reference accepted by the visual-capture port. */
  targetRef: string
  componentId: string
  target: DomainVisibleContextTarget
  bounds: DomainVisibleContextViewportBounds
  text: string
}>

export type DomainRendererVisibleContextHost = Readonly<{
  registerComponent(component: DomainVisibleContextComponent): () => void
  registerVisualTarget(input: Readonly<{
    componentId: string
    target: DomainVisibleContextTarget
    /** Renderer-owned element handle; the host validates it before measuring. */
    element?: () => object | null
  }>): () => void
  inspectRegisteredTargetAt?(
    point: DomainVisibleContextPoint
  ): Promise<DomainVisibleContextInspection | null>
  inspectRegisteredTextSelection?(): Promise<DomainVisibleContextSelectionInspection | null>
}>

export type DomainRendererCapabilityInvoker = Readonly<{
  /** Rebinds one non-authorizing reference after Host scope and lease checks. */
  bind?(
    resourceRef: string,
    options?: Readonly<{ workspaceId?: string; signal?: AbortSignal }>
  ): Promise<DomainCapabilityResourceHandle>
  observe<TState>(
    contract: DomainRendererCapabilityObservationContract<TState>,
    resource: DomainCapabilityResourceHandle,
    options?: Readonly<{ workspaceId?: string; signal?: AbortSignal }>
  ): Promise<DomainRendererCapabilityObservation<TState>>
  /**
   * Validates and snapshots `input` synchronously before returning. A caller
   * may therefore clear its own mutable sensitive-input container as soon as
   * this method returns the invocation Promise.
   */
  invoke<TInput, TOutput>(
    contract: DomainRendererCapabilityContract<TInput, TOutput>,
    input: TInput,
    options?: Readonly<{
      workspaceId?: string
      resource?: DomainCapabilityResourceHandle
      expectedRevision?: string
      approval?: Readonly<{ mode: 'confirmation' }>
      signal?: AbortSignal
    }>
  ): Promise<TOutput>
  subscribe?(
    resourceRef: string,
    listener: (change: DomainRendererCapabilityChange) => void,
    options?: Readonly<{ workspaceId?: string }>
  ): Promise<DomainRendererCapabilityChangeDisposer>
}>

/** Renderer-safe services available to every trusted domain package. */
export type DomainRendererHost = Readonly<{
  capabilityInvoker: DomainRendererCapabilityInvoker
  /** Lazily exposes installed renderer extension points to other trusted packages. */
  contributions?: DomainRendererContributionHost
  openExternal: (url: string) => void | Promise<void>
  /** Renderer-safe pickers return opaque handles; local paths never cross this boundary. */
  fileTransfers?: DomainRendererFileTransferHost
  workspace?: DomainRendererWorkspaceHost
  workspacePreview?: DomainRendererWorkspacePreviewHost
  workbench?: DomainRendererWorkbenchHost
  visibleContext?: DomainRendererVisibleContextHost
}>

export type DomainMainEntryFactory<Value = unknown> = (
  host: DomainMainHost
) => TrustedDomainProcessEntryInput<Value>

export type DomainRendererEntryFactory<Value = unknown> = (
  host: DomainRendererHost
) => TrustedDomainProcessEntryInput<Value>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
