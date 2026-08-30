import { createHash } from 'node:crypto'

import {
  MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
  MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
  PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  PortableResourceReferenceError,
  canonicalPortableResourceIdentity,
  isPortableResourceAuthorityResolver,
  isPortableResourceExportProjection,
  isPortableResourceReferenceCodec,
  parsePortableResourceReference,
  portableResourceAuthorityResolverMatchesContract,
  portableResourceCodecMatchesContract,
  portableResourceCodecResolverBindingMatches,
  portableResourceExportConsumerOwnerSchema,
  serializePortableResourceReference,
  validatePortableAuthorityReference,
  validatePortableIdentity,
  validatePortableKind,
  type DomainMainPortableResourceReferencesHost,
  type PortableResourceAuthorityResolver,
  type PortableResourceExportProjection,
  type PortableResourceLocalRegistration,
  type PortableResourceMaterializationOptions,
  type PortableResourceMaterializedReference,
  type PortableResourceReferenceCodec,
  type PortableResourceReferenceEnvelope,
  type TrustedPortableResourceAuthority
} from '@sciforge/domain-sdk/portable-resource-references'
import {
  definePrincipalSnapshot,
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  domainPackageContributionIdSchema,
  domainPackageModuleIdSchema,
  domainPackageNameSchema,
  domainPackageVersionSchema
} from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainRuntimeContributionOwner
} from '@sciforge/domain-sdk/host'
import {
  capabilityCallerContextSchema,
  capabilityResourceBindRequestSchema,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'
import type {
  ActiveCapabilityInvocation,
  CapabilityBroker,
  CapabilityResourceInvocationBinding
} from '../capabilities/broker'
import type { CapabilityResourceRegistration } from '../capabilities/registry'

const DEFAULT_MAX_EXPORT_BINDINGS = 2_048

type PortableCompositionOwner = Readonly<{
  packageName: string
  moduleId: string
  moduleVersion: string
  contributionId: string
}>

export type OwnedPortableResourceCodec = Readonly<{
  owner: PortableCompositionOwner
  codec: PortableResourceReferenceCodec
}>

export type OwnedPortableAuthorityResolver = Readonly<{
  owner: PortableCompositionOwner
  resolver: PortableResourceAuthorityResolver
}>

type IssuedPortableResource = Readonly<{
  resource: CapabilityResourceHandle
  resourceRef: string
  retire(options: Readonly<{ deferWhileRetained: boolean }>): Promise<void>
}>

/**
 * Minimal Host-private Broker surface. Domain packages receive only the
 * owner-scoped facade returned by forOwner().
 */
export type PortableResourceCapabilityBroker = Readonly<{
  currentInvocation(): ActiveCapabilityInvocation | undefined
  issueResource(
    caller: CapabilityCallerContextInput,
    registration: CapabilityResourceRegistration,
    invocationBinding?: CapabilityResourceInvocationBinding
  ): IssuedPortableResource
  bindResourceRef(
    caller: CapabilityCallerContextInput,
    resourceRef: string
  ): CapabilityResourceHandle
  describeResourceRef(
    caller: CapabilityCallerContextInput,
    resourceRef: string
  ): Readonly<{ resourceRef: string; resourceKind: string }>
}>

type ExportBinding = Readonly<{
  authority: string
  codec: OwnedPortableResourceCodec
  projection: PortableResourceExportProjection
  principal: PrincipalSnapshot
}>

type ResourceClaim = {
  ownership: string
  references: Set<string>
}

type IssuanceClaim = Readonly<{
  resourceId: string
  resourceRef: string
}>

type ResourceLease = {
  principal: PrincipalSnapshot
  retire(options: Readonly<{ deferWhileRetained: boolean }>): Promise<void>
  retiring: boolean
  retirement?: Promise<void>
}

export class PortableResourceCodecRegistry {
  readonly #byKind = new Map<string, OwnedPortableResourceCodec>()

  constructor(codecs: readonly OwnedPortableResourceCodec[] = []) {
    for (const owned of codecs) {
      const snapshot = snapshotOwnedCodec(owned)
      const kind = snapshot.codec.kind
      if (this.#byKind.has(kind)) throw portableError('duplicate_codec')
      this.#byKind.set(kind, snapshot)
    }
  }

  require(kind: string): OwnedPortableResourceCodec {
    const owned = this.#byKind.get(validatePortableKind(kind))
    if (!owned) throw portableError('unknown_kind')
    return owned
  }

  list(): readonly OwnedPortableResourceCodec[] {
    return Object.freeze([...this.#byKind.values()].sort((left, right) =>
      left.codec.kind.localeCompare(right.codec.kind)
    ))
  }
}

export class PortableAuthorityResolverRegistry {
  readonly #byId = new Map<string, OwnedPortableAuthorityResolver>()
  readonly #byKind = new Map<string, string>()

  constructor(resolvers: readonly OwnedPortableAuthorityResolver[] = []) {
    for (const owned of resolvers) {
      const snapshot = snapshotOwnedResolver(owned)
      const id = snapshot.resolver.id
      if (this.#byId.has(id)) throw portableError('duplicate_resolver')
      for (const kind of snapshot.resolver.kinds) {
        if (this.#byKind.has(kind)) throw portableError('duplicate_resolver')
        this.#byKind.set(kind, id)
      }
      this.#byId.set(id, snapshot)
    }
  }

  require(resolverId: string, kind: string): OwnedPortableAuthorityResolver {
    const canonicalResolverId = validatePortableKind(resolverId)
    const canonicalKind = validatePortableKind(kind)
    const owned = this.#byId.get(canonicalResolverId)
    if (!owned) throw portableError('unknown_resolver')
    if (this.#byKind.get(canonicalKind) !== canonicalResolverId) {
      throw portableError('incompatible_resolver')
    }
    return owned
  }

  list(): readonly OwnedPortableAuthorityResolver[] {
    return Object.freeze([...this.#byId.values()].sort((left, right) =>
      left.resolver.id.localeCompare(right.resolver.id)
    ))
  }
}

/**
 * Projects codecs and resolvers only from canonical main.extension values.
 * Declaration version, contract, runtime value, and trusted owner metadata
 * are bound before any provider operation can run.
 */
export function composePortableResourceReferenceRegistries(
  host: DomainMainContributionHost
): Readonly<{
  codecs: PortableResourceCodecRegistry
  resolvers: PortableAuthorityResolverRegistry
}> {
  const codecs: OwnedPortableResourceCodec[] = []
  const resolvers: OwnedPortableAuthorityResolver[] = []

  for (const contribution of host.list(MAIN_EXTENSION_CONTRIBUTION_KIND)) {
    const contractLocation = recordLocation(contribution.contract)
    const runtimeLocation = recordLocation(contribution.value)
    if (!isPortableLocation(contractLocation) && !isPortableLocation(runtimeLocation)) continue
    if (contractLocation !== runtimeLocation ||
      contribution.version !== PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION) {
      throw portableError('invalid_resolution')
    }
    const owner = parseOwner(contribution)

    if (contractLocation === MAIN_PORTABLE_RESOURCE_CODEC_LOCATION) {
      if (!isPortableResourceReferenceCodec(contribution.value) ||
        !portableResourceCodecMatchesContract(contribution.contract, contribution.value)) {
        throw portableError('invalid_resolution')
      }
      codecs.push(Object.freeze({ owner, codec: contribution.value }))
      continue
    }

    if (!isPortableResourceAuthorityResolver(contribution.value) ||
      !portableResourceAuthorityResolverMatchesContract(
        contribution.contract,
        contribution.value
      )) {
      throw portableError('invalid_resolution')
    }
    resolvers.push(Object.freeze({ owner, resolver: contribution.value }))
  }

  const codecRegistry = new PortableResourceCodecRegistry(codecs)
  const resolverRegistry = new PortableAuthorityResolverRegistry(resolvers)
  for (const { codec } of codecRegistry.list()) {
    const { resolver } = resolverRegistry.require(codec.resolverId, codec.kind)
    if (!portableResourceCodecResolverBindingMatches(codec, resolver)) {
      throw portableError('incompatible_resolver')
    }
  }
  return Object.freeze({ codecs: codecRegistry, resolvers: resolverRegistry })
}

export type PortableResourceReferenceServiceOptions = Readonly<{
  broker: PortableResourceCapabilityBroker
  codecs: PortableResourceCodecRegistry
  resolvers: PortableAuthorityResolverRegistry
  currentPrincipal: () => PrincipalSnapshot | undefined
  maxExportBindings?: number
  reportCleanupError?: (error: unknown) => void
}>

/**
 * Host-owned bridge from bounded durable identity to one process-local Broker
 * resource. Local identity is derived from codec owner, canonical envelope,
 * and the exact Principal lease, never from resolver-controlled fields.
 */
export class PortableResourceReferenceService {
  readonly #broker: PortableResourceCapabilityBroker
  readonly #codecs: PortableResourceCodecRegistry
  readonly #resolvers: PortableAuthorityResolverRegistry
  readonly #currentPrincipal: () => PrincipalSnapshot | undefined
  readonly #maxExportBindings: number
  readonly #reportCleanupError: (error: unknown) => void
  readonly #exportsByRef = new Map<string, ExportBinding>()
  readonly #resourceClaims = new Map<string, ResourceClaim>()
  readonly #issuanceClaims = new Map<string, IssuanceClaim>()
  readonly #leasesByRef = new Map<string, ResourceLease>()
  #accepting = true

  constructor(options: PortableResourceReferenceServiceOptions) {
    this.#broker = options.broker
    this.#codecs = options.codecs
    this.#resolvers = options.resolvers
    this.#currentPrincipal = options.currentPrincipal
    this.#maxExportBindings = boundedCapacity(options.maxExportBindings)
    this.#reportCleanupError = options.reportCleanupError ?? (() => undefined)
  }

  /** Host-private entry used by tests and owner-scoped facades. */
  async materialize(
    rawEnvelope: string | unknown,
    rawCaller: CapabilityCallerContextInput,
    options: PortableResourceMaterializationOptions = {}
  ): Promise<PortableResourceMaterializedReference> {
    this.#requireAccepting('resolution_rejected')
    throwIfCancelled(options.signal)
    const invocationBinding = options.exportPolicy === 'forbid'
      ? this.#requireProcessLocalInvocationBinding(rawCaller)
      : undefined
    const envelope = parsePortableResourceReference(rawEnvelope)
    const ownedCodec = this.#codecs.require(envelope.kind)
    const identity = decodeCanonicalIdentity(ownedCodec.codec, envelope.identity)
    const ownedResolver = this.#resolvers.require(
      ownedCodec.codec.resolverId,
      envelope.kind
    )
    const caller = publicCaller(rawCaller)
    const principal = requireCurrentPrincipal(this.#currentPrincipal)
    assertInvocationPrincipal(rawCaller, principal)
    const authority = lookupExactAuthority(
      ownedResolver.resolver,
      envelope.authority,
      envelope.kind
    )
    const assertCurrentPrincipal = principalLeaseAssertion(
      principal,
      this.#currentPrincipal,
      options.signal
    )

    let rawResolution: unknown
    try {
      assertCurrentPrincipal()
      rawResolution = await ownedResolver.resolver.resolve({
        envelope,
        identity,
        resourceKind: ownedCodec.codec.resourceKind,
        authority,
        audience: caller.audience,
        principal,
        assertPrincipalCurrent: assertCurrentPrincipal,
        ...(options.signal ? { signal: options.signal } : {})
      })
    } catch (error) {
      throwIfCancelled(options.signal)
      if (error instanceof PortableResourceReferenceError) throw error
      throw portableError('resolution_rejected')
    }
    const { registration, exportProjection } = validateResolution(
      rawResolution,
      ownedCodec.codec.resourceKind
    )
    try {
      assertCurrentPrincipal()
      this.#requireAccepting('resolution_rejected')
    } catch (error) {
      await this.#disposeRegistration(registration, false)
      throw error
    }
    const ownership = canonicalOwnership(ownedCodec, envelope, principal)
    const resourceId = 'portable:' + digest(ownership)
    const audiences = Object.freeze(
      [...(registration.audiences ?? [caller.audience])].sort()
    )
    const workspaceId = registration.workspaceId ?? caller.workspaceId
    const issuanceKey = digest(JSON.stringify({
      resourceId,
      workspaceId: workspaceId ?? null,
      audiences,
      exportPolicy: options.exportPolicy ?? 'allow',
      invocationBinding: invocationBinding ?? null
    }))
    const knownIssuance = this.#issuanceClaims.get(issuanceKey)
    if (!knownIssuance && options.exportPolicy !== 'forbid' && exportProjection &&
      this.#exportsByRef.size >= this.#maxExportBindings) {
      await this.#disposeRegistration(registration, false)
      throw portableError('export_capacity_exceeded')
    }

    let claim: ResourceClaim
    try {
      claim = this.#claimResource(resourceId, ownership)
    } catch (error) {
      await this.#disposeRegistration(registration, false)
      throw error
    }
    if (knownIssuance) {
      return await this.#reuseMaterialization({
        caller: rawCaller,
        principal,
        registration,
        issuance: knownIssuance,
        signal: options.signal
      })
    }

    let issuedRef: string | undefined
    let issued: IssuedPortableResource
    try {
      issued = this.#broker.issueResource(rawCaller, toBrokerRegistration({
        registration,
        resourceId,
        principal,
        currentPrincipal: this.#currentPrincipal,
        onDispose: async () => {
          if (issuedRef) this.#releaseClaim(resourceId, issuanceKey, issuedRef)
        }
      }), invocationBinding)
    } catch (error) {
      if (claim.references.size === 0) this.#resourceClaims.delete(resourceId)
      await this.#disposeRegistration(registration, false)
      if (error instanceof PortableResourceReferenceError) throw error
      throw portableError('invalid_resolution')
    }
    // Every operation after the atomic Broker issuance is an in-memory commit
    // using values already validated above; no provider callback or parser runs.
    issuedRef = issued.resourceRef
    this.#issuanceClaims.set(issuanceKey, Object.freeze({
      resourceId,
      resourceRef: issued.resourceRef
    }))
    claim.references.add(issued.resourceRef)
    this.#recordLease(issued.resourceRef, principal, issued.retire)
    if (options.exportPolicy !== 'forbid' && exportProjection) {
      this.#exportsByRef.set(
        issued.resourceRef,
        exportBinding(envelope, ownedCodec, exportProjection, principal)
      )
    }
    return Object.freeze({
      resource: issued.resource,
      resourceRef: issued.resourceRef,
      resourceKind: ownedCodec.codec.resourceKind
    })
  }

  /** Host-private export path; consumer identity is trusted composition data. */
  async exportForOwner(
    rawOwner: DomainRuntimeContributionOwner,
    rawCaller: CapabilityCallerContextInput,
    input: Readonly<{ resourceRef: string }>,
    options: Readonly<{ signal?: AbortSignal }> = {}
  ): Promise<PortableResourceReferenceEnvelope> {
    this.#requireAccepting('unauthorized_export')
    throwIfCancelled(options.signal)
    const owner = portableResourceExportConsumerOwnerSchema.parse(rawOwner)
    const caller = rawCaller
    const principal = requireCurrentPrincipal(this.#currentPrincipal)
    assertInvocationPrincipal(rawCaller, principal)
    const assertCurrentPrincipal = principalLeaseAssertion(
      principal,
      this.#currentPrincipal,
      options.signal
    )
    let resourceRef: string
    try {
      resourceRef = capabilityResourceBindRequestSchema.parse(input).resourceRef
      this.#broker.describeResourceRef(caller, resourceRef)
    } catch {
      throw portableError('unauthorized_export')
    }
    const binding = this.#exportsByRef.get(resourceRef)
    if (!binding ||
      !samePrincipalSnapshot(binding.principal, principal) ||
      !binding.projection.consumerModuleIds.includes(owner.moduleId)) {
      throw portableError('unauthorized_export')
    }
    this.#assertExportLive(caller, resourceRef, binding, principal)

    try {
      assertCurrentPrincipal()
      const projected = await binding.projection.project({
        consumer: owner,
        audience: caller.audience,
        principal,
        assertPrincipalCurrent: assertCurrentPrincipal,
        ...(options.signal ? { signal: options.signal } : {})
      })
      assertCurrentPrincipal()
      throwIfCancelled(options.signal)
      this.#assertExportLive(caller, resourceRef, binding, principal)
      const identity = await binding.codec.codec.projectExport(projected)
      throwIfCancelled(options.signal)
      this.#assertExportLive(caller, resourceRef, binding, principal)
      const encoded = validatePortableIdentity(
        binding.codec.codec.encodeIdentity(identity)
      )
      // Generic JSON validity is insufficient: the pinned codec must accept
      // the exported identity and reproduce it canonically for materialization.
      decodeCanonicalIdentity(binding.codec.codec, encoded)
      return parsePortableResourceReference({
        contractVersion: PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
        kind: binding.codec.codec.kind,
        authority: binding.authority,
        identity: encoded
      })
    } catch (error) {
      throwIfCancelled(options.signal)
      if (error instanceof PortableResourceReferenceError &&
        (error.code === 'principal_changed' ||
          error.code === 'unauthorized_export')) {
        throw error
      }
      throw portableError('invalid_export_projection')
    }
  }

  /**
   * The only surface given to a domain package. Caller and Principal come
   * from the Broker's active invocation and cannot be supplied by domain code.
   */
  forOwner(owner: DomainRuntimeContributionOwner): DomainMainPortableResourceReferencesHost {
    const consumer = portableResourceExportConsumerOwnerSchema.parse(owner)
    return Object.freeze({
      materialize: async (reference, options) => {
        const invocation = this.#requireInvocation()
        return await this.materialize(reference, invocation.caller, options)
      },
      discard: async (input) => {
        const invocation = this.#requireInvocation()
        await this.discard(invocation.caller, input)
      },
      export: async (input, options) => {
        const invocation = this.#requireInvocation()
        return await this.exportForOwner(consumer, invocation.caller, input, options)
      }
    })
  }

  #requireInvocation(): ActiveCapabilityInvocation {
    const invocation = this.#broker.currentInvocation()
    if (!invocation) throw portableError('unauthorized_export')
    return invocation
  }

  /** Retires one process-local materialization in the exact active execution. */
  async discard(
    rawCaller: CapabilityCallerContextInput,
    input: Readonly<{ resourceRef: string }>
  ): Promise<void> {
    this.#requireAccepting('resolution_rejected')
    const principal = requireCurrentPrincipal(this.#currentPrincipal)
    assertInvocationPrincipal(rawCaller, principal)
    const resourceRef = capabilityResourceBindRequestSchema.parse(input).resourceRef
    try {
      this.#broker.describeResourceRef(rawCaller, resourceRef)
    } catch {
      throw portableError('resolution_rejected')
    }
    assertCurrentPrincipalLease(principal, this.#currentPrincipal)
    await this.#retireRef(resourceRef)
  }

  #requireProcessLocalInvocationBinding(
    rawCaller: CapabilityCallerContextInput
  ): CapabilityResourceInvocationBinding {
    const invocation = this.#broker.currentInvocation()
    const caller = rawCaller as CapabilityCallerContext
    if (
      !invocation || invocation.caller !== rawCaller || caller.audience !== 'system' ||
      !isCanonicalDigest(caller.executionContextDigest)
    ) {
      throw portableError('resolution_rejected')
    }
    return Object.freeze({
      callerId: caller.callerId,
      executionContextDigest: caller.executionContextDigest
    })
  }

  /**
   * Retires resources issued under any Principal other than the supplied live
   * lease. Application composition calls this on every Principal notification.
   */
  async revokeStalePrincipals(
    current: PrincipalSnapshot | undefined
  ): Promise<void> {
    const refs = [...this.#leasesByRef.entries()]
      .filter(([, lease]) =>
        lease.retiring || !samePrincipalSnapshot(lease.principal, current)
      )
      .map(([resourceRef]) => resourceRef)
    await this.#retireRefs(refs)
  }

  /** Stops new work and retires every Host-owned portable Broker resource. */
  async dispose(): Promise<void> {
    this.#accepting = false
    await this.#retireRefs([...this.#leasesByRef.keys()])
  }

  async #reuseMaterialization(input: Readonly<{
    caller: CapabilityCallerContextInput
    principal: PrincipalSnapshot
    registration: PortableResourceLocalRegistration
    issuance: IssuanceClaim
    signal?: AbortSignal
  }>): Promise<PortableResourceMaterializedReference> {
    const lease = this.#leasesByRef.get(input.issuance.resourceRef)
    if (!lease || lease.retiring) {
      await this.#disposeRegistration(input.registration, false)
      throw portableError('invalid_resolution')
    }
    try {
      this.#broker.describeResourceRef(input.caller, input.issuance.resourceRef)
    } catch {
      this.#releaseClaim(
        input.issuance.resourceId,
        this.#issuanceKeyForRef(input.issuance.resourceRef),
        input.issuance.resourceRef
      )
      await this.#disposeRegistration(input.registration, false)
      throw portableError('invalid_resolution')
    }
    await this.#disposeRegistration(input.registration, true)
    throwIfCancelled(input.signal)
    assertCurrentPrincipalLease(input.principal, this.#currentPrincipal)
    this.#requireAccepting('resolution_rejected')
    try {
      this.#broker.describeResourceRef(input.caller, input.issuance.resourceRef)
    } catch {
      throw portableError('invalid_resolution')
    }
    let resource: CapabilityResourceHandle
    try {
      resource = this.#broker.bindResourceRef(
        input.caller,
        input.issuance.resourceRef
      )
    } catch {
      throw portableError('invalid_resolution')
    }
    this.#recordLease(
      input.issuance.resourceRef,
      input.principal,
      lease.retire
    )
    return Object.freeze({
      resource,
      resourceRef: input.issuance.resourceRef,
      resourceKind: input.registration.resourceKind
    })
  }

  #assertExportLive(
    caller: CapabilityCallerContextInput,
    resourceRef: string,
    binding: ExportBinding,
    principal: PrincipalSnapshot
  ): void {
    this.#requireAccepting('unauthorized_export')
    assertCurrentPrincipalLease(principal, this.#currentPrincipal)
    const lease = this.#leasesByRef.get(resourceRef)
    if (!lease || lease.retiring) throw portableError('unauthorized_export')
    if (this.#exportsByRef.get(resourceRef) !== binding) {
      throw portableError('unauthorized_export')
    }
    try {
      this.#broker.describeResourceRef(caller, resourceRef)
    } catch {
      throw portableError('unauthorized_export')
    }
  }

  #recordLease(
    resourceRef: string,
    principal: PrincipalSnapshot,
    retire: ResourceLease['retire']
  ): void {
    const existing = this.#leasesByRef.get(resourceRef)
    const lease = existing ?? { principal, retire, retiring: false }
    lease.principal = principal
    lease.retire = retire
    lease.retiring = false
    this.#leasesByRef.set(resourceRef, lease)
  }

  async #retireRefs(resourceRefs: readonly string[]): Promise<void> {
    const settled = await Promise.allSettled(
      resourceRefs.map((resourceRef) => this.#retireRef(resourceRef))
    )
    const errors = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Portable resource cleanup was incomplete.')
    }
  }

  async #retireRef(resourceRef: string): Promise<void> {
    const lease = this.#leasesByRef.get(resourceRef)
    if (!lease) return
    if (lease.retirement) return await lease.retirement
    lease.retiring = true
    const retirement = Promise.resolve()
      .then(() => lease.retire({ deferWhileRetained: false }))
      .catch((error) => {
        if (this.#leasesByRef.get(resourceRef) === lease) {
          lease.retirement = undefined
        }
        throw error
      })
    lease.retirement = retirement
    await retirement
  }

  async #disposeRegistration(
    registration: PortableResourceLocalRegistration,
    required: boolean
  ): Promise<void> {
    try {
      await registration.dispose?.()
    } catch (error) {
      this.#reportCleanupError(error)
      if (required) throw portableError('resolution_rejected')
    }
  }

  #claimResource(resourceId: string, ownership: string): ResourceClaim {
    const existing = this.#resourceClaims.get(resourceId)
    if (existing) {
      if (existing.ownership !== ownership) throw portableError('invalid_resolution')
      return existing
    }
    const claim: ResourceClaim = { ownership, references: new Set() }
    this.#resourceClaims.set(resourceId, claim)
    return claim
  }

  #releaseClaim(resourceId: string, issuanceKey: string, resourceRef: string): void {
    this.#leasesByRef.delete(resourceRef)
    this.#exportsByRef.delete(resourceRef)
    const issuance = this.#issuanceClaims.get(issuanceKey)
    if (issuance?.resourceRef === resourceRef) this.#issuanceClaims.delete(issuanceKey)
    const claim = this.#resourceClaims.get(resourceId)
    if (!claim) return
    claim.references.delete(resourceRef)
    if (claim.references.size === 0) this.#resourceClaims.delete(resourceId)
  }

  #issuanceKeyForRef(resourceRef: string): string {
    for (const [key, claim] of this.#issuanceClaims) {
      if (claim.resourceRef === resourceRef) return key
    }
    return ''
  }

  #requireAccepting(code: 'resolution_rejected' | 'unauthorized_export'): void {
    if (!this.#accepting) throw portableError(code)
  }
}

