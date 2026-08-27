import { createHash, createHmac, createSecretKey, randomBytes, type KeyObject } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import {
  DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD,
  canonicalizeDomainMainFiniteCapabilityBatchPlan,
  domainMainFiniteCapabilityBatchPlanSchema,
  type DomainMainFiniteCapabilityBatchPlan
} from '@sciforge/domain-sdk/host'
import {
  principalContextSnapshotSchema,
  principalSnapshotSchema,
  type PrincipalContextSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  capabilityAuditRecordSchema,
  capabilityAudienceSchema,
  capabilityCallerContextSchema,
  capabilityEventQuerySchema,
  capabilityInvocationRequestSchema,
  capabilityInvocationResultSchema,
  capabilityIdSchema,
  capabilityJsonValueSchema,
  capabilityObservationSchema,
  capabilityObserveRequestSchema,
  capabilityResourceChangeEventSchema,
  capabilityResourceContentDescriptorSchema,
  capabilityResourceContentRangeSchema,
  capabilityResourceHandleSchema,
  type CapabilityAuditRecord,
  type CapabilityAudience,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityDiscoveryQuery,
  type CapabilityEventQuery,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityJsonValue,
  type CapabilityObservation,
  type CapabilityObserveRequest,
  type CapabilityResourceChangeEvent,
  type CapabilityResourceContentDescriptor,
  type CapabilityResourceContentRange,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'
import {
  CapabilityRegistry,
  type CapabilityDefinition,
  type IssuedCapabilityResource,
  type CapabilityResourceRegistration,
  type ResolvedCapabilityResource
} from './registry'

const resourceObservationResultSchema = z.object({
  state: capabilityJsonValueSchema,
  semanticRevision: z.string().trim().min(1).max(256),
  layoutRevision: z.string().trim().min(1).max(256).optional(),
  operationIds: z.array(z.string().trim().min(1).max(192)).max(512).optional()
}).strict()

const resourceProviderChangeSchema = z.object({
  semanticRevision: z.string().trim().min(1).max(256),
  layoutRevision: z.string().trim().min(1).max(256).optional()
}).strict()

const DEFAULT_HANDLE_TTL_MS = 15 * 60_000
const MAX_HANDLE_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MAX_AUDIT_RECORDS = 2_000
const DEFAULT_MAX_EVENTS = 2_000
const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 2_000
const SENSITIVE_INPUT_FINGERPRINT_KEY_BYTES = 32
const SENSITIVE_INPUT_FINGERPRINT_DOMAIN = 'sciforge.capability-broker.sensitive-input.v1\u0000'
const MAX_RESOURCE_RETIREMENT_ATTEMPTS = 3
const RESOURCE_RETIREMENT_RETRY_MS = 1_000

type BrokerErrorCategory = 'rejected' | 'failed'

export class CapabilityBrokerError extends Error {
  readonly code: string
  readonly category: BrokerErrorCategory
  readonly details?: CapabilityJsonValue

  constructor(
    code: string,
    message: string,
    options: { category?: BrokerErrorCategory; details?: CapabilityJsonValue; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CapabilityBrokerError'
    this.code = code
    this.category = options.category ?? 'rejected'
    this.details = options.details
  }
}

export type CapabilityBrokerOptions = {
  now?: () => Date
  /** Captures Host-owned authority after the public caller envelope is validated. */
  resolveCurrentPrincipal?: () => PrincipalSnapshot | null
  /** Captures the signed-in or signed-out Host Principal context revision. */
  resolveCurrentPrincipalContext?: () => PrincipalContextSnapshot
  handleTtlMs?: number
  maxAuditRecords?: number
  maxEvents?: number
  maxIdempotencyEntries?: number
  reportCleanupError?: (error: unknown) => void
}

type ResourceState = {
  key: string
  resourceRef: string
  resourceId: string
  resourceKind: string
  workspaceId?: string
  allowedAudiences: CapabilityAudience[]
  principalLease: string
  callerIdBinding?: string
  executionContextDigestBinding?: string
  semanticRevision: string
  layoutRevision?: string
  observe: CapabilityResourceRegistration['observe']
  subscribeChanges?: CapabilityResourceRegistration['subscribeChanges']
  changeSubscriptionAttached: boolean
  disposeChangeSubscription?: () => void
  dispose?: CapabilityResourceRegistration['dispose']
  contentTransport?: CapabilityResourceRegistration['contentTransport']
  retireAfterLastHandleExpires: boolean
  retentionCount: number
  inFlightCount: number
  expiryRetirementPending: boolean
  retirementRequested: boolean
  retirementIgnoresRetentions: boolean
  retirementPromise?: Promise<void>
  retirementWake?: () => void
  retirementAttempts: number
  retirementRetryTimer?: ReturnType<typeof setTimeout>
  /**
   * Invocation transactions that have issued this resource before any one of
   * them commits. `undefined` means the resource has a committed adopter and
   * must never be retired by another invocation's rollback.
   */
  provisionalTransactions?: Set<InvocationResourceTransaction>
}

type ResourceGrant = {
  token: string
  resourceKey: string
  workspaceId?: string
  principalLease: string
  callerIdBinding?: string
  executionContextDigestBinding?: string
  semanticRevision: string
  expiresAt: string
}

type RetiredResourceState = Pick<
  ResourceState,
  | 'resourceRef'
  | 'workspaceId'
  | 'allowedAudiences'
  | 'principalLease'
  | 'callerIdBinding'
  | 'executionContextDigestBinding'
>

type IdempotencyEntry = {
  fingerprint: string
  promise: Promise<CapabilityInvocationResult>
  settled: boolean
  retainUntilRestart: boolean
  resultPrincipalLease?: string
  postDispatchMutation?: boolean
}

type EventSubscription = {
  caller: CapabilityCallerContextInput
  listener: (event: CapabilityResourceChangeEvent) => void
}

export type ActiveCapabilityInvocation = Readonly<{
  caller: CapabilityCallerContext
  actionId: string
  invocationId?: string
  effect: CapabilityDefinition['descriptor']['effect']
  approval: CapabilityDefinition['descriptor']['approval']
  approved: boolean
  scope: CapabilityDefinition['descriptor']['scope']
  autonomousWrite?: CapabilityDefinition['descriptor']['autonomousWrite']
  /** Exact input resource already resolved, authorized, and pinned by the Broker. */
  authorizedResource?: Readonly<{
    resourceRef: string
    resourceKind: string
    workspaceId?: string
    semanticRevision: string
  }>
}>

/** Host-private resource scope derived from an already authenticated invocation. */
export type CapabilityResourceInvocationBinding = Readonly<{
  callerId: string
  executionContextDigest?: string
}>

type ActiveCapabilityInvocationState = {
  active: boolean
  approvedBatchCreated: boolean
  confirmedInput: CapabilityJsonValue
  invocation: ActiveCapabilityInvocation
  resourceTransaction: InvocationResourceTransaction
}

type InvocationResourceIssuance = {
  resource: ResourceState
  grant: ResourceGrant
}

type InvocationResourceTransaction = {
  issuances: InvocationResourceIssuance[]
  state: 'pending' | 'committed' | 'rolled-back'
}

type HostSystemCapabilityCaller = Readonly<{
  callerId: string
  workspaceId?: string
  capabilityGrants?: readonly string[]
  systemExecutionContext?: CapabilityJsonValue
  approvals?: CapabilityCallerContextInput['approvals']
}>

type HostApprovedBatchOperationContract = Readonly<{
  actionId: string
  effect: CapabilityDefinition['descriptor']['effect']
}>

type HostApprovedBatchIssuedResource = Readonly<{
  resource: CapabilityResourceHandle
  resourceRef: string
  resourceKind: string
}>

type HostApprovedBatchResourceLineage = {
  resourceRef: string
  resourceKind: string
  current: CapabilityResourceHandle
}

type HostApprovedBatchOperationState = {
  plan: DomainMainFiniteCapabilityBatchPlan['operations'][number]
  consumed: boolean
}

export type HostApprovedCapabilityBatch = Readonly<{
  revision: string
  planDigest: string
  invoke(
    operationId: string,
    contract: HostApprovedBatchOperationContract,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<CapabilityInvocationResult>
  discard(): void
}>

type CapabilityInvokeAsOptions = Readonly<{
  signal?: AbortSignal
  approvedBatchOperation?: HostApprovedBatchOperationState
  captureIssuedResources?: (resources: readonly HostApprovedBatchIssuedResource[]) => void
}>

function opaqueId(prefix: 'cap' | 'res' | 'audit' | 'event'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

function stableJson(value: CapabilityJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

function canonicalDigest(value: CapabilityJsonValue): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function createSensitiveInputFingerprintKey(): KeyObject {
  const keyBytes = randomBytes(SENSITIVE_INPUT_FINGERPRINT_KEY_BYTES)
  try {
    return createSecretKey(keyBytes)
  } finally {
    keyBytes.fill(0)
  }
}

function batchOutputSelectorKey(
  selector: Extract<
    NonNullable<DomainMainFiniteCapabilityBatchPlan['operations'][number]['resource']>,
    { kind: 'operation-output' }
  >
): string {
  return stableJson(capabilityJsonValueSchema.parse({
    operationId: selector.operationId,
    path: selector.path
  }))
}

function batchOutputPathValue(
  output: CapabilityJsonValue,
  path: readonly (string | number)[]
): CapabilityJsonValue {
  let value: CapabilityJsonValue = output
  for (const segment of path) {
    if (Array.isArray(value)) {
      if (typeof segment !== 'number' || !Object.hasOwn(value, segment)) {
        throw new CapabilityBrokerError(
          'delegated_batch_resource_drift',
          'A planned batch output path is unavailable.'
        )
      }
      value = value[segment]!
      continue
    }
    if (!value || typeof value !== 'object' || typeof segment !== 'string' ||
      !Object.hasOwn(value, segment)) {
      throw new CapabilityBrokerError(
        'delegated_batch_resource_drift',
        'A planned batch output path is unavailable.'
      )
    }
    value = value[segment]!
  }
  return value
}

/**
 * Sensitive capability input is needed by the handler but must not be retained
 * verbatim by the broker's restart-bounded idempotency journal. A Broker-lifetime
 * random HMAC preserves exact retry/conflict semantics without leaving an
 * offline-guessable or cross-lifetime credential verifier in that journal.
 */
function idempotencyInput(
  definition: CapabilityDefinition,
  input: CapabilityJsonValue,
  sensitiveInputFingerprintKey: KeyObject
): CapabilityJsonValue {
  if (!definition.descriptor.tags.includes('sensitive-input')) return input
  return {
    sensitiveInputHmacSha256: createHmac('sha256', sensitiveInputFingerprintKey)
      .update(SENSITIVE_INPUT_FINGERPRINT_DOMAIN)
      .update(stableJson(input))
      .digest('hex')
  }
}

function normalizedWorkspaceId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function resourceKey(
  registration: Pick<CapabilityResourceRegistration, 'workspaceId' | 'resourceKind' | 'resourceId'>,
  allowedAudiences: readonly CapabilityAudience[],
  principalLease: string,
  invocationBinding?: CapabilityResourceInvocationBinding
): string {
  return stableJson({
    workspaceId: registration.workspaceId ?? null,
    resourceKind: registration.resourceKind,
    resourceId: registration.resourceId,
    allowedAudiences: [...allowedAudiences].sort(),
    principalLease,
    invocationBinding: invocationBinding ?? null
  })
}

function resourceInvocationBinding(
  resource: Pick<ResourceState, 'callerIdBinding' | 'executionContextDigestBinding'>
): CapabilityResourceInvocationBinding | undefined {
  if (!resource.callerIdBinding) return undefined
  return Object.freeze({
    callerId: resource.callerIdBinding,
    ...(resource.executionContextDigestBinding
      ? { executionContextDigest: resource.executionContextDigestBinding }
      : {})
  })
}

function resourceInvocationBindingMatches(
  resource: Pick<ResourceState, 'callerIdBinding' | 'executionContextDigestBinding'>,
  caller: CapabilityCallerContext
): boolean {
  return resource.callerIdBinding === undefined || (
    resource.callerIdBinding === caller.callerId &&
    resource.executionContextDigestBinding === caller.executionContextDigest
  )
}

function sameContentTransport(
  left: CapabilityResourceRegistration['contentTransport'],
  right: CapabilityResourceRegistration['contentTransport']
): boolean {
  if (!left || !right) return left === right
  return left.describeActionId === right.describeActionId &&
    left.readRangeActionId === right.readRangeActionId
}

function principalLease(
  principal: PrincipalSnapshot | undefined,
  principalContextVersion: number
): string {
  return stableJson({
    principalContextVersion,
    principal: principal === undefined ? null : { ...principal }
  })
}

function callerPrincipalLease(caller: CapabilityCallerContext): string {
  return principalLease(
    caller.principal,
    caller.principalContextVersion ?? caller.principal?.identityVersion ?? 0
  )
}

function workspaceInvocationScope(caller: CapabilityCallerContext): string {
  return stableJson(capabilityJsonValueSchema.parse({
    workspaceId: caller.workspaceId ?? null,
    workspaceLocator: caller.workspaceLocator ?? null
  }))
}

function publicCallerProjection(caller: CapabilityCallerContext): CapabilityCallerContextInput {
  return {
    audience: caller.audience,
    callerId: caller.callerId,
    ...(caller.workspaceId ? { workspaceId: caller.workspaceId } : {}),
    ...(caller.workspaceLocator ? { workspaceLocator: caller.workspaceLocator } : {}),
    approvals: [...caller.approvals]
  }
}

function isMutation(definition: CapabilityDefinition): boolean {
  return definition.descriptor.effect === 'workspace-write'
    || definition.descriptor.effect === 'external-write'
    || definition.descriptor.effect === 'destructive'
}

function handlerResultRequestsStateChange(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true
  const candidate = result as Record<string, unknown>
  return candidate.changed === true ||
    candidate.retireResource === true ||
    candidate.retireResource === 'defer-while-retained' ||
    candidate.semanticRevision !== undefined ||
    candidate.layoutRevision !== undefined
}

export class CapabilityBroker {
  readonly registry: CapabilityRegistry
  readonly #now: () => Date
  readonly #resolveCurrentPrincipal: (() => PrincipalSnapshot | null) | undefined
  readonly #resolveCurrentPrincipalContext: (() => PrincipalContextSnapshot) | undefined
  readonly #handleTtlMs: number
  readonly #maxAuditRecords: number
  readonly #maxEvents: number
  readonly #maxIdempotencyEntries: number
  readonly #reportCleanupError: (error: unknown) => void
  readonly #sensitiveInputFingerprintKey = createSensitiveInputFingerprintKey()
  readonly #resources = new Map<string, ResourceState>()
  readonly #resourcesByRef = new Map<string, ResourceState>()
  readonly #retiredResourcesByRef = new Map<string, RetiredResourceState>()
  readonly #handles = new Map<string, ResourceGrant>()
  readonly #handleExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #idempotency = new Map<string, IdempotencyEntry>()
  readonly #auditRecords: CapabilityAuditRecord[] = []
  readonly #events: CapabilityResourceChangeEvent[] = []
  readonly #subscriptions = new Set<EventSubscription>()
  readonly #activeInvocation = new AsyncLocalStorage<ActiveCapabilityInvocationState>()

  constructor(registry: CapabilityRegistry, options: CapabilityBrokerOptions = {}) {
    this.registry = registry
    this.#now = options.now ?? (() => new Date())
    this.#resolveCurrentPrincipal = options.resolveCurrentPrincipal
    this.#resolveCurrentPrincipalContext = options.resolveCurrentPrincipalContext
    this.#handleTtlMs = Math.min(MAX_HANDLE_TTL_MS, Math.max(1, options.handleTtlMs ?? DEFAULT_HANDLE_TTL_MS))
    this.#maxAuditRecords = Math.max(1, options.maxAuditRecords ?? DEFAULT_MAX_AUDIT_RECORDS)
    this.#maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS)
    this.#maxIdempotencyEntries = Math.max(1, options.maxIdempotencyEntries ?? DEFAULT_MAX_IDEMPOTENCY_ENTRIES)
    this.#reportCleanupError = options.reportCleanupError ?? (() => undefined)
  }

  discover(rawCaller: CapabilityCallerContextInput, query?: CapabilityDiscoveryQuery) {
    const caller = this.#parseCaller(rawCaller)
    return this.registry.discover(publicCallerProjection(caller), query)
  }

  /**
   * Atomically issues both projections of one Broker resource registration.
   * The opaque portable-reference layer consumes the stable resourceRef while
   * renderer and runtime callers receive only the expiring resource handle.
   */
  issueResource(
    rawCaller: CapabilityCallerContextInput,
    rawRegistration: CapabilityResourceRegistration,
    rawInvocationBinding?: CapabilityResourceInvocationBinding
  ): IssuedCapabilityResource {
    const caller = this.#hostResourceCaller(rawCaller)
    const invocationBinding = this.#parseResourceInvocationBinding(
      caller,
      rawInvocationBinding
    )
    return this.#issueResourceAs(caller, rawRegistration, invocationBinding)
  }

  issueResourceHandle(
    rawCaller: CapabilityCallerContextInput,
    rawRegistration: CapabilityResourceRegistration
  ): CapabilityResourceHandle {
    return this.issueResource(rawCaller, rawRegistration).resource
  }

  #issueResourceAs(
    caller: CapabilityCallerContext,
    rawRegistration: CapabilityResourceRegistration,
    invocationBinding?: CapabilityResourceInvocationBinding
  ): IssuedCapabilityResource {
    const registration = this.#parseResourceRegistration(rawRegistration)
    const workspaceId = registration.workspaceId ?? caller.workspaceId
    if (registration.workspaceId && registration.workspaceId !== caller.workspaceId) {
      throw new CapabilityBrokerError(
        'resource_scope_mismatch',
        'A resource handle can only be issued inside the caller workspace.'
      )
    }

    const allowedAudiences = [...(registration.audiences ?? [caller.audience])].sort()
    const callerLease = callerPrincipalLease(caller)
    if (registration.contentTransport) {
      this.#validateContentAction(registration.resourceKind, registration.contentTransport.describeActionId)
      this.#validateContentAction(registration.resourceKind, registration.contentTransport.readRangeActionId)
    }
    const key = resourceKey(
      { ...registration, workspaceId },
      allowedAudiences,
      callerLease,
      invocationBinding
    )
    const existing = this.#resources.get(key)
    const resourceTransaction = this.#invocationResourceTransaction(caller)
    if (!allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError(
        'resource_audience_denied',
        'A resource handle cannot be issued to an audience outside the resource transfer policy.'
      )
    }
    if (existing && this.#resourceRetirementBlocksUse(existing)) {
      throw new CapabilityBrokerError(
        'resource_retiring',
        'A retiring resource cannot issue or renew capability handles.'
      )
    }
    if (
      existing &&
      (
        existing.observe !== registration.observe ||
        existing.subscribeChanges !== registration.subscribeChanges ||
        existing.dispose !== registration.dispose ||
        !sameContentTransport(existing.contentTransport, registration.contentTransport) ||
        existing.retireAfterLastHandleExpires !== registration.retireAfterLastHandleExpires
      )
    ) {
      throw new CapabilityBrokerError(
        'resource_registration_conflict',
        'A live resource identity cannot be rebound to a different provider registration.'
      )
    }
    const resource: ResourceState = existing ?? {
      key,
      resourceRef: opaqueId('res'),
      resourceId: registration.resourceId,
      resourceKind: registration.resourceKind,
      workspaceId,
      allowedAudiences,
      principalLease: callerLease,
      ...(invocationBinding
        ? {
            callerIdBinding: invocationBinding.callerId,
            ...(invocationBinding.executionContextDigest
              ? { executionContextDigestBinding: invocationBinding.executionContextDigest }
              : {})
          }
        : {}),
      semanticRevision: registration.semanticRevision,
      layoutRevision: registration.layoutRevision,
      observe: registration.observe,
      subscribeChanges: registration.subscribeChanges,
      changeSubscriptionAttached: false,
      dispose: registration.dispose,
      contentTransport: registration.contentTransport,
      retireAfterLastHandleExpires: registration.retireAfterLastHandleExpires === true,
      retentionCount: 0,
      inFlightCount: 0,
      expiryRetirementPending: false,
      retirementRequested: false,
      retirementIgnoresRetentions: false,
      retirementAttempts: 0,
      ...(resourceTransaction
        ? { provisionalTransactions: new Set([resourceTransaction]) }
        : {})
    }
    if (existing?.provisionalTransactions) {
      if (resourceTransaction) {
        existing.provisionalTransactions.add(resourceTransaction)
      } else {
        // A Host issuance outside an invocation is itself a committed adopter.
        existing.provisionalTransactions = undefined
      }
    }
    resource.semanticRevision = registration.semanticRevision
    resource.layoutRevision = registration.layoutRevision
    resource.allowedAudiences = allowedAudiences
    resource.observe = registration.observe
    resource.subscribeChanges = registration.subscribeChanges
    resource.dispose = registration.dispose
    resource.contentTransport = registration.contentTransport
    resource.retireAfterLastHandleExpires = registration.retireAfterLastHandleExpires === true
    this.#resources.set(key, resource)
    this.#resourcesByRef.set(resource.resourceRef, resource)
    if (!resource.provisionalTransactions) this.#ensureResourceChangeSubscription(resource)

    const token = opaqueId('cap')
    const ttl = Math.min(MAX_HANDLE_TTL_MS, Math.max(1, registration.expiresInMs ?? this.#handleTtlMs))
    const expiresAt = new Date(this.#now().getTime() + ttl).toISOString()
    const grant: ResourceGrant = {
      token,
      resourceKey: key,
      workspaceId,
      principalLease: callerLease,
      ...(resource.callerIdBinding
        ? { callerIdBinding: resource.callerIdBinding }
        : {}),
      ...(resource.executionContextDigestBinding
        ? { executionContextDigestBinding: resource.executionContextDigestBinding }
        : {}),
      semanticRevision: resource.semanticRevision,
      expiresAt
    }
    this.#handles.set(token, grant)
    resource.expiryRetirementPending = false
    this.#scheduleHandleExpiry(grant, resource)
    const resourceHandle = capabilityResourceHandleSchema.parse({
      token,
      semanticRevision: resource.semanticRevision,
      expiresAt
    })
    this.#trackInvocationResourceIssuance(resourceTransaction, resource, grant)
    return Object.freeze({
      resource: resourceHandle,
      resourceRef: resource.resourceRef,
      retire: (options) => this.#requestResourceRetirement(
        resource,
        options.deferWhileRetained
      )
    })
  }

  bindResourceRef(
    rawCaller: CapabilityCallerContextInput,
    resourceRef: string
  ): CapabilityResourceHandle {
    const caller = this.#hostResourceCaller(rawCaller)
    const state = this.#authorizedResourceRef(caller, resourceRef)
    return this.#issueResourceAs(caller, {
      resourceId: state.resourceId,
      resourceKind: state.resourceKind,
      workspaceId: state.workspaceId,
      audiences: state.allowedAudiences,
      semanticRevision: state.semanticRevision,
      layoutRevision: state.layoutRevision,
      observe: state.observe,
      subscribeChanges: state.subscribeChanges,
      dispose: state.dispose,
      contentTransport: state.contentTransport,
      retireAfterLastHandleExpires: state.retireAfterLastHandleExpires
    }, resourceInvocationBinding(state)).resource
  }

  /**
   * Keeps opaque resources alive for one task snapshot. Provider retirement is
   * deferred until the returned, idempotent release function is called.
   */
  retainResourceRefs(
    rawCaller: CapabilityCallerContextInput,
    resourceRefs: readonly string[]
  ): () => Promise<void> {
    const caller = this.#parseCaller(rawCaller)
    const resources = [...new Set(resourceRefs)]
      .map((resourceRef) => this.#authorizedResourceRef(caller, resourceRef))
    for (const resource of resources) resource.retentionCount += 1
    let released = false
    return async () => {
      if (released) return
      released = true
      for (const resource of resources) {
        resource.retentionCount = Math.max(0, resource.retentionCount - 1)
        if (resource.retentionCount === 0 && resource.retirementRequested) {
          this.#wakeResourceRetirement(resource)
          if (this.#resourceRetirementEligible(resource)) {
            await resource.retirementPromise
          }
        } else if (resource.retentionCount === 0 && resource.expiryRetirementPending) {
          await this.#finalizeExpiryRetirement(resource)
        }
      }
    }
  }

  /**
   * Resolves an opaque resource reference for trusted Host composition without
   * exposing the provider's internal identity to the agent tool result.
   */
  describeResourceRef(
    rawCaller: CapabilityCallerContextInput,
    resourceRef: string
  ): ResolvedCapabilityResource {
    const caller = this.#hostResourceCaller(rawCaller)
    const state = this.#authorizedResourceRef(caller, resourceRef)
    return {
      resourceId: state.resourceId,
      resourceRef: state.resourceRef,
      resourceKind: state.resourceKind,
      ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
      semanticRevision: state.semanticRevision,
      ...(state.layoutRevision ? { layoutRevision: state.layoutRevision } : {})
    }
  }

  /**
   * Projects one already authorized handle to its opaque resource reference
   * without invoking the provider observer.
   */
  describeResourceHandle(
    rawCaller: CapabilityCallerContextInput,
    rawHandle: CapabilityResourceHandle
  ): Readonly<{
    resourceRef: string
  }> {
    const caller = this.#hostResourceCaller(rawCaller)
    const { state } = this.#resolveHandle(caller, rawHandle)
    return Object.freeze({
      resourceRef: state.resourceRef
    })
  }

  async observe(
    rawCaller: CapabilityCallerContextInput,
    rawRequest: CapabilityObserveRequest,
    options: Readonly<{ signal?: AbortSignal }> = {}
  ): Promise<CapabilityObservation> {
    const caller = this.#parseCaller(rawCaller)
    const request = capabilityObserveRequestSchema.parse(rawRequest)
    const { state } = this.#resolveHandle(caller, request.resource)
    const releaseInFlight = this.#pinResource(state)
    let refreshedHandle: CapabilityResourceHandle | undefined
    let result!: CapabilityObservation
    try {
      if (options.signal?.aborted) {
        throw new CapabilityBrokerError('invocation_cancelled', 'Capability observation was cancelled before dispatch.')
      }
      this.#assertCurrentPrincipal(caller)
      let rawObservation: Awaited<ReturnType<ResourceState['observe']>>
      try {
        rawObservation = await state.observe(caller, { signal: options.signal })
      } catch (error) {
        if (options.signal?.aborted) {
          throw new CapabilityBrokerError(
            'invocation_cancelled',
            'Capability observation was cancelled during dispatch.',
            { cause: error }
          )
        }
        throw new CapabilityBrokerError('observation_failed', 'The resource provider failed to observe its state.', {
          category: 'failed',
          cause: error
        })
      }
      if (options.signal?.aborted) {
        throw new CapabilityBrokerError('invocation_cancelled', 'Capability observation was cancelled after dispatch.')
      }
      const observed = resourceObservationResultSchema.safeParse(rawObservation)
      if (!observed.success) {
        throw new CapabilityBrokerError('invalid_observation', 'The resource provider returned an invalid observation.', {
          category: 'failed',
          details: { issues: observed.error.issues.map((issue) => issue.message) }
        })
      }

      const discovered = this.registry.discover(
        publicCallerProjection(caller),
        { acceptedResourceKind: state.resourceKind }
      )
      const operations = observed.data.operationIds
        ? observed.data.operationIds.map((id) => {
            const descriptor = discovered.find((candidate) => candidate.id === id)
            if (!descriptor) {
              throw new CapabilityBrokerError(
                'unregistered_operation',
                `Resource observation advertised unavailable operation ${id}.`,
                { category: 'failed' }
              )
            }
            return descriptor
          })
        : discovered

      // Validate every provider-advertised operation before minting the next
      // handle. A contract failure must not leave an undisclosed live grant.
      this.#assertCurrentPrincipal(caller)
      state.semanticRevision = observed.data.semanticRevision
      state.layoutRevision = observed.data.layoutRevision
      refreshedHandle = this.#issueResourceAs(caller, {
        resourceId: state.resourceId,
        resourceKind: state.resourceKind,
        workspaceId: state.workspaceId,
        audiences: state.allowedAudiences,
        semanticRevision: state.semanticRevision,
        layoutRevision: state.layoutRevision,
        observe: state.observe,
        subscribeChanges: state.subscribeChanges,
        dispose: state.dispose,
        contentTransport: state.contentTransport,
        retireAfterLastHandleExpires: state.retireAfterLastHandleExpires
      }, resourceInvocationBinding(state)).resource

      result = capabilityObservationSchema.parse({
        resource: refreshedHandle,
        resourceRef: state.resourceRef,
        resourceKind: state.resourceKind,
        semanticRevision: state.semanticRevision,
        layoutRevision: state.layoutRevision,
        observedAt: this.#now().toISOString(),
        state: observed.data.state,
        operations
      })
    } catch (error) {
      // A handle minted for a result that cannot be delivered must not remain
      // live until TTL merely because the observation failed afterwards.
      if (refreshedHandle) this.#deleteHandle(refreshedHandle.token)
      throw error
    } finally {
      await releaseInFlight().catch(this.#reportCleanupError)
    }
    try {
      // `await releaseInFlight()` yields even when cleanup is already done.
      // Revalidate at the actual public delivery boundary so Principal A state
      // can never resolve after the Host has switched to Principal B.
      this.#assertCurrentPrincipal(caller)
    } catch (error) {
      if (refreshedHandle) this.#deleteHandle(refreshedHandle.token)
      throw error
    }
    return result
  }

  async invoke(
    rawCaller: CapabilityCallerContextInput,
    rawRequest: CapabilityInvocationRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CapabilityInvocationResult> {
    if (
      typeof rawCaller === 'object' &&
      rawCaller !== null &&
      Object.hasOwn(rawCaller, 'capabilityGrants')
    ) {
      throw new CapabilityBrokerError(
        'invalid_caller',
        'Capability grants can only be projected by the Host system invoker.'
      )
    }
    const caller = this.#parseCaller(rawCaller)
    return this.#invokeAs(caller, rawRequest, options)
  }

  /** Host-private authority path used only by package-scoped system invokers. */
  async invokeHostSystem(
    rawCaller: HostSystemCapabilityCaller,
    rawRequest: CapabilityInvocationRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CapabilityInvocationResult> {
    const baseCaller = this.#parseCaller({
      audience: 'system',
      callerId: rawCaller.callerId,
      ...(rawCaller.workspaceId ? { workspaceId: rawCaller.workspaceId } : {}),
      ...(rawCaller.approvals?.length ? { approvals: [...rawCaller.approvals] } : {})
    })
    const capabilityGrants = z.array(capabilityIdSchema).max(128).superRefine(
      (grants, context) => {
        if (new Set(grants).size !== grants.length) {
          context.addIssue({ code: 'custom', message: 'Capability grants must be unique.' })
        }
      }
    ).parse(rawCaller.capabilityGrants ?? [])
    const systemExecutionContext = rawCaller.systemExecutionContext === undefined
      ? undefined
      : capabilityJsonValueSchema.parse(rawCaller.systemExecutionContext)
    if (systemExecutionContext !== undefined && !baseCaller.principal) {
      throw new CapabilityBrokerError(
        'invalid_caller',
        'A system execution context requires a current Host Principal.'
      )
    }
    const principalSnapshotDigest = systemExecutionContext === undefined
      ? undefined
      : canonicalDigest(capabilityJsonValueSchema.parse(baseCaller.principal))
    const executionContextDigest = systemExecutionContext === undefined
      ? undefined
      : canonicalDigest(systemExecutionContext)
    const caller: CapabilityCallerContext = Object.freeze({
      ...baseCaller,
      ...(capabilityGrants.length > 0 ? { capabilityGrants: Object.freeze(capabilityGrants) } : {}),
      ...(principalSnapshotDigest ? { principalSnapshotDigest } : {}),
      ...(executionContextDigest ? { executionContextDigest } : {})
    })
    return this.#invokeAs(caller, rawRequest, options)
  }

  /**
   * Captures one immutable finite plan from the exact active Human-confirmed
   * invocation. The returned object is process-local; its operation proofs are
   * Broker-owned closures and are never serialized into a package contract.
   */
  createHostApprovedBatch(
    rawCaller: Pick<HostSystemCapabilityCaller, 'callerId' | 'capabilityGrants'>,
    rawPlan: DomainMainFiniteCapabilityBatchPlan
  ): HostApprovedCapabilityBatch {
    const plan = domainMainFiniteCapabilityBatchPlanSchema.parse(rawPlan)
    const capabilityGrants = z.array(capabilityIdSchema).max(128).superRefine(
      (grants, context) => {
        if (new Set(grants).size !== grants.length) {
          context.addIssue({ code: 'custom', message: 'Capability grants must be unique.' })
        }
      }
    ).parse(rawCaller.capabilityGrants ?? [])
    const outerState = this.#activeInvocation.getStore()
    const outer = outerState?.invocation
    if (
      !outerState?.active || !outer || outer.caller.audience === 'system' ||
      outer.approval !== 'confirmation' || outer.approved !== true ||
      !outer.invocationId || !outer.caller.principal
    ) {
      throw new CapabilityBrokerError(
        'delegated_batch_approval_denied',
        'A finite batch requires one exact active Human-confirmed invocation.'
      )
    }
    if (outerState.approvedBatchCreated) {
      throw new CapabilityBrokerError(
        'delegated_batch_already_created',
        'The active Human confirmation has already been bound to a finite batch.'
      )
    }
    // The first structurally valid plan attempt consumes this confirmation.
    // Binding therefore precedes grant, Workspace, Principal and descriptor
    // validation so no replacement or correction can reuse the approval.
    outerState.approvedBatchCreated = true
    const planDigest = createHash('sha256')
      .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
      .digest('hex')
    const confirmedPlanDigest = !Array.isArray(outerState.confirmedInput) &&
      outerState.confirmedInput !== null &&
      typeof outerState.confirmedInput === 'object' &&
      Object.hasOwn(
        outerState.confirmedInput,
        DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD
      )
      ? outerState.confirmedInput[
          DOMAIN_MAIN_FINITE_CAPABILITY_BATCH_CONFIRMED_PLAN_DIGEST_FIELD
        ]
      : undefined
    if (confirmedPlanDigest !== planDigest) {
      throw new CapabilityBrokerError(
        'delegated_batch_confirmation_drift',
        'The complete finite batch plan does not match the exact Human-confirmed plan digest.'
      )
    }
    if (!capabilityGrants.includes(plan.requiredSystemCapabilityGrant)) {
      throw new CapabilityBrokerError(
        'delegated_batch_grant_denied',
        `The package does not hold system capability grant ${plan.requiredSystemCapabilityGrant}.`
      )
    }
    if (outer.caller.workspaceId !== plan.workspaceId) {
      throw new CapabilityBrokerError(
        'delegated_batch_workspace_drift',
        'A finite batch cannot change the approved Workspace scope.'
      )
    }

    const baseCaller = this.#parseCaller({
      audience: 'system',
      callerId: rawCaller.callerId,
      ...(plan.workspaceId ? { workspaceId: plan.workspaceId } : {})
    })
    if (!baseCaller.principal || callerPrincipalLease(baseCaller) !== callerPrincipalLease(outer.caller)) {
      throw new CapabilityBrokerError(
        'principal_changed',
        'The current Principal no longer matches the Human-confirmed batch authority.'
      )
    }
    const caller: CapabilityCallerContext = Object.freeze({
      ...baseCaller,
      capabilityGrants: Object.freeze(capabilityGrants)
    })
    const operationStates = plan.operations.map((operation) => ({
      plan: operation,
      consumed: false
    }))
    const operationIndexes = new Map(
      operationStates.map((operation, index) => [operation.plan.operationId, index])
    )
    const definitions = new Map<string, CapabilityDefinition>()
    const fixedLineages = new Map<string, HostApprovedBatchResourceLineage>()
    const outputSelectors = new Map<string, Extract<
      NonNullable<DomainMainFiniteCapabilityBatchPlan['operations'][number]['resource']>,
      { kind: 'operation-output' }
    >>()

    for (const [index, operationState] of operationStates.entries()) {
      const operation = operationState.plan
      const definition = this.registry.get(operation.actionId)
      if (!definition ||
        definition.descriptor.delegatedBatchGrant !== plan.requiredSystemCapabilityGrant ||
        !definition.descriptor.audiences.includes('system')) {
        throw new CapabilityBrokerError(
          'delegated_batch_operation_denied',
          `Capability ${operation.actionId} is not delegated by the exact batch grant.`
        )
      }
      if (definition.descriptor.principalTransition !== undefined ||
        definition.descriptor.approval === 'system') {
        throw new CapabilityBrokerError(
          'delegated_batch_operation_denied',
          `Capability ${operation.actionId} cannot enter a Human-confirmed finite batch.`
        )
      }
      if (definition.descriptor.effect === 'read') {
        if (operation.idempotencyKey !== undefined) {
          throw new CapabilityBrokerError(
            'delegated_batch_operation_drift',
            `Read operation ${operation.operationId} cannot declare an idempotency key.`
          )
        }
      } else if (!operation.idempotencyKey) {
        throw new CapabilityBrokerError(
          'delegated_batch_operation_drift',
          `Mutation ${operation.operationId} requires one exact idempotency key.`
        )
      }
      const resourceScoped = definition.descriptor.scope === 'resource'
      if (resourceScoped !== (operation.resource !== undefined)) {
        throw new CapabilityBrokerError(
          'delegated_batch_operation_drift',
          `Operation ${operation.operationId} does not match its capability resource scope.`
        )
      }
      if (definition.descriptor.scope === 'workspace' && !plan.workspaceId) {
        throw new CapabilityBrokerError(
          'delegated_batch_workspace_drift',
          `Workspace operation ${operation.operationId} requires the approved Workspace.`
        )
      }
      definitions.set(operation.operationId, definition)

      if (operation.resource?.kind === 'fixed') {
        const { state } = this.#resolveHandle(caller, operation.resource.resource)
        if (!definition.descriptor.resourceKinds.includes(state.resourceKind)) {
          throw new CapabilityBrokerError(
            'delegated_batch_resource_drift',
            `Fixed resource for ${operation.operationId} has an incompatible kind.`
          )
        }
        fixedLineages.set(operation.operationId, {
          resourceRef: state.resourceRef,
          resourceKind: state.resourceKind,
          current: operation.resource.resource
        })
      }
      if (operation.resource?.kind === 'operation-output') {
        const sourceIndex = operationIndexes.get(operation.resource.operationId)
        const sourceDefinition = sourceIndex === undefined
          ? undefined
          : definitions.get(operation.resource.operationId)
        if (sourceIndex === undefined || sourceIndex >= index || !sourceDefinition ||
          !sourceDefinition.descriptor.producedResourceKinds?.some((kind) =>
            definition.descriptor.resourceKinds.includes(kind)
          )) {
          throw new CapabilityBrokerError(
            'delegated_batch_resource_drift',
            `Resource ancestry for ${operation.operationId} is not declared by an earlier operation.`
          )
        }
        outputSelectors.set(batchOutputSelectorKey(operation.resource), operation.resource)
      }
    }

    const outputLineages = new Map<string, HostApprovedBatchResourceLineage>()
    let status: 'active' | 'executing' | 'completed' | 'invalidated' = 'active'
    let nextIndex = 0
    const invalidate = (): void => { status = 'invalidated' }
    const assertOuterActive = (): void => {
      if (!outerState.active || this.#activeInvocation.getStore() !== outerState) {
        invalidate()
        throw new CapabilityBrokerError(
          'delegated_batch_expired',
          'The finite batch no longer belongs to the active Human-confirmed invocation.'
        )
      }
      this.assertPrincipalCurrent(outer.caller.principal, outer.caller.principalContextVersion)
    }
    const assertLineageCurrent = (
      lineage: HostApprovedBatchResourceLineage
    ): CapabilityResourceHandle => {
      const { state } = this.#resolveHandle(caller, lineage.current)
      if (state.resourceRef !== lineage.resourceRef ||
        state.resourceKind !== lineage.resourceKind ||
        state.semanticRevision !== lineage.current.semanticRevision) {
        invalidate()
        throw new CapabilityBrokerError(
          'delegated_batch_resource_drift',
          'The exact batch resource revision or ancestry changed.'
        )
      }
      return lineage.current
    }

    return Object.freeze({
      revision: plan.revision,
      planDigest,
      invoke: async (operationId, contract, options = {}) => {
        if (status !== 'active') {
          throw new CapabilityBrokerError(
            status === 'completed' ? 'delegated_batch_consumed' : 'delegated_batch_invalidated',
            'The finite batch has no reusable operation proof.'
          )
        }
        assertOuterActive()
        const operationState = operationStates[nextIndex]
        const definition = operationState ? definitions.get(operationState.plan.operationId) : undefined
        if (!operationState || !definition || operationState.consumed ||
          operationId !== operationState.plan.operationId ||
          contract.actionId !== operationState.plan.actionId ||
          contract.effect !== definition.descriptor.effect) {
          invalidate()
          throw new CapabilityBrokerError(
            'delegated_batch_operation_drift',
            'A finite batch operation changed identity, contract, or order.'
          )
        }

        const resourceSelector = operationState.plan.resource
        let resource: CapabilityResourceHandle | undefined
        let inputLineage: HostApprovedBatchResourceLineage | undefined
        if (resourceSelector?.kind === 'fixed') {
          inputLineage = fixedLineages.get(operationState.plan.operationId)
        } else if (resourceSelector?.kind === 'operation-output') {
          inputLineage = outputLineages.get(batchOutputSelectorKey(resourceSelector))
        }
        if (resourceSelector && !inputLineage) {
          invalidate()
          throw new CapabilityBrokerError(
            'delegated_batch_resource_drift',
            'The exact earlier operation did not produce the planned resource.'
          )
        }
        if (inputLineage) resource = assertLineageCurrent(inputLineage)

        const invocationId = definition.descriptor.effect === 'read'
          ? undefined
          : operationState.plan.idempotencyKey
        const operationCaller: CapabilityCallerContext = Object.freeze({
          ...caller,
          approvals: definition.descriptor.approval === 'none' || !invocationId
            ? []
            : [{
                actionId: definition.descriptor.id,
                invocationId,
                mode: definition.descriptor.approval as 'confirmation'
              }]
        })
        const request: CapabilityInvocationRequest = {
          actionId: operationState.plan.actionId,
          ...(invocationId ? { invocationId } : {}),
          ...(resource ? { resource } : {}),
          ...(resource && definition.descriptor.concurrency.revision === 'optimistic'
            ? { expectedRevision: resource.semanticRevision }
            : {}),
          input: capabilityJsonValueSchema.parse(operationState.plan.input)
        }
        operationState.consumed = true
        status = 'executing'
        let issuedResources: readonly HostApprovedBatchIssuedResource[] = Object.freeze([])
        try {
          const result = await this.#invokeAs(operationCaller, request, {
            signal: options.signal,
            approvedBatchOperation: operationState,
            captureIssuedResources: (resources) => { issuedResources = resources }
          })
          assertOuterActive()

          if (inputLineage && result.resource) {
            const { state } = this.#resolveHandle(caller, result.resource)
            if (state.resourceRef !== inputLineage.resourceRef) {
              throw new CapabilityBrokerError(
                'delegated_batch_resource_drift',
                'A batch mutation returned a different resource ancestry.'
              )
            }
            for (const lineage of [...fixedLineages.values(), ...outputLineages.values()]) {
              if (lineage.resourceRef === state.resourceRef) lineage.current = result.resource
            }
          }

          for (const [selectorKey, selector] of outputSelectors) {
            if (selector.operationId !== operationState.plan.operationId) continue
            const rawHandle = batchOutputPathValue(result.output, selector.path)
            const handle = capabilityResourceHandleSchema.parse(rawHandle)
            if (!result.replayed && !issuedResources.some(({ resource: issued }) =>
              issued.token === handle.token
            )) {
              throw new CapabilityBrokerError(
                'delegated_batch_resource_drift',
                'A planned output resource was not issued by the exact batch operation.'
              )
            }
            const { state } = this.#resolveHandle(caller, handle)
            if (!definition.descriptor.producedResourceKinds?.includes(state.resourceKind)) {
              throw new CapabilityBrokerError(
                'delegated_batch_resource_drift',
                'A planned output resource has an undeclared kind.'
              )
            }
            outputLineages.set(selectorKey, {
              resourceRef: state.resourceRef,
              resourceKind: state.resourceKind,
              current: handle
            })
          }

          nextIndex += 1
          status = nextIndex === operationStates.length ? 'completed' : 'active'
          return result
        } catch (error) {
          invalidate()
          throw error
        }
      },
      discard: invalidate
    })
  }

  async #invokeAs(
    caller: CapabilityCallerContext,
    rawRequest: CapabilityInvocationRequest,
    options: CapabilityInvokeAsOptions
  ): Promise<CapabilityInvocationResult> {
    const requestResult = capabilityInvocationRequestSchema.safeParse(rawRequest)
    if (!requestResult.success) {
      throw new CapabilityBrokerError('invalid_invocation', 'Capability invocation is invalid.', {
        details: { issues: requestResult.error.issues.map((issue) => issue.message) }
      })
    }
    const request = requestResult.data
    let definition: CapabilityDefinition | undefined
    let resource: ResourceState | undefined
    let releaseResourcePin: (() => Promise<void>) | undefined
    try {
      definition = this.registry.get(request.actionId)
      if (!definition) {
        throw new CapabilityBrokerError('unknown_capability', `Capability ${request.actionId} is not registered.`)
      }
      this.#authorizeAudience(caller, definition)
      if (caller.audience === 'system' && definition.descriptor.delegatedBatchGrant) {
        const proof = options.approvedBatchOperation
        const plannedInvocationId = definition.descriptor.effect === 'read'
          ? undefined
          : proof?.plan.idempotencyKey
        if (!proof || !proof.consumed ||
          proof.plan.actionId !== request.actionId ||
          plannedInvocationId !== request.invocationId ||
          stableJson(capabilityJsonValueSchema.parse(proof.plan.input)) !== stableJson(request.input) ||
          !caller.capabilityGrants?.includes(definition.descriptor.delegatedBatchGrant)) {
          throw new CapabilityBrokerError(
            'delegated_batch_proof_denied',
            `Capability ${definition.descriptor.id} requires its exact one-use batch proof.`
          )
        }
      } else if (options.approvedBatchOperation !== undefined) {
        throw new CapabilityBrokerError(
          'delegated_batch_proof_denied',
          'A finite batch proof cannot authorize this capability audience.'
        )
      }
      resource = this.#authorizeScope(caller, definition, request)
      releaseResourcePin = resource ? this.#pinResource(resource) : undefined
      this.#authorizeApproval(caller, definition, request.invocationId)

      const parsedInput = definition.inputSchema.safeParse(request.input)
      if (!parsedInput.success) {
        throw new CapabilityBrokerError('invalid_input', `Input for ${request.actionId} failed validation.`, {
          details: { issues: parsedInput.error.issues.map((issue) => issue.message) }
        })
      }

      if (definition.descriptor.effect !== 'read' && !request.invocationId) {
        throw new CapabilityBrokerError(
          'invocation_id_required',
          `Non-read capability ${request.actionId} requires an invocation ID.`
        )
      }
      if (request.expectedRevision && !resource) {
        throw new CapabilityBrokerError('revision_without_resource', 'Expected revision requires a resource handle.')
      }
      if (options.signal?.aborted) {
        throw new CapabilityBrokerError('invocation_cancelled', 'Capability invocation was cancelled before dispatch.')
      }
      this.#assertCurrentPrincipal(caller)

      const beforeRevision = resource?.semanticRevision
      const callerLease = callerPrincipalLease(caller)
      const principalScopedIdempotency = definition.descriptor.principalTransition !== 'host-authority'
      const fingerprint = stableJson({
        actionId: request.actionId,
        capabilityGrants: [...(caller.capabilityGrants ?? [])].sort(),
        principalSnapshotDigest: caller.principalSnapshotDigest ?? null,
        executionContextDigest: caller.executionContextDigest ?? null,
        ...(principalScopedIdempotency ? { principalLease: callerLease } : {}),
        ...(principalScopedIdempotency ? { workspaceScope: workspaceInvocationScope(caller) } : {}),
        resourceRef: resource?.resourceRef ?? null,
        expectedRevision: request.expectedRevision ?? null,
        input: idempotencyInput(definition, request.input, this.#sensitiveInputFingerprintKey)
      })
      const idempotencyKey = request.invocationId
        ? `${caller.audience}\u0000${caller.callerId}\u0000${principalScopedIdempotency ? workspaceInvocationScope(caller) : 'global'}\u0000${principalScopedIdempotency ? callerLease : 'host-principal-transition'}\u0000${request.actionId}\u0000${request.invocationId}`
        : undefined

      if (idempotencyKey) {
        const existing = this.#idempotency.get(idempotencyKey)
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new CapabilityBrokerError(
              'idempotency_conflict',
              'The invocation ID was already used with a different request.'
            )
          }
          const original = await existing.promise
          if (definition.descriptor.principalTransition === 'host-authority') {
            if (!existing.resultPrincipalLease || existing.resultPrincipalLease !== this.#currentPrincipalLease()) {
              throw new CapabilityBrokerError(
                'idempotency_post_state_mismatch',
                'The Host Principal no longer matches this transition invocation result.'
              )
            }
          } else {
            if (this.#currentPrincipalLease() !== callerLease) {
              const outcomeUnknown = isMutation(definition) || existing.postDispatchMutation === true
              throw new CapabilityBrokerError(
                outcomeUnknown ? 'outcome_unknown' : 'principal_changed',
                outcomeUnknown
                  ? 'The Principal changed after capability dispatch; the mutation outcome is unknown.'
                  : 'The current Principal changed before capability result delivery.'
              )
            }
          }
          const replayed = capabilityInvocationResultSchema.parse({ ...original, replayed: true })
          this.#appendAudit({
            status: 'replayed',
            caller,
            definition,
            request,
            resource,
            beforeRevision: replayed.beforeRevision,
            afterRevision: replayed.afterRevision
          })
          const replayRelease = releaseResourcePin
          releaseResourcePin = undefined
          if (replayRelease) await replayRelease().catch(this.#reportCleanupError)
          const expectedLease = definition.descriptor.principalTransition === 'host-authority'
            ? existing.resultPrincipalLease
            : callerLease
          if (!expectedLease || this.#currentPrincipalLease() !== expectedLease) {
            const outcomeUnknown = isMutation(definition) || existing.postDispatchMutation === true
            throw new CapabilityBrokerError(
              outcomeUnknown ? 'outcome_unknown' : 'principal_changed',
              outcomeUnknown
                ? 'The Principal changed after capability dispatch; the mutation outcome is unknown.'
                : 'The current Principal changed before capability result delivery.'
            )
          }
          return replayed
        }
      }

      if (definition.descriptor.concurrency.revision === 'optimistic') {
        if (!request.expectedRevision) {
          throw new CapabilityBrokerError(
            'expected_revision_required',
            `Capability ${request.actionId} requires an expected semantic revision.`
          )
        }
        if (request.expectedRevision !== beforeRevision) {
          throw new CapabilityBrokerError('revision_conflict', 'The resource semantic revision is stale.', {
            details: { expected: request.expectedRevision, actual: beforeRevision ?? null }
          })
        }
        if (request.resource?.semanticRevision !== request.expectedRevision) {
          throw new CapabilityBrokerError('revision_conflict', 'The resource handle is bound to a stale semantic revision.', {
            details: {
              expected: request.expectedRevision,
              handle: request.resource?.semanticRevision ?? null
            }
          })
        }
      }

      if (idempotencyKey) this.#reserveIdempotencyCapacity()
      const activeDefinition = definition
      let postDispatchMutation = isMutation(activeDefinition)
      let acceptedResultPrincipalLease = callerLease
      const executionRelease = releaseResourcePin
      releaseResourcePin = undefined
      const execution = this.#execute({
        caller,
        definition: activeDefinition,
        request,
        parsedInput: parsedInput.data,
        resource,
        beforeRevision,
        signal: options.signal,
        releaseResourcePinForRetirement: executionRelease,
        captureAcceptedPrincipalLease: (lease) => { acceptedResultPrincipalLease = lease },
        capturePostDispatchMutation: (value) => { postDispatchMutation = value },
        captureIssuedResources: options.captureIssuedResources,
        prepareDelivery: async () => {
          if (executionRelease) {
            await executionRelease().catch(this.#reportCleanupError)
          }
        },
        assertDelivery: (result) => {
          if (this.#currentPrincipalLease() !== acceptedResultPrincipalLease) {
            const outcomeUnknown = postDispatchMutation || result.changed
            throw new CapabilityBrokerError(
              outcomeUnknown ? 'outcome_unknown' : 'principal_changed',
              outcomeUnknown
                ? 'The Principal changed after capability dispatch; the mutation outcome is unknown.'
                : 'The current Principal changed before capability result delivery.'
            )
          }
        },
        cleanupAfterFailure: async () => {
          if (executionRelease) {
            await executionRelease().catch(this.#reportCleanupError)
          }
        }
      })
      if (idempotencyKey) {
        const entry: IdempotencyEntry = {
          fingerprint,
          promise: execution,
          settled: false,
          retainUntilRestart: activeDefinition.descriptor.principalTransition === 'host-authority'
        }
        this.#idempotency.set(idempotencyKey, entry)
        void execution.then(
          () => {
            entry.settled = true
            if (activeDefinition.descriptor.principalTransition === 'host-authority') {
              entry.resultPrincipalLease = acceptedResultPrincipalLease
            }
            entry.postDispatchMutation = postDispatchMutation
          },
          () => { entry.settled = true }
        )
      }
      return await execution
    } catch (error) {
      const brokerError = error instanceof CapabilityBrokerError
        ? error
        : new CapabilityBrokerError('invocation_failed', 'Capability invocation failed.', {
            category: 'failed',
            cause: error
          })
      this.#appendAudit({
        status: brokerError.category === 'failed' ? 'failed' : 'rejected',
        caller,
        definition,
        request,
        resource,
        beforeRevision: resource?.semanticRevision,
        errorCode: brokerError.code
      })
      throw brokerError
    } finally {
      if (releaseResourcePin) await releaseResourcePin().catch(this.#reportCleanupError)
    }
  }

  /**
   * Returns the capability invocation currently executing on this async call
   * chain. This is intentionally read-only and Host-private: nested trusted
   * runtimes may inherit an existing approval, but cannot manufacture one.
   */
  currentInvocation(): ActiveCapabilityInvocation | undefined {
    const state = this.#activeInvocation.getStore()
    return state?.active ? state.invocation : undefined
  }

  /** Host-private exact lease check for nested trusted invocation composition. */
  assertPrincipalCurrent(
    expected: PrincipalSnapshot | undefined,
    expectedContextVersion?: number
  ): void {
    if (
      this.#currentPrincipalLease() !== principalLease(
        expected,
        expectedContextVersion ?? expected?.identityVersion ?? 0
      )
    ) {
      throw new CapabilityBrokerError(
        'principal_changed',
        'The current Principal no longer matches the inherited invocation lease.'
      )
    }
  }

  async describeResourceContent(
    rawCaller: CapabilityCallerContextInput,
    rawHandle: CapabilityResourceHandle
  ): Promise<CapabilityResourceContentDescriptor> {
    const caller = this.#parseCaller(rawCaller)
    const handle = capabilityResourceHandleSchema.parse(rawHandle)
    const { state } = this.#resolveHandle(caller, handle)
    const actionId = this.#contentAction(state, 'describeActionId')
    const result = await this.#invokeAs(
      caller,
      { actionId, resource: handle, input: {} },
      {}
    )
    const parsed = z.object({
      ok: z.literal(true),
      descriptor: z.object({
        file: z.object({
          name: z.string().trim().min(1).max(1_024).optional(),
          mimeType: z.string().trim().min(1).max(256).optional()
        }).passthrough(),
        range: z.object({
          available: z.literal(true),
          size: z.number().int().nonnegative(),
          maxChunkBytes: z.number().int().positive(),
          recommendedChunkBytes: z.number().int().positive()
        }).passthrough()
      }).passthrough()
    }).passthrough().safeParse(result.output)
    if (!parsed.success) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_descriptor',
        `Capability ${actionId} did not return a valid byte-range descriptor.`,
        { category: 'failed' }
      )
    }
    return capabilityResourceContentDescriptorSchema.parse({
      size: parsed.data.descriptor.range.size,
      mimeType: parsed.data.descriptor.file.mimeType || 'application/octet-stream',
      ...(parsed.data.descriptor.file.name ? { fileName: parsed.data.descriptor.file.name } : {}),
      maxChunkBytes: parsed.data.descriptor.range.maxChunkBytes,
      recommendedChunkBytes: parsed.data.descriptor.range.recommendedChunkBytes
    })
  }

  async readResourceContentRange(
    rawCaller: CapabilityCallerContextInput,
    rawHandle: CapabilityResourceHandle,
    range: { offset: number; length: number }
  ): Promise<CapabilityResourceContentRange> {
    const caller = this.#parseCaller(rawCaller)
    const handle = capabilityResourceHandleSchema.parse(rawHandle)
    const { state } = this.#resolveHandle(caller, handle)
    const actionId = this.#contentAction(state, 'readRangeActionId')
    const result = await this.#invokeAs(caller, {
      actionId,
      resource: handle,
      input: {
        range: z.object({
          offset: z.number().int().nonnegative(),
          length: z.number().int().positive()
        }).strict().parse(range)
      }
    }, {})
    const parsed = z.object({
      ok: z.literal(true),
      offset: z.number().int().nonnegative(),
      length: z.number().int().nonnegative(),
      size: z.number().int().nonnegative(),
      dataBase64: z.string()
    }).passthrough().safeParse(result.output)
    if (!parsed.success) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_range',
        `Capability ${actionId} did not return a valid byte range.`,
        { category: 'failed' }
      )
    }
    const decodedLength = Buffer.from(parsed.data.dataBase64, 'base64').length
    if (parsed.data.offset !== range.offset
      || parsed.data.length <= 0
      || parsed.data.length > range.length
      || parsed.data.offset + parsed.data.length > parsed.data.size
      || decodedLength !== parsed.data.length) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_range',
        `Capability ${actionId} returned an inconsistent byte range.`,
        { category: 'failed' }
      )
    }
    return capabilityResourceContentRangeSchema.parse({
      offset: parsed.data.offset,
      length: parsed.data.length,
      size: parsed.data.size,
      dataBase64: parsed.data.dataBase64
    })
  }

  listAuditRecords(): CapabilityAuditRecord[] {
    return [...this.#auditRecords]
  }

  listEvents(
    rawCaller: CapabilityCallerContextInput,
    rawQuery: CapabilityEventQuery | undefined = undefined
  ): CapabilityResourceChangeEvent[] {
    const caller = this.#parseCaller(rawCaller)
    const query = capabilityEventQuerySchema.parse(rawQuery ?? {})
    const afterIndex = query.afterEventId
      ? this.#events.findIndex((event) => event.id === query.afterEventId)
      : -1
    return this.#events
      .slice(afterIndex + 1)
      .filter((event) => this.#eventVisibleToCaller(event, caller))
      .filter((event) => !query.resourceRef || event.resourceRef === query.resourceRef)
      .slice(0, query.limit)
      .map((event) => capabilityResourceChangeEventSchema.parse({
        ...event,
        resourceStatus: this.#resourceReferenceStatus(caller, event.resourceRef)
      }))
  }

  subscribe(
    rawCaller: CapabilityCallerContextInput,
    listener: (event: CapabilityResourceChangeEvent) => void
  ): () => void {
    const caller = this.#parseCaller(rawCaller)
    if (typeof listener !== 'function') {
      throw new CapabilityBrokerError('invalid_listener', 'Capability event listener must be a function.')
    }
    const subscription = { caller: publicCallerProjection(caller), listener }
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  async #execute(options: {
    caller: CapabilityCallerContext
    definition: CapabilityDefinition
    request: CapabilityInvocationRequest
    parsedInput: unknown
    resource?: ResourceState
    beforeRevision?: string
    signal?: AbortSignal
    releaseResourcePinForRetirement?: () => Promise<void>
    captureAcceptedPrincipalLease?: (lease: string) => void
    capturePostDispatchMutation?: (value: boolean) => void
    captureIssuedResources?: (resources: readonly HostApprovedBatchIssuedResource[]) => void
    prepareDelivery?: () => Promise<void>
    assertDelivery?: (result: CapabilityInvocationResult) => void
    cleanupAfterFailure?: () => Promise<void>
  }): Promise<CapabilityInvocationResult> {
    const resourceTransaction: InvocationResourceTransaction = {
      issuances: [],
      state: 'pending'
    }
    try {
      const result = await this.#executeWithResourceTransaction(options, resourceTransaction)
      await options.prepareDelivery?.()
      options.assertDelivery?.(result)
      const issuedResources = Object.freeze(resourceTransaction.issuances.map((issuance) =>
        Object.freeze({
          resource: capabilityResourceHandleSchema.parse({
            token: issuance.grant.token,
            semanticRevision: issuance.grant.semanticRevision,
            expiresAt: issuance.grant.expiresAt
          }),
          resourceRef: issuance.resource.resourceRef,
          resourceKind: issuance.resource.resourceKind
        })
      ))
      this.#commitInvocationResourceTransaction(resourceTransaction)
      options.captureIssuedResources?.(issuedResources)
      return result
    } catch (error) {
      await options.cleanupAfterFailure?.()
      await this.#rollbackInvocationResourceTransaction(resourceTransaction)
      throw error
    }
  }

  async #executeWithResourceTransaction(options: {
    caller: CapabilityCallerContext
    definition: CapabilityDefinition
    request: CapabilityInvocationRequest
    parsedInput: unknown
    resource?: ResourceState
    beforeRevision?: string
    signal?: AbortSignal
    releaseResourcePinForRetirement?: () => Promise<void>
    captureAcceptedPrincipalLease?: (lease: string) => void
    capturePostDispatchMutation?: (value: boolean) => void
  }, resourceTransaction: InvocationResourceTransaction): Promise<CapabilityInvocationResult> {
    const { caller, definition, request, resource, beforeRevision, signal } = options
    let rawResult: Awaited<ReturnType<CapabilityDefinition['handler']>>
    let principalMismatchObserved = false
    let observedPrincipalLease: string | undefined
    const assertPrincipalCurrent = (): void => {
      const currentLease = this.#currentPrincipalLease()
      if (currentLease !== callerPrincipalLease(caller)) {
        principalMismatchObserved = true
        observedPrincipalLease = currentLease
        throw new CapabilityBrokerError(
          'principal_changed',
          'The current Principal changed before capability dispatch.'
        )
      }
    }
    try {
      const approval = definition.descriptor.approval
      const approved = approval === 'none' || Boolean(
        request.invocationId &&
        caller.approvals.some((grant) => (
          grant.actionId === request.actionId &&
          grant.invocationId === request.invocationId &&
          grant.mode === approval
        ))
      )
      const activeState: ActiveCapabilityInvocationState = {
        active: true,
        approvedBatchCreated: false,
        confirmedInput: request.input,
        resourceTransaction,
        invocation: Object.freeze({
          caller,
          actionId: request.actionId,
          ...(request.invocationId ? { invocationId: request.invocationId } : {}),
          effect: definition.descriptor.effect,
          approval,
          approved,
          scope: definition.descriptor.scope,
          ...(definition.descriptor.autonomousWrite
            ? { autonomousWrite: definition.descriptor.autonomousWrite }
            : {}),
          ...(resource
            ? {
                authorizedResource: Object.freeze({
                  resourceRef: resource.resourceRef,
                  resourceKind: resource.resourceKind,
                  ...(resource.workspaceId ? { workspaceId: resource.workspaceId } : {}),
                  semanticRevision: resource.semanticRevision
                })
              }
            : {})
        })
      }
      rawResult = await this.#activeInvocation.run(activeState, async () => {
        try {
          if (signal?.aborted) {
            throw new CapabilityBrokerError(
              'invocation_cancelled',
              'Capability invocation was cancelled before handler dispatch.'
            )
          }
          assertPrincipalCurrent()
          return await definition.handler(options.parsedInput, {
            caller,
            ...(request.invocationId ? { invocationId: request.invocationId } : {}),
            assertPrincipalCurrent,
            resource: resource && this.#resolvedResource(resource),
            issueResource: (registration) => this.#issueResourceAs(caller, registration).resource,
            signal
          })
        } finally {
          activeState.active = false
        }
      })
      const postHandlerPrincipalLease = this.#currentPrincipalLease()
      let acceptedPrincipalLease = callerPrincipalLease(caller)
      if (postHandlerPrincipalLease !== acceptedPrincipalLease) {
        const acknowledgedPrincipalTransition =
          definition.descriptor.principalTransition === 'host-authority' &&
          principalMismatchObserved &&
          observedPrincipalLease === postHandlerPrincipalLease &&
          !handlerResultRequestsStateChange(rawResult)
        const acknowledgedTypedFailure =
          definition.descriptor.principalTransition === undefined &&
          principalMismatchObserved &&
          observedPrincipalLease === postHandlerPrincipalLease &&
          !handlerResultRequestsStateChange(rawResult)
        if (!acknowledgedPrincipalTransition && !acknowledgedTypedFailure) {
          const outcomeUnknown = isMutation(definition) || handlerResultRequestsStateChange(rawResult)
          throw new CapabilityBrokerError(
            outcomeUnknown ? 'outcome_unknown' : 'principal_changed',
            outcomeUnknown
              ? 'The Principal changed after capability dispatch; the mutation outcome is unknown.'
              : 'The current Principal changed before capability result acceptance.'
          )
        }
        acceptedPrincipalLease = postHandlerPrincipalLease
      }
      options.captureAcceptedPrincipalLease?.(acceptedPrincipalLease)
    } catch (error) {
      if (error instanceof CapabilityBrokerError) throw error
      throw new CapabilityBrokerError('handler_failed', `Handler for ${request.actionId} failed.`, {
        category: 'failed',
        cause: error
      })
    }
    if (!rawResult || typeof rawResult !== 'object' || !Object.hasOwn(rawResult, 'output')) {
      throw new CapabilityBrokerError('invalid_handler_result', 'Capability handler must return an output envelope.', {
        category: 'failed'
      })
    }

    const parsedOutput = definition.outputSchema.safeParse(rawResult.output)
    if (!parsedOutput.success) {
      throw new CapabilityBrokerError('invalid_output', `Output for ${request.actionId} failed validation.`, {
        category: 'failed',
        details: { issues: parsedOutput.error.issues.map((issue) => issue.message) }
      })
    }
    const outputResult = capabilityJsonValueSchema.safeParse(parsedOutput.data)
    if (!outputResult.success) {
      throw new CapabilityBrokerError('non_serializable_output', 'Capability output must be JSON serializable.', {
        category: 'failed'
      })
    }

    const mutation = isMutation(definition)
    const retireResource = rawResult.retireResource === true
      || rawResult.retireResource === 'defer-while-retained'
    if (retireResource && !resource) {
      throw new CapabilityBrokerError(
        'retired_resource_required',
        'A retired result requires a resource handle.',
        { category: 'failed' }
      )
    }
    if (retireResource && definition.descriptor.effect === 'read') {
      throw new CapabilityBrokerError(
        'invalid_retirement_effect',
        'A read capability cannot retire a resource.',
        { category: 'failed' }
      )
    }
    const changed = rawResult.changed ?? Boolean(mutation && resource)
    if (retireResource && changed) {
      throw new CapabilityBrokerError(
        'invalid_retirement_change',
        'A capability result cannot both revise and retire a resource.',
        { category: 'failed' }
      )
    }
    if (changed && !mutation) {
      throw new CapabilityBrokerError('invalid_change_effect', 'Only mutation effects may report resource changes.', {
        category: 'failed'
      })
    }
    if (changed && !resource) {
      throw new CapabilityBrokerError('changed_resource_required', 'A changed result requires a resource handle.', {
        category: 'failed'
      })
    }
    options.capturePostDispatchMutation?.(mutation || retireResource || changed)

    let afterRevision = beforeRevision
    let refreshedHandle: CapabilityResourceHandle | undefined
    if (changed && resource) {
      const semanticRevision = rawResult.semanticRevision?.trim()
      if (!semanticRevision || semanticRevision === beforeRevision) {
        throw new CapabilityBrokerError(
          'invalid_semantic_revision',
          'A changed resource result must return a new semantic revision.',
          { category: 'failed' }
        )
      }
      resource.semanticRevision = semanticRevision
      resource.layoutRevision = rawResult.layoutRevision ?? resource.layoutRevision
      afterRevision = semanticRevision
      refreshedHandle = this.#issueResourceAs(caller, {
        resourceId: resource.resourceId,
        resourceKind: resource.resourceKind,
        workspaceId: resource.workspaceId,
        audiences: resource.allowedAudiences,
        semanticRevision,
        layoutRevision: resource.layoutRevision,
        observe: resource.observe,
        subscribeChanges: resource.subscribeChanges,
        dispose: resource.dispose,
        contentTransport: resource.contentTransport,
        retireAfterLastHandleExpires: resource.retireAfterLastHandleExpires
      }, resourceInvocationBinding(resource)).resource
    }

    if (retireResource && resource) {
      this.#beginResourceRetirement(
        resource,
        rawResult.retireResource === 'defer-while-retained'
      )
      await options.releaseResourcePinForRetirement?.()
    }

    const result = capabilityInvocationResultSchema.parse({
      actionId: request.actionId,
      invocationId: request.invocationId,
      output: outputResult.data,
      resource: refreshedHandle,
      beforeRevision,
      afterRevision,
      changed,
      replayed: false,
      completedAt: this.#now().toISOString()
    })
    this.#appendAudit({
      status: 'success',
      caller,
      definition,
      request,
      resource,
      beforeRevision,
      afterRevision
    })

    if (changed && resource && beforeRevision && afterRevision && request.invocationId) {
      this.#publishEvent(capabilityResourceChangeEventSchema.parse({
        id: opaqueId('event'),
        type: 'resource.changed',
        origin: 'capability',
        occurredAt: this.#now().toISOString(),
        workspaceId: resource.workspaceId,
        resourceRef: resource.resourceRef,
        resourceKind: resource.resourceKind,
        actionId: request.actionId,
        invocationId: request.invocationId,
        beforeRevision,
        afterRevision
      }))
    }
    return result
  }

  #hostResourceCaller(rawCaller: CapabilityCallerContextInput): CapabilityCallerContext {
    const active = this.#activeInvocation.getStore()
    if (active?.active && rawCaller === active.invocation.caller) {
      return active.invocation.caller
    }
    return this.#parseCaller(rawCaller)
  }

  #parseResourceInvocationBinding(
    caller: CapabilityCallerContext,
    rawBinding: CapabilityResourceInvocationBinding | undefined
  ): CapabilityResourceInvocationBinding | undefined {
    if (rawBinding === undefined) return undefined
    const result = z.object({
      callerId: z.string().trim().min(1).max(256),
      executionContextDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional()
    }).strict().safeParse(rawBinding)
    const active = this.#activeInvocation.getStore()
    if (!result.success || !active?.active || caller !== active.invocation.caller ||
      result.data.callerId !== caller.callerId ||
      result.data.executionContextDigest !== caller.executionContextDigest) {
      throw new CapabilityBrokerError(
        'resource_scope_mismatch',
        'A process-local resource can only bind to the exact active Host invocation.'
      )
    }
    return Object.freeze(result.data)
  }

  #invocationResourceTransaction(
    caller: CapabilityCallerContext
  ): InvocationResourceTransaction | undefined {
    const active = this.#activeInvocation.getStore()
    if (!active?.active) return undefined
    const invocationCaller = active.invocation.caller
    if (
      caller.callerId !== invocationCaller.callerId ||
      caller.audience !== invocationCaller.audience ||
      workspaceInvocationScope(caller) !== workspaceInvocationScope(invocationCaller) ||
      callerPrincipalLease(caller) !== callerPrincipalLease(invocationCaller) ||
      caller.executionContextDigest !== invocationCaller.executionContextDigest
    ) return undefined
    return active.resourceTransaction
  }

  #trackInvocationResourceIssuance(
    transaction: InvocationResourceTransaction | undefined,
    resource: ResourceState,
    grant: ResourceGrant
  ): void {
    if (!transaction || transaction.state !== 'pending') return
    transaction.issuances.push({ resource, grant })
  }

  #commitInvocationResourceTransaction(
    transaction: InvocationResourceTransaction
  ): void {
    if (transaction.state !== 'pending') return
    transaction.state = 'committed'
    const committedResources = new Set<ResourceState>()
    for (const { resource } of transaction.issuances) {
      if (
        this.#resources.get(resource.key) !== resource ||
        this.#resourcesByRef.get(resource.resourceRef) !== resource ||
        resource.retirementRequested
      ) continue
      if (resource.provisionalTransactions?.has(transaction)) {
        // One successful adopter commits the shared resource for every handle.
        resource.provisionalTransactions = undefined
      }
      if (!resource.provisionalTransactions) committedResources.add(resource)
    }
    transaction.issuances.length = 0
    for (const resource of committedResources) this.#ensureResourceChangeSubscription(resource)
  }

  async #rollbackInvocationResourceTransaction(
    transaction: InvocationResourceTransaction
  ): Promise<void> {
    if (transaction.state !== 'pending') return
    transaction.state = 'rolled-back'
    const touchedResources = new Set<ResourceState>()
    for (const issuance of [...transaction.issuances].reverse()) {
      if (this.#handles.get(issuance.grant.token) === issuance.grant) {
        this.#deleteHandle(issuance.grant.token)
      }
      touchedResources.add(issuance.resource)
    }
    transaction.issuances.length = 0
    for (const resource of touchedResources) {
      const provisionalTransactions = resource.provisionalTransactions
      if (!provisionalTransactions?.delete(transaction)) continue
      if (provisionalTransactions.size > 0) continue
      if (this.#resources.get(resource.key) !== resource) continue
      try {
        await this.#requestResourceRetirement(resource, false)
      } catch (error) {
        // The resource stays poisoned and cannot issue, bind, describe, or be
        // used while the bounded retirement retry runs.
        this.#reportCleanupError(error)
      }
    }
  }

  #parseCaller(rawCaller: CapabilityCallerContextInput): CapabilityCallerContext {
    const result = capabilityCallerContextSchema.safeParse(rawCaller)
    if (!result.success) {
      throw new CapabilityBrokerError('invalid_caller', 'Capability caller context is invalid.', {
        details: { issues: result.error.issues.map((issue) => issue.message) }
      })
    }
    const principalContext = this.#captureCurrentPrincipalContext()
    const principal = principalContext.principal ?? undefined
    return Object.freeze({
      ...result.data,
      ...(principal ? { principal } : {}),
      principalContextVersion: principalContext.identityVersion
    })
  }

  #captureCurrentPrincipalContext(): PrincipalContextSnapshot {
    if (this.#resolveCurrentPrincipalContext) {
      try {
        return principalContextSnapshotSchema.parse(this.#resolveCurrentPrincipalContext())
      } catch (error) {
        if (error instanceof CapabilityBrokerError) throw error
        throw new CapabilityBrokerError(
          'principal_unavailable',
          'The Host Principal context could not be read.',
          { category: 'failed', cause: error }
        )
      }
    }
    if (!this.#resolveCurrentPrincipal) {
      return principalContextSnapshotSchema.parse({ identityVersion: 0, principal: null })
    }
    let rawPrincipal: PrincipalSnapshot | null
    try {
      rawPrincipal = this.#resolveCurrentPrincipal()
    } catch (error) {
      throw new CapabilityBrokerError(
        'principal_unavailable',
        'The Host Principal authority could not be read.',
        { category: 'failed', cause: error }
      )
    }
    if (rawPrincipal === null) {
      return principalContextSnapshotSchema.parse({ identityVersion: 0, principal: null })
    }
    const parsed = principalSnapshotSchema.safeParse(rawPrincipal)
    if (!parsed.success) {
      throw new CapabilityBrokerError(
        'invalid_principal',
        'The Host Principal authority returned an invalid snapshot.',
        {
          category: 'failed',
          details: { issues: parsed.error.issues.map((issue) => issue.message) }
        }
      )
    }
    return principalContextSnapshotSchema.parse({
      identityVersion: parsed.data.identityVersion,
      principal: parsed.data
    })
  }

  #currentPrincipalLease(): string {
    const context = this.#captureCurrentPrincipalContext()
    return principalLease(context.principal ?? undefined, context.identityVersion)
  }

  #assertCurrentPrincipal(caller: CapabilityCallerContext): void {
    if (this.#currentPrincipalLease() !== callerPrincipalLease(caller)) {
      throw new CapabilityBrokerError(
        'principal_changed',
        'The current Principal changed before capability dispatch.'
      )
    }
  }

  #parseResourceRegistration(raw: CapabilityResourceRegistration): CapabilityResourceRegistration {
    if (!raw || typeof raw !== 'object' || typeof raw.observe !== 'function') {
      throw new CapabilityBrokerError('invalid_resource_registration', 'Resource registration requires an observer.')
    }
    if (raw.dispose !== undefined && typeof raw.dispose !== 'function') {
      throw new CapabilityBrokerError('invalid_resource_registration', 'Resource disposal must be a function.')
    }
    if (raw.subscribeChanges !== undefined && typeof raw.subscribeChanges !== 'function') {
      throw new CapabilityBrokerError(
        'invalid_resource_registration',
        'Resource change subscription must be a function.'
      )
    }
    if (
      raw.retireAfterLastHandleExpires !== undefined &&
      typeof raw.retireAfterLastHandleExpires !== 'boolean'
    ) {
      throw new CapabilityBrokerError(
        'invalid_resource_registration',
        'Automatic resource retirement must be a boolean.'
      )
    }
    const resourceId = raw.resourceId?.trim()
    const resourceKind = raw.resourceKind?.trim()
    const semanticRevision = raw.semanticRevision?.trim()
    if (!resourceId || !resourceKind || !semanticRevision) {
      throw new CapabilityBrokerError(
        'invalid_resource_registration',
        'Resource ID, kind, and semantic revision are required.'
      )
    }
    return {
      ...raw,
      resourceId,
      resourceKind,
      workspaceId: normalizedWorkspaceId(raw.workspaceId),
      audiences: raw.audiences === undefined
        ? undefined
        : z.array(capabilityAudienceSchema).min(1).max(3).refine(
            (audiences) => new Set(audiences).size === audiences.length,
            'Resource audiences must be unique.'
          ).parse(raw.audiences),
      semanticRevision,
      layoutRevision: raw.layoutRevision?.trim() || undefined,
      retireAfterLastHandleExpires: raw.retireAfterLastHandleExpires === true,
      contentTransport: raw.contentTransport
        ? z.object({
            describeActionId: z.string().trim().min(1).max(192),
            readRangeActionId: z.string().trim().min(1).max(192)
          }).strict().parse(raw.contentTransport)
        : undefined
    }
  }

  #authorizedResourceRef(
    caller: CapabilityCallerContext,
    resourceRef: string
  ): ResourceState {
    const state = this.#resourcesByRef.get(resourceRef)
    if (!state) {
      const retired = this.#retiredResourcesByRef.get(resourceRef)
      if (retired) {
        if (
          retired.workspaceId !== caller.workspaceId ||
          retired.principalLease !== callerPrincipalLease(caller) ||
          !resourceInvocationBindingMatches(retired, caller)
        ) {
          throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource reference is outside the caller scope.')
        }
        if (!retired.allowedAudiences.includes(caller.audience)) {
          throw new CapabilityBrokerError(
            'resource_audience_denied',
            'Resource reference is not transferable to this audience.'
          )
        }
        throw new CapabilityBrokerError('resource_ref_retired', 'Resource reference has been retired.')
      }
      throw new CapabilityBrokerError('resource_unavailable', 'Resource reference is no longer available.')
    }
    if (
      state.workspaceId !== caller.workspaceId ||
      state.principalLease !== callerPrincipalLease(caller) ||
      !resourceInvocationBindingMatches(state, caller)
    ) {
      throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource reference is outside the caller scope.')
    }
    if (!state.allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError('resource_audience_denied', 'Resource reference is not transferable to this audience.')
    }
    if (this.#resourceRetirementBlocksUse(state)) {
      throw new CapabilityBrokerError('resource_retiring', 'Resource reference retirement is in progress.')
    }
    return state
  }

  #resolveHandle(
    caller: CapabilityCallerContext,
    rawHandle: CapabilityResourceHandle
  ): { grant: ResourceGrant; state: ResourceState } {
    const handleResult = capabilityResourceHandleSchema.safeParse(rawHandle)
    if (!handleResult.success) {
      throw new CapabilityBrokerError('invalid_resource_handle', 'Resource handle is invalid.')
    }
    const handle = handleResult.data
    const grant = this.#handles.get(handle.token)
    if (!grant
      || grant.semanticRevision !== handle.semanticRevision
      || grant.expiresAt !== handle.expiresAt) {
      throw new CapabilityBrokerError('invalid_resource_handle', 'Resource handle is unknown or forged.')
    }
    if (new Date(grant.expiresAt).getTime() <= this.#now().getTime()) {
      this.#deleteHandle(grant.token)
      void this.#requestExpiryRetirement(grant.resourceKey).catch(this.#reportCleanupError)
      throw new CapabilityBrokerError('resource_handle_expired', 'Resource handle has expired.')
    }
    const callerLease = callerPrincipalLease(caller)
    if (
      grant.workspaceId !== caller.workspaceId ||
      grant.principalLease !== callerLease ||
      !resourceInvocationBindingMatches(grant, caller)
    ) {
      throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource handle is outside the caller scope.')
    }
    const state = this.#resources.get(grant.resourceKey)
    if (!state) throw new CapabilityBrokerError('resource_unavailable', 'Resource is no longer available.')
    if (state.principalLease !== callerLease ||
      !resourceInvocationBindingMatches(state, caller)) {
      throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource handle is outside the caller scope.')
    }
    if (!state.allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError('resource_audience_denied', 'Resource handle is not transferable to this audience.')
    }
    if (this.#resourceRetirementBlocksUse(state)) {
      throw new CapabilityBrokerError('resource_retiring', 'Resource retirement is in progress.')
    }
    return { grant, state }
  }

  #authorizeAudience(caller: CapabilityCallerContext, definition: CapabilityDefinition): void {
    if (!definition.descriptor.audiences.includes(caller.audience)) {
      throw new CapabilityBrokerError(
        'audience_denied',
        `Capability ${definition.descriptor.id} is not available to ${caller.audience} callers.`
      )
    }
  }

  #authorizeScope(
    caller: CapabilityCallerContext,
    definition: CapabilityDefinition,
    request: CapabilityInvocationRequest
  ): ResourceState | undefined {
    const { scope, resourceKinds } = definition.descriptor
    if (scope === 'global') {
      if (request.resource) throw new CapabilityBrokerError('unexpected_resource', 'Global capability does not accept a resource.')
      return undefined
    }
    if (scope === 'workspace') {
      if (!caller.workspaceId) {
        throw new CapabilityBrokerError('workspace_required', 'Workspace capability requires caller workspace scope.')
      }
      if (request.resource) throw new CapabilityBrokerError('unexpected_resource', 'Workspace capability does not accept a resource.')
      return undefined
    }
    if (!request.resource) {
      throw new CapabilityBrokerError('resource_required', 'Resource capability requires an opaque resource handle.')
    }
    const { state } = this.#resolveHandle(caller, request.resource)
    if (!resourceKinds.includes(state.resourceKind)) {
      throw new CapabilityBrokerError(
        'resource_kind_mismatch',
        `Capability ${definition.descriptor.id} does not support ${state.resourceKind}.`
      )
    }
    return state
  }

  #authorizeApproval(
    caller: CapabilityCallerContext,
    definition: CapabilityDefinition,
    invocationId: string | undefined
  ): void {
    const approval = definition.descriptor.approval
    if (approval === 'none') return
    if (!invocationId) {
      throw new CapabilityBrokerError('approval_denied', 'Approved capability requires an invocation ID.')
    }
    const grant = caller.approvals.find((candidate) => (
      candidate.actionId === definition.descriptor.id
      && candidate.invocationId === invocationId
      && candidate.mode === approval
    ))
    if (!grant) {
      throw new CapabilityBrokerError(
        'approval_denied',
        `Capability ${definition.descriptor.id} requires ${approval} approval for this invocation.`
      )
    }
  }

  #resolvedResource(resource: ResourceState): ResolvedCapabilityResource {
    return {
      resourceId: resource.resourceId,
      resourceRef: resource.resourceRef,
      resourceKind: resource.resourceKind,
      workspaceId: resource.workspaceId,
      semanticRevision: resource.semanticRevision,
      layoutRevision: resource.layoutRevision
    }
  }

  #contentAction(
    state: ResourceState,
    key: 'describeActionId' | 'readRangeActionId'
  ): string {
    const actionId = state.contentTransport?.[key]?.trim()
    if (!actionId) {
      throw new CapabilityBrokerError(
        'resource_content_unavailable',
        'The resource does not expose broker-managed byte-range content.'
      )
    }
    this.#validateContentAction(state.resourceKind, actionId)
    return actionId
  }

  #validateContentAction(resourceKind: string, actionId: string): void {
    const definition = this.registry.get(actionId)
    if (!definition
      || definition.descriptor.scope !== 'resource'
      || definition.descriptor.effect !== 'read'
      || !definition.descriptor.resourceKinds.includes(resourceKind)) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_registration',
        `Resource content action ${actionId} is not a compatible registered read capability.`,
        { category: 'failed' }
      )
    }
  }

  #appendAudit(input: {
    status: CapabilityAuditRecord['status']
    caller: CapabilityCallerContext
    definition?: CapabilityDefinition
    request: CapabilityInvocationRequest
    resource?: ResourceState
    beforeRevision?: string
    afterRevision?: string
    errorCode?: string
  }): void {
    const record: CapabilityAuditRecord = {
      id: opaqueId('audit'),
      occurredAt: this.#now().toISOString(),
      status: input.status,
      caller: {
        audience: input.caller.audience,
        callerId: input.caller.callerId,
        ...(input.caller.workspaceId ? { workspaceId: input.caller.workspaceId } : {})
      },
      actionId: input.request.actionId,
      ...(input.request.invocationId ? { invocationId: input.request.invocationId } : {}),
      ...(input.resource ? { resourceRef: input.resource.resourceRef } : {}),
      ...(input.definition ? {
        effect: input.definition.descriptor.effect,
        approval: input.definition.descriptor.approval
      } : {}),
      ...(input.beforeRevision ? { beforeRevision: input.beforeRevision } : {}),
      ...(input.afterRevision ? { afterRevision: input.afterRevision } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {})
    }
    this.#auditRecords.push(capabilityAuditRecordSchema.parse(record))
    if (this.#auditRecords.length > this.#maxAuditRecords) {
      this.#auditRecords.splice(0, this.#auditRecords.length - this.#maxAuditRecords)
    }
  }

  #publishEvent(event: CapabilityResourceChangeEvent): void {
    this.#events.push(event)
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents)
    for (const subscription of this.#subscriptions) {
      try {
        // Re-capture Host authority for every delivery. A subscription created
        // by Principal A cannot keep receiving A's resource events after the
        // application switches to Principal B.
        const caller = this.#parseCaller(subscription.caller)
        if (!this.#eventVisibleToCaller(event, caller)) continue
        subscription.listener(capabilityResourceChangeEventSchema.parse({
          ...event,
          resourceStatus: this.#resourceReferenceStatus(caller, event.resourceRef)
        }))
      } catch {
        // Event consumers are isolated from successful domain mutations.
      }
    }
  }

  #ensureResourceChangeSubscription(resource: ResourceState): void {
    if (
      !resource.subscribeChanges ||
      resource.changeSubscriptionAttached ||
      resource.provisionalTransactions ||
      resource.retirementRequested ||
      this.#resources.get(resource.key) !== resource ||
      this.#resourcesByRef.get(resource.resourceRef) !== resource
    ) return

    resource.changeSubscriptionAttached = true
    const pending: unknown[] = []
    let active = false
    let closed = false
    const listener = (change: unknown): void => {
      if (closed) return
      if (!active) {
        pending.push(change)
        return
      }
      this.#acceptProviderResourceChange(resource, change)
    }
    try {
      const dispose = resource.subscribeChanges(listener)
      if (typeof dispose !== 'function') {
        throw new CapabilityBrokerError(
          'invalid_resource_change_subscription',
          'A resource change subscription must synchronously return a disposer.',
          { category: 'failed' }
        )
      }
      let disposed = false
      resource.disposeChangeSubscription = () => {
        if (disposed) return
        disposed = true
        closed = true
        dispose()
      }
      active = true
      for (const change of pending.splice(0)) {
        this.#acceptProviderResourceChange(resource, change)
      }
    } catch (error) {
      closed = true
      pending.length = 0
      resource.disposeChangeSubscription = undefined
      resource.changeSubscriptionAttached = false
      this.#reportCleanupError(error)
    }
  }

  #acceptProviderResourceChange(resource: ResourceState, rawChange: unknown): void {
    if (
      resource.retirementRequested ||
      this.#resources.get(resource.key) !== resource ||
      this.#resourcesByRef.get(resource.resourceRef) !== resource
    ) return
    const parsed = resourceProviderChangeSchema.safeParse(rawChange)
    if (!parsed.success) {
      this.#reportCleanupError(new CapabilityBrokerError(
        'invalid_provider_resource_change',
        'A resource provider submitted an invalid change notification.',
        {
          category: 'failed',
          details: { issues: parsed.error.issues.map((issue) => issue.message) }
        }
      ))
      return
    }
    const beforeRevision = resource.semanticRevision
    if (parsed.data.semanticRevision === beforeRevision) return
    resource.semanticRevision = parsed.data.semanticRevision
    resource.layoutRevision = parsed.data.layoutRevision ?? resource.layoutRevision
    this.#publishEvent(capabilityResourceChangeEventSchema.parse({
      id: opaqueId('event'),
      type: 'resource.changed',
      origin: 'provider',
      occurredAt: this.#now().toISOString(),
      workspaceId: resource.workspaceId,
      resourceRef: resource.resourceRef,
      resourceKind: resource.resourceKind,
      beforeRevision,
      afterRevision: resource.semanticRevision
    }))
  }

  #detachResourceChangeSubscription(resource: ResourceState): void {
    const dispose = resource.disposeChangeSubscription
    resource.disposeChangeSubscription = undefined
    if (!dispose) return
    try {
      dispose()
    } catch (error) {
      this.#reportCleanupError(error)
    }
  }

  #eventVisibleToCaller(event: CapabilityResourceChangeEvent, caller: CapabilityCallerContext): boolean {
    if (event.workspaceId !== caller.workspaceId) return false
    const resource = this.#resourcesByRef.get(event.resourceRef)
      ?? this.#retiredResourcesByRef.get(event.resourceRef)
    return Boolean(
      resource &&
      resource.principalLease === callerPrincipalLease(caller) &&
      resourceInvocationBindingMatches(resource, caller) &&
      resource.allowedAudiences.includes(caller.audience)
    )
  }

  #resourceReferenceStatus(
    caller: CapabilityCallerContext,
    resourceRef: string
  ): CapabilityResourceChangeEvent['resourceStatus'] {
    const state = this.#resourcesByRef.get(resourceRef)
    return state
      && state.workspaceId === caller.workspaceId
      && state.principalLease === callerPrincipalLease(caller)
      && resourceInvocationBindingMatches(state, caller)
      && state.allowedAudiences.includes(caller.audience)
      ? 'live'
      : 'retired'
  }

  #scheduleHandleExpiry(grant: ResourceGrant, resource: ResourceState): void {
    if (!resource.retireAfterLastHandleExpires) return
    const existing = this.#handleExpiryTimers.get(grant.token)
    if (existing) clearTimeout(existing)
    const delay = Math.max(0, new Date(grant.expiresAt).getTime() - this.#now().getTime())
    const timer = setTimeout(() => {
      this.#handleExpiryTimers.delete(grant.token)
      void this.#expireHandle(grant).catch(this.#reportCleanupError)
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.#handleExpiryTimers.set(grant.token, timer)
  }

  async #expireHandle(grant: ResourceGrant): Promise<void> {
    if (this.#handles.get(grant.token) !== grant) return
    if (new Date(grant.expiresAt).getTime() > this.#now().getTime()) {
      const resource = this.#resources.get(grant.resourceKey)
      if (resource) this.#scheduleHandleExpiry(grant, resource)
      return
    }
    this.#deleteHandle(grant.token)
    await this.#requestExpiryRetirement(grant.resourceKey)
  }

  #deleteHandle(token: string): void {
    this.#handles.delete(token)
    const timer = this.#handleExpiryTimers.get(token)
    if (timer) clearTimeout(timer)
    this.#handleExpiryTimers.delete(token)
  }

  async #requestExpiryRetirement(resourceKeyValue: string): Promise<void> {
    const resource = this.#resources.get(resourceKeyValue)
    if (!resource?.retireAfterLastHandleExpires) return
    const now = this.#now().getTime()
    for (const [token, grant] of this.#handles) {
      if (grant.resourceKey !== resourceKeyValue) continue
      if (new Date(grant.expiresAt).getTime() > now) {
        resource.expiryRetirementPending = false
        return
      }
      this.#deleteHandle(token)
    }
    resource.expiryRetirementPending = true
    await this.#finalizeExpiryRetirement(resource)
  }

  async #finalizeExpiryRetirement(resource: ResourceState): Promise<void> {
    if (!resource.expiryRetirementPending) return
    if (resource.retentionCount > 0 || resource.inFlightCount > 0) return
    const now = this.#now().getTime()
    for (const [token, grant] of this.#handles) {
      if (grant.resourceKey !== resource.key) continue
      if (new Date(grant.expiresAt).getTime() > now) {
        resource.expiryRetirementPending = false
        return
      }
      this.#deleteHandle(token)
    }
    resource.expiryRetirementPending = false
    await this.#requestResourceRetirement(resource, false)
  }

  async #requestResourceRetirement(
    resource: ResourceState,
    deferWhileRetained: boolean
  ): Promise<void> {
    const retirement = this.#beginResourceRetirement(resource, deferWhileRetained)
    if (
      deferWhileRetained &&
      (resource.retentionCount > 0 || resource.inFlightCount > 0)
    ) return
    await retirement
  }

  #beginResourceRetirement(
    resource: ResourceState,
    deferWhileRetained: boolean
  ): Promise<void> {
    resource.retirementRequested = true
    resource.expiryRetirementPending = false
    this.#detachResourceChangeSubscription(resource)
    if (!deferWhileRetained) resource.retirementIgnoresRetentions = true
    if (resource.retirementRetryTimer) {
      clearTimeout(resource.retirementRetryTimer)
      resource.retirementRetryTimer = undefined
    }
    if (resource.retirementPromise) {
      this.#wakeResourceRetirement(resource)
      return resource.retirementPromise
    }
    const operation = (async () => {
      await this.#waitForResourceRetirementEligibility(resource)
      try {
        await resource.dispose?.()
      } catch (error) {
        resource.retirementAttempts += 1
        this.#scheduleResourceRetirementRetry(resource)
        throw new CapabilityBrokerError(
          'resource_disposal_failed',
          'The resource provider failed to dispose its retired resource.',
          { category: 'failed', cause: error }
        )
      }
      resource.retirementAttempts = 0
      this.#resources.delete(resource.key)
      this.#resourcesByRef.delete(resource.resourceRef)
      this.#retiredResourcesByRef.set(resource.resourceRef, {
        resourceRef: resource.resourceRef,
        workspaceId: resource.workspaceId,
        allowedAudiences: [...resource.allowedAudiences],
        principalLease: resource.principalLease,
        ...(resource.callerIdBinding
          ? { callerIdBinding: resource.callerIdBinding }
          : {}),
        ...(resource.executionContextDigestBinding
          ? { executionContextDigestBinding: resource.executionContextDigestBinding }
          : {})
      })
      this.#trimMap(this.#retiredResourcesByRef, this.#maxEvents)
      for (const [token, grant] of this.#handles) {
        if (grant.resourceKey === resource.key) this.#deleteHandle(token)
      }
    })()
    const retirement = operation.finally(() => {
      if (resource.retirementPromise === retirement) {
        resource.retirementPromise = undefined
      }
    })
    resource.retirementPromise = retirement
    return retirement
  }

  async #waitForResourceRetirementEligibility(resource: ResourceState): Promise<void> {
    while (!this.#resourceRetirementEligible(resource)) {
      await new Promise<void>((resolve) => {
        resource.retirementWake = resolve
        if (this.#resourceRetirementEligible(resource)) {
          resource.retirementWake = undefined
          resolve()
        }
      })
    }
  }

  #resourceRetirementEligible(resource: ResourceState): boolean {
    return resource.retirementRequested &&
      resource.inFlightCount === 0 &&
      (resource.retirementIgnoresRetentions || resource.retentionCount === 0)
  }

  #resourceRetirementBlocksUse(resource: ResourceState): boolean {
    return resource.retirementRequested && (
      resource.retirementIgnoresRetentions || resource.retentionCount === 0
    )
  }

  #wakeResourceRetirement(resource: ResourceState): void {
    const wake = resource.retirementWake
    resource.retirementWake = undefined
    wake?.()
  }

  #scheduleResourceRetirementRetry(resource: ResourceState): void {
    if (
      resource.retirementAttempts >= MAX_RESOURCE_RETIREMENT_ATTEMPTS ||
      resource.retirementRetryTimer ||
      this.#resourcesByRef.get(resource.resourceRef) !== resource
    ) return
    const timer = setTimeout(() => {
      if (resource.retirementRetryTimer !== timer) return
      resource.retirementRetryTimer = undefined
      const retry = this.#beginResourceRetirement(
        resource,
        !resource.retirementIgnoresRetentions
      )
      void retry.catch(this.#reportCleanupError)
    }, RESOURCE_RETIREMENT_RETRY_MS * resource.retirementAttempts)
    timer.unref?.()
    resource.retirementRetryTimer = timer
  }

  #pinResource(resource: ResourceState): () => Promise<void> {
    resource.inFlightCount += 1
    let released = false
    return async () => {
      if (released) return
      released = true
      resource.inFlightCount = Math.max(0, resource.inFlightCount - 1)
      if (resource.inFlightCount > 0) return
      if (resource.retirementRequested) {
        this.#wakeResourceRetirement(resource)
        if (this.#resourceRetirementEligible(resource)) {
          await resource.retirementPromise
        }
      } else if (resource.expiryRetirementPending) {
        await this.#finalizeExpiryRetirement(resource)
      }
    }
  }

  #reserveIdempotencyCapacity(): void {
    if (this.#idempotency.size < this.#maxIdempotencyEntries) return
    for (const [key, entry] of this.#idempotency) {
      if (!entry.settled || entry.retainUntilRestart) continue
      this.#idempotency.delete(key)
      if (this.#idempotency.size < this.#maxIdempotencyEntries) return
    }
    throw new CapabilityBrokerError(
      'idempotency_capacity_exceeded',
      'The capability idempotency journal is full of pending invocations.'
    )
  }

  #trimMap<Key, Value>(map: Map<Key, Value>, maxSize: number): void {
    while (map.size > maxSize) {
      const oldest = map.keys().next().value
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }
}