export function createPortableResourceReferenceService(
  broker: CapabilityBroker,
  contributions: DomainMainContributionHost,
  currentPrincipal: () => PrincipalSnapshot | undefined,
  options: Readonly<{
    maxExportBindings?: number
    reportCleanupError?: (error: unknown) => void
  }> = {}
): PortableResourceReferenceService {
  const registries = composePortableResourceReferenceRegistries(contributions)
  return new PortableResourceReferenceService({
    broker,
    ...registries,
    currentPrincipal,
    ...(options.maxExportBindings === undefined
      ? {}
      : { maxExportBindings: options.maxExportBindings }),
    ...(options.reportCleanupError === undefined
      ? {}
      : { reportCleanupError: options.reportCleanupError })
  })
}

function parseOwner(contribution: DomainMainContribution): PortableCompositionOwner {
  try {
    return Object.freeze({
      packageName: domainPackageNameSchema.parse(contribution.packageName),
      moduleId: domainPackageModuleIdSchema.parse(contribution.owner.moduleId),
      moduleVersion: domainPackageVersionSchema.parse(contribution.owner.moduleVersion),
      contributionId: domainPackageContributionIdSchema.parse(contribution.id)
    })
  } catch {
    throw portableError('invalid_resolution')
  }
}

function freezeOwner(owner: PortableCompositionOwner): PortableCompositionOwner {
  try {
    return Object.freeze({
      packageName: domainPackageNameSchema.parse(owner.packageName),
      moduleId: domainPackageModuleIdSchema.parse(owner.moduleId),
      moduleVersion: domainPackageVersionSchema.parse(owner.moduleVersion),
      contributionId: domainPackageContributionIdSchema.parse(owner.contributionId)
    })
  } catch {
    throw portableError('invalid_resolution')
  }
}

function snapshotOwnedCodec(
  owned: OwnedPortableResourceCodec
): OwnedPortableResourceCodec {
  if (!isPortableResourceReferenceCodec(owned.codec)) {
    throw portableError('invalid_resolution')
  }
  return Object.freeze({
    owner: freezeOwner(owned.owner),
    codec: Object.freeze({
      location: owned.codec.location,
      contractVersion: owned.codec.contractVersion,
      kind: owned.codec.kind,
      resourceKind: owned.codec.resourceKind,
      resolverId: owned.codec.resolverId,
      decodeIdentity: owned.codec.decodeIdentity,
      encodeIdentity: owned.codec.encodeIdentity,
      projectExport: owned.codec.projectExport
    })
  })
}

function snapshotOwnedResolver(
  owned: OwnedPortableAuthorityResolver
): OwnedPortableAuthorityResolver {
  if (!isPortableResourceAuthorityResolver(owned.resolver)) {
    throw portableError('invalid_resolution')
  }
  return Object.freeze({
    owner: freezeOwner(owned.owner),
    resolver: Object.freeze({
      location: owned.resolver.location,
      contractVersion: owned.resolver.contractVersion,
      id: owned.resolver.id,
      kinds: Object.freeze([...owned.resolver.kinds]),
      lookupAuthority: owned.resolver.lookupAuthority,
      resolve: owned.resolver.resolve
    })
  })
}

function recordLocation(value: unknown): unknown {
  return isRecord(value) ? value.location : undefined
}

function isPortableLocation(value: unknown): boolean {
  return value === MAIN_PORTABLE_RESOURCE_CODEC_LOCATION ||
    value === MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION
}

function decodeCanonicalIdentity(
  codec: PortableResourceReferenceCodec,
  encoded: PortableResourceReferenceEnvelope['identity']
): unknown {
  try {
    const identity = codec.decodeIdentity(encoded)
    const recoded = validatePortableIdentity(codec.encodeIdentity(identity))
    if (canonicalPortableResourceIdentity(recoded) !==
      canonicalPortableResourceIdentity(encoded)) {
      throw new Error('Codec identity is not canonical.')
    }
    return identity
  } catch {
    throw portableError('malformed_identity')
  }
}

function lookupExactAuthority(
  resolver: PortableResourceAuthorityResolver,
  reference: string,
  kind: string
): TrustedPortableResourceAuthority {
  let raw: unknown
  try {
    raw = resolver.lookupAuthority({ reference, kind })
  } catch {
    throw portableError('unknown_authority')
  }
  if (isThenable(raw) ||
    !isRecord(raw) ||
    Object.keys(raw).some((key) =>
      key !== 'reference' && key !== 'resolverId' &&
      key !== 'kind' && key !== 'context'
    ) ||
    raw.reference !== reference ||
    raw.resolverId !== resolver.id ||
    raw.kind !== kind) {
    throw portableError('unknown_authority')
  }
  validatePortableAuthorityReference(raw.reference)
  validatePortableKind(raw.resolverId)
  validatePortableKind(raw.kind)
  return Object.freeze({
    reference: raw.reference,
    resolverId: raw.resolverId,
    kind: raw.kind,
    ...(Object.hasOwn(raw, 'context') ? { context: raw.context } : {})
  })
}

function validateResolution(
  raw: unknown,
  expectedResourceKind: string
): Readonly<{
  registration: PortableResourceLocalRegistration
  exportProjection?: PortableResourceExportProjection
}> {
  if (!hasOnlyKeys(raw, ['registration'], ['exportProjection']) ||
    !isRecord(raw.registration)) {
    throw portableError('invalid_resolution')
  }
  const registration = validateRegistration(raw.registration, expectedResourceKind)
  if (raw.exportProjection === undefined) return Object.freeze({ registration })
  if (!isPortableResourceExportProjection(raw.exportProjection)) {
    throw portableError('invalid_resolution')
  }
  return Object.freeze({
    registration,
    exportProjection: Object.freeze({
      consumerModuleIds: Object.freeze([
        ...raw.exportProjection.consumerModuleIds
      ]),
      project: raw.exportProjection.project
    })
  })
}

function validateRegistration(
  raw: Record<string, unknown>,
  expectedResourceKind: string
): PortableResourceLocalRegistration {
  if (!hasOnlyKeys(raw, ['resourceKind', 'semanticRevision', 'observe'], [
    'workspaceId',
    'audiences',
    'layoutRevision',
    'dispose',
    'contentTransport',
    'expiresInMs'
  ]) ||
    raw.resourceKind !== expectedResourceKind ||
    typeof raw.observe !== 'function') {
    throw portableError('invalid_resolution')
  }
  const semanticRevision = boundedTrimmed(raw.semanticRevision, 256)
  const workspaceId = raw.workspaceId === undefined
    ? undefined
    : boundedTrimmed(raw.workspaceId, 4_096)
  const layoutRevision = raw.layoutRevision === undefined
    ? undefined
    : boundedTrimmed(raw.layoutRevision, 256)
  const audiences = raw.audiences === undefined
    ? undefined
    : validateAudiences(raw.audiences)
  if (raw.dispose !== undefined && typeof raw.dispose !== 'function') {
    throw portableError('invalid_resolution')
  }
  const contentTransport = raw.contentTransport === undefined
    ? undefined
    : validateContentTransport(raw.contentTransport)
  const expiresInMs = raw.expiresInMs === undefined
    ? undefined
    : validateExpiresInMs(raw.expiresInMs)
  return Object.freeze({
    resourceKind: expectedResourceKind,
    ...(workspaceId ? { workspaceId } : {}),
    ...(audiences ? { audiences } : {}),
    semanticRevision,
    ...(layoutRevision ? { layoutRevision } : {}),
    observe: raw.observe as PortableResourceLocalRegistration['observe'],
    ...(raw.dispose
      ? { dispose: raw.dispose as NonNullable<PortableResourceLocalRegistration['dispose']> }
      : {}),
    ...(contentTransport ? { contentTransport } : {}),
    ...(expiresInMs === undefined ? {} : { expiresInMs })
  })
}

function toBrokerRegistration(input: Readonly<{
  registration: PortableResourceLocalRegistration
  resourceId: string
  principal: PrincipalSnapshot
  currentPrincipal: () => PrincipalSnapshot | undefined
  onDispose: () => Promise<void>
}>): CapabilityResourceRegistration {
  const { registration, resourceId, principal, currentPrincipal, onDispose } = input
  return {
    resourceId,
    resourceKind: registration.resourceKind,
    ...(registration.workspaceId ? { workspaceId: registration.workspaceId } : {}),
    ...(registration.audiences ? { audiences: [...registration.audiences] } : {}),
    semanticRevision: registration.semanticRevision,
    ...(registration.layoutRevision ? { layoutRevision: registration.layoutRevision } : {}),
    observe: async (caller, context) => {
      const assertCurrentPrincipal = principalLeaseAssertion(
        principal,
        currentPrincipal,
        context.signal
      )
      assertCurrentPrincipal()
      const observed = await registration.observe({
        audience: caller.audience,
        principal,
        assertPrincipalCurrent: assertCurrentPrincipal,
        ...(context.signal ? { signal: context.signal } : {})
      })
      assertCurrentPrincipal()
      return {
        state: observed.state,
        semanticRevision: observed.semanticRevision,
        ...(observed.layoutRevision ? { layoutRevision: observed.layoutRevision } : {}),
        ...(observed.operationIds ? { operationIds: [...observed.operationIds] } : {})
      }
    },
    dispose: async () => {
      await registration.dispose?.()
      await onDispose()
    },
    retireAfterLastHandleExpires: true,
    ...(registration.contentTransport
      ? { contentTransport: registration.contentTransport }
      : {}),
    ...(registration.expiresInMs === undefined
      ? {}
      : { expiresInMs: registration.expiresInMs })
  }
}

function canonicalOwnership(
  owned: OwnedPortableResourceCodec,
  envelope: PortableResourceReferenceEnvelope,
  principal: PrincipalSnapshot
): string {
  return JSON.stringify({
    codecOwner: owned.owner,
    envelope: serializePortableResourceReference(envelope),
    principal: [
      principal.authority,
      principal.subject,
      principal.assurance,
      principal.deviceId,
      principal.identityVersion
    ]
  })
}

function exportBinding(
  envelope: PortableResourceReferenceEnvelope,
  codec: OwnedPortableResourceCodec,
  projection: PortableResourceExportProjection,
  principal: PrincipalSnapshot
): ExportBinding {
  return Object.freeze({
    authority: envelope.authority,
    codec,
    projection,
    principal
  })
}

function publicCaller(
  raw: CapabilityCallerContextInput | CapabilityCallerContext
): CapabilityCallerContextInput {
  return capabilityCallerContextSchema.parse({
    audience: raw.audience,
    callerId: raw.callerId,
    ...(raw.workspaceId ? { workspaceId: raw.workspaceId } : {}),
    ...(raw.workspaceLocator ? { workspaceLocator: raw.workspaceLocator } : {}),
    ...(raw.approvals?.length ? { approvals: [...raw.approvals] } : {})
  })
}

function assertInvocationPrincipal(
  caller: CapabilityCallerContextInput | CapabilityCallerContext,
  principal: PrincipalSnapshot
): void {
  const asserted = (caller as CapabilityCallerContext & {
    principal?: PrincipalSnapshot
  }).principal
  if (asserted !== undefined && !samePrincipalSnapshot(asserted, principal)) {
    throw portableError('principal_changed')
  }
}

function readCurrentPrincipal(
  currentPrincipal: () => PrincipalSnapshot | undefined,
  failureCode: 'principal_unavailable' | 'principal_changed'
): PrincipalSnapshot | undefined {
  try {
    const value = currentPrincipal()
    return value === undefined ? undefined : definePrincipalSnapshot(value)
  } catch {
    throw portableError(failureCode)
  }
}

function requireCurrentPrincipal(
  currentPrincipal: () => PrincipalSnapshot | undefined
): PrincipalSnapshot {
  const principal = readCurrentPrincipal(currentPrincipal, 'principal_unavailable')
  if (principal === undefined) throw portableError('principal_unavailable')
  return principal
}

function assertCurrentPrincipalLease(
  captured: PrincipalSnapshot,
  currentPrincipal: () => PrincipalSnapshot | undefined
): void {
  const live = readCurrentPrincipal(currentPrincipal, 'principal_changed')
  if (!samePrincipalSnapshot(captured, live)) throw portableError('principal_changed')
}

function principalLeaseAssertion(
  captured: PrincipalSnapshot,
  currentPrincipal: () => PrincipalSnapshot | undefined,
  signal?: AbortSignal
): () => void {
  return () => {
    throwIfCancelled(signal)
    assertCurrentPrincipalLease(captured, currentPrincipal)
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw portableError('operation_cancelled')
}

function boundedCapacity(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_EXPORT_BINDINGS
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw new TypeError('Portable export capacity must be a bounded positive integer.')
  }
  return value
}

function validateAudiences(value: unknown): readonly ('ui' | 'agent' | 'system')[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
    value.some((audience) =>
      audience !== 'ui' && audience !== 'agent' && audience !== 'system'
    ) ||
    new Set(value).size !== value.length) {
    throw portableError('invalid_resolution')
  }
  return Object.freeze([...value]) as readonly ('ui' | 'agent' | 'system')[]
}

function validateContentTransport(
  value: unknown
): NonNullable<PortableResourceLocalRegistration['contentTransport']> {
  if (!hasOnlyKeys(value, ['describeActionId', 'readRangeActionId'], [])) {
    throw portableError('invalid_resolution')
  }
  return Object.freeze({
    describeActionId: validatePortableKind(value.describeActionId),
    readRangeActionId: validatePortableKind(value.readRangeActionId)
  })
}

function validateExpiresInMs(value: unknown): number {
  if (!Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 86_400_000) {
    throw portableError('invalid_resolution')
  }
  return value as number
}

function boundedTrimmed(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 ||
    value.length > max || value !== value.trim()) {
    throw portableError('invalid_resolution')
  }
  return value
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isCanonicalDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function portableError(
  code: ConstructorParameters<typeof PortableResourceReferenceError>[0]
): PortableResourceReferenceError {
  const messages: Record<
    ConstructorParameters<typeof PortableResourceReferenceError>[0],
    string
  > = {
    invalid_envelope: 'Portable resource reference envelope is invalid.',
    envelope_too_large: 'Portable resource reference envelope exceeds its bound.',
    unsupported_version: 'Portable resource reference version is unsupported.',
    unknown_kind: 'Portable resource reference kind is not registered.',
    malformed_identity: 'Portable resource reference identity is invalid.',
    unknown_authority: 'Portable resource reference authority is not trusted locally.',
    unknown_resolver: 'Portable resource authority resolver is not registered.',
    incompatible_resolver: 'Portable resource authority resolver is incompatible.',
    duplicate_codec: 'Portable resource reference codec ownership conflicts.',
    duplicate_resolver: 'Portable resource authority resolver ownership conflicts.',
    principal_unavailable: 'A current Host principal is required.',
    principal_changed: 'The Host principal changed during portable processing.',
    operation_cancelled: 'Portable resource processing was cancelled.',
    resolution_rejected: 'Portable resource reauthorization was rejected.',
    invalid_resolution: 'Portable resource resolver returned an invalid result.',
    unauthorized_export: 'Portable resource export is not authorized.',
    export_capacity_exceeded: 'Portable resource export capacity is exhausted.',
    invalid_export_projection: 'Portable resource export projection is invalid.'
  }
  return new PortableResourceReferenceError(code, messages[code])
}

function hasOnlyKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
