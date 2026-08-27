import { z } from 'zod'

import {
  domainPackageModuleIdSchema,
  domainPackageVersionSchema,
  type DomainPackageJsonValue
} from './contract.js'
import type { PrincipalSnapshot } from './principal.js'

export const PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION = 1 as const
export const PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION = '1.0.0' as const

export const PORTABLE_RESOURCE_REFERENCE_MAX_SERIALIZED_BYTES = 8_192
export const PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_BYTES = 6_144
export const PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_DEPTH = 8
export const PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_NODES = 256
export const PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE = 64
export const PORTABLE_RESOURCE_REFERENCE_MAX_STRING_BYTES = 1_024

export const MAIN_PORTABLE_RESOURCE_CODEC_LOCATION =
  'main.portable-resource-codec' as const
export const MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION =
  'main.portable-authority-resolver' as const

const namespacedIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u
const authorityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/u
const dangerousPrototypeKeyPattern = /^(?:__proto__|constructor|prototype)$/iu
const forbiddenPortableKey = /(?:url|uri|endpoint|origin|host|hostname|credential|secret|token|password|passphrase|apikey|authorization|cookie|connection|connectionid|providerconnection|providerdto|dto|display|displayname|mime|mimetype|path|filepath|pathname|name)$/iu
const runtimeHandlePattern = /^(?:(?:res|cap)_[A-Za-z0-9_-]{3,}|(?:xfer|portal)_[A-Za-z0-9_-]{32})$/u
const localConnectionPattern = /^(?:conn|connection)_[A-Za-z0-9_-]{3,}$/iu
const uriPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const networkTargetPattern = /^(?:localhost|\[?(?:::1|[Ff][Ee]80:)|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?\]?$/u

export const portableResourceKindSchema = z.string()
  .trim()
  .min(3)
  .max(128)
  .regex(namespacedIdPattern, 'Use a bounded namespaced lowercase portable resource ID.')

export const portableResourceAuthorityReferenceSchema = z.string()
  .min(3)
  .max(256)
  .regex(authorityPattern, 'Use a bounded opaque portable authority reference.')
  .refine((value) => value === value.trim() && !isForbiddenString(value), {
    message: 'Portable authority references cannot contain local access or network targets.'
  })

export const portableResourceCodecContributionContractSchema = z.object({
  location: z.literal(MAIN_PORTABLE_RESOURCE_CODEC_LOCATION),
  contractVersion: z.literal(PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION),
  kind: portableResourceKindSchema,
  resourceKind: portableResourceKindSchema,
  resolverId: portableResourceKindSchema
}).strict().readonly()

export const portableResourceAuthorityResolverContributionContractSchema = z.object({
  location: z.literal(MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION),
  contractVersion: z.literal(PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION),
  resolverId: portableResourceKindSchema,
  kinds: z.array(portableResourceKindSchema).min(1).max(64)
}).strict().superRefine((contract, context) => {
  if (new Set(contract.kinds).size !== contract.kinds.length) {
    context.addIssue({
      code: 'custom',
      path: ['kinds'],
      message: 'Portable resolver kinds must be unique.'
    })
  }
  const canonicalKinds = [...contract.kinds].sort()
  if (canonicalKinds.some((kind, index) => kind !== contract.kinds[index])) {
    context.addIssue({
      code: 'custom',
      path: ['kinds'],
      message: 'Portable resolver kinds must use canonical sort order.'
    })
  }
}).readonly()

export const portableResourceExportConsumerOwnerSchema = z.object({
  moduleId: domainPackageModuleIdSchema,
  moduleVersion: domainPackageVersionSchema
}).strict().readonly()

export type PortableResourceCodecContributionContract = z.infer<
  typeof portableResourceCodecContributionContractSchema
>
export type PortableResourceAuthorityResolverContributionContract = Readonly<{
  location: typeof MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION
  contractVersion: typeof PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION
  resolverId: string
  kinds: readonly string[]
}>
export type PortableResourceExportConsumerOwner = z.infer<
  typeof portableResourceExportConsumerOwnerSchema
>

export type PortableResourceReferenceErrorCode =
  | 'invalid_envelope'
  | 'envelope_too_large'
  | 'unsupported_version'
  | 'unknown_kind'
  | 'malformed_identity'
  | 'unknown_authority'
  | 'unknown_resolver'
  | 'incompatible_resolver'
  | 'duplicate_codec'
  | 'duplicate_resolver'
  | 'principal_unavailable'
  | 'principal_changed'
  | 'operation_cancelled'
  | 'resolution_rejected'
  | 'invalid_resolution'
  | 'unauthorized_export'
  | 'export_capacity_exceeded'
  | 'invalid_export_projection'

/** Deliberately bounded, closed error surface safe for cross-context callers. */
export class PortableResourceReferenceError extends Error {
  readonly code: PortableResourceReferenceErrorCode

  constructor(code: PortableResourceReferenceErrorCode, message: string) {
    super(message.slice(0, 256))
    this.name = 'PortableResourceReferenceError'
    this.code = code
  }
}

export type PortableResourceIdentityValue =
  | null
  | boolean
  | number
  | string
  | readonly PortableResourceIdentityValue[]
  | Readonly<{ [key: string]: PortableResourceIdentityValue }>

export type PortableResourceIdentity = Readonly<{
  [key: string]: PortableResourceIdentityValue
}>

export type PortableResourceReferenceEnvelope = Readonly<{
  contractVersion: typeof PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION
  kind: string
  authority: string
  identity: PortableResourceIdentity
}>

export type PortableResourceMaterializedReference = Readonly<{
  resource: Readonly<{
    token: string
    semanticRevision: string
    expiresAt: string
  }>
  resourceRef: string
  resourceKind: string
}>

export type PortableResourceMaterializationOptions = Readonly<{
  signal?: AbortSignal
  /**
   * `forbid` creates a process-local resource with no portable export binding.
   * This is required for execution-scoped system work whose durable envelope
   * is a locator only, never reusable authority.
   */
  exportPolicy?: 'allow' | 'forbid'
}>

/**
 * A Host-created package-scoped facade. Export infers its trusted consumer
 * owner from composition; callers cannot supply or impersonate a consumer ID.
 */
export type DomainMainPortableResourceReferencesHost = Readonly<{
  materialize(
    reference: string | PortableResourceReferenceEnvelope,
    options?: PortableResourceMaterializationOptions
  ): Promise<PortableResourceMaterializedReference>
  /** Immediately retires one resource in the exact active invocation scope. */
  discard(input: Readonly<{ resourceRef: string }>): Promise<void>
  export(
    input: Readonly<{ resourceRef: string }>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<PortableResourceReferenceEnvelope>
}>

export type PortableResourceReferenceCodec<Identity = unknown, ExportProjection = unknown> =
  Readonly<{
    location: typeof MAIN_PORTABLE_RESOURCE_CODEC_LOCATION
    contractVersion: typeof PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION
    kind: string
    resourceKind: string
    /** Exact resolver selection; materialization must never scan resolver claims. */
    resolverId: string
    decodeIdentity(identity: PortableResourceIdentity): Identity
    encodeIdentity(identity: Identity): PortableResourceIdentity
    projectExport(projection: ExportProjection): Identity | Promise<Identity>
  }>

export type PortableResourceAudience = 'ui' | 'agent' | 'system'

export type PortableResourceObservation = Readonly<{
  state: DomainPackageJsonValue
  semanticRevision: string
  layoutRevision?: string
  operationIds?: readonly string[]
}>

export type PortableResourceUseContext = Readonly<{
  /** Host-current Principal; never accepted from renderer, Agent, or domain input. */
  principal: PrincipalSnapshot
  /** Revalidates the Host-owned Principal lease at an async trust boundary. */
  assertPrincipalCurrent: () => void | Promise<void>
  signal?: AbortSignal
}>

/** Provider-owned registration consumed only by the canonical Host Broker issuer. */
export type PortableResourceLocalRegistration = Readonly<{
  resourceKind: string
  workspaceId?: string
  audiences?: readonly PortableResourceAudience[]
  semanticRevision: string
  layoutRevision?: string
  /** Must reauthorize and observe under the Host-current Principal on every call. */
  observe(context: PortableResourceUseContext):
    PortableResourceObservation | Promise<PortableResourceObservation>
  dispose?: () => void | Promise<void>
  contentTransport?: Readonly<{
    describeActionId: string
    readRangeActionId: string
  }>
  expiresInMs?: number
}>

export type PortableResourceExportContext = PortableResourceUseContext & Readonly<{
  /** Host-injected installed package owner; it is never caller-provided text. */
  consumer: PortableResourceExportConsumerOwner
}>

export type PortableResourceExportProjection = Readonly<{
  /** Module IDs eligible for the owner-bound Host export facade. */
  consumerModuleIds: readonly string[]
  /** A provider-owned strict projection; it never receives generic Broker raw state. */
  project(context: PortableResourceExportContext): unknown | Promise<unknown>
}>

export type PortableResourceResolution = Readonly<{
  registration: PortableResourceLocalRegistration
  exportProjection?: PortableResourceExportProjection
}>

export type TrustedPortableResourceAuthority<Context = unknown> = Readonly<{
  reference: string
  resolverId: string
  kind: string
  context?: Context
}>

export type PortableResourceAuthorityLookupInput = Readonly<{
  reference: string
  kind: string
}>

/**
 * A resolver is selected exactly through codec.resolverId before this local
 * lookup. Its synchronous lookup must consult trusted local state only.
 */
export type PortableResourceAuthorityResolver<AuthorityContext = unknown> = Readonly<{
  location: typeof MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION
  contractVersion: typeof PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION
  id: string
  kinds: readonly string[]
  lookupAuthority(input: PortableResourceAuthorityLookupInput):
    TrustedPortableResourceAuthority<AuthorityContext> | undefined
  resolve(input: Readonly<{
    envelope: PortableResourceReferenceEnvelope
    identity: unknown
    resourceKind: string
    authority: TrustedPortableResourceAuthority<AuthorityContext>
    principal: PrincipalSnapshot
    /** Host-owned lease assertion; domain code may invoke but never supply it. */
    assertPrincipalCurrent: () => void | Promise<void>
    signal?: AbortSignal
  }>): PortableResourceResolution | Promise<PortableResourceResolution>
}>

export function definePortableResourceCodecContributionContract(
  input: PortableResourceCodecContributionContract
): PortableResourceCodecContributionContract {
  return portableResourceCodecContributionContractSchema.parse(input)
}

export function definePortableResourceAuthorityResolverContributionContract(
  input: PortableResourceAuthorityResolverContributionContract
): PortableResourceAuthorityResolverContributionContract {
  const parsed = portableResourceAuthorityResolverContributionContractSchema.parse(input)
  return Object.freeze({ ...parsed, kinds: Object.freeze([...parsed.kinds]) })
}

export function parsePortableResourceReference(
  input: string | unknown
): PortableResourceReferenceEnvelope {
  try {
    const serializedInput = typeof input === 'string' ? input : undefined
    const raw = parseBoundedInput(input)
    const envelope = validateEnvelopeShape(raw)
    if (envelope.contractVersion !== PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION) {
      throw portableError('unsupported_version')
    }
    if (serializedInput !== undefined && serializedInput !== encodeCanonical(envelope)) {
      throw portableError('invalid_envelope')
    }
    return envelope as PortableResourceReferenceEnvelope
  } catch (error) {
    if (error instanceof PortableResourceReferenceError) throw error
    throw portableError('invalid_envelope')
  }
}

export function serializePortableResourceReference(
  input: PortableResourceReferenceEnvelope | unknown
): string {
  return encodeCanonical(parsePortableResourceReference(input))
}

/** Canonicalizes only a fully validated portable identity, never arbitrary JSON. */
export function canonicalPortableResourceIdentity(input: unknown): string {
  return encodeCanonical(validatePortableIdentity(input))
}

export function isPortableResourceReferenceCodec(
  value: unknown
): value is PortableResourceReferenceCodec {
  if (!hasOnlyKeys(value, [
    'location',
    'contractVersion',
    'kind',
    'resourceKind',
    'resolverId',
    'decodeIdentity',
    'encodeIdentity',
    'projectExport'
  ])) return false
  return value.location === MAIN_PORTABLE_RESOURCE_CODEC_LOCATION &&
    value.contractVersion === PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION &&
    portableResourceKindSchema.safeParse(value.kind).success &&
    portableResourceKindSchema.safeParse(value.resourceKind).success &&
    portableResourceKindSchema.safeParse(value.resolverId).success &&
    typeof value.decodeIdentity === 'function' &&
    typeof value.encodeIdentity === 'function' &&
    typeof value.projectExport === 'function'
}

export function isPortableResourceAuthorityResolver(
  value: unknown
): value is PortableResourceAuthorityResolver {
  if (!hasOnlyKeys(value, [
    'location',
    'contractVersion',
    'id',
    'kinds',
    'lookupAuthority',
    'resolve'
  ])) return false
  const binding = portableResourceAuthorityResolverContributionContractSchema.safeParse({
    location: value.location,
    contractVersion: value.contractVersion,
    resolverId: value.id,
    kinds: value.kinds
  })
  return binding.success &&
    typeof value.lookupAuthority === 'function' &&
    typeof value.resolve === 'function'
}

export function portableResourceCodecMatchesContract(
  contract: unknown,
  codec: PortableResourceReferenceCodec
): contract is PortableResourceCodecContributionContract {
  const parsed = portableResourceCodecContributionContractSchema.safeParse(contract)
  return parsed.success &&
    parsed.data.location === codec.location &&
    parsed.data.contractVersion === codec.contractVersion &&
    parsed.data.kind === codec.kind &&
    parsed.data.resourceKind === codec.resourceKind &&
    parsed.data.resolverId === codec.resolverId
}

export function portableResourceAuthorityResolverMatchesContract(
  contract: unknown,
  resolver: PortableResourceAuthorityResolver
): contract is PortableResourceAuthorityResolverContributionContract {
  const parsed = portableResourceAuthorityResolverContributionContractSchema.safeParse(contract)
  return parsed.success &&
    parsed.data.location === resolver.location &&
    parsed.data.contractVersion === resolver.contractVersion &&
    parsed.data.resolverId === resolver.id &&
    parsed.data.kinds.length === resolver.kinds.length &&
    parsed.data.kinds.every((kind, index) => kind === resolver.kinds[index])
}

export function portableResourceCodecResolverBindingMatches(
  codec: PortableResourceReferenceCodec,
  resolver: PortableResourceAuthorityResolver
): boolean {
  return codec.resolverId === resolver.id && resolver.kinds.includes(codec.kind)
}

export function isPortableResourceExportProjection(
  value: unknown
): value is PortableResourceExportProjection {
  if (!hasOnlyKeys(value, ['consumerModuleIds', 'project']) ||
    !Array.isArray(value.consumerModuleIds) ||
    value.consumerModuleIds.length < 1 ||
    value.consumerModuleIds.length > 64 ||
    typeof value.project !== 'function') return false
  const moduleIds = value.consumerModuleIds
  if (!moduleIds.every((moduleId) => domainPackageModuleIdSchema.safeParse(moduleId).success) ||
    new Set(moduleIds).size !== moduleIds.length) return false
  const canonicalModuleIds = [...moduleIds].sort()
  return canonicalModuleIds.every((moduleId, index) => moduleId === moduleIds[index])
}

export function validatePortableIdentity(input: unknown): PortableResourceIdentity {
  try {
    validateBoundedIdentity(input)
    if (!isRecord(input) || Object.keys(input).length === 0) {
      throw portableError('malformed_identity')
    }
    return deepFreeze(cloneCanonical(input)) as PortableResourceIdentity
  } catch (error) {
    if (error instanceof PortableResourceReferenceError) throw error
    throw portableError('malformed_identity')
  }
}

export function validatePortableKind(input: unknown): string {
  const parsed = portableResourceKindSchema.safeParse(input)
  if (!parsed.success) throw portableError('invalid_envelope')
  return parsed.data
}

export function validatePortableAuthorityReference(input: unknown): string {
  const parsed = portableResourceAuthorityReferenceSchema.safeParse(input)
  if (!parsed.success) throw portableError('invalid_envelope')
  return parsed.data
}

function parseBoundedInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  if (utf8Length(input) > PORTABLE_RESOURCE_REFERENCE_MAX_SERIALIZED_BYTES) {
    throw portableError('envelope_too_large')
  }
  try {
    return JSON.parse(input)
  } catch {
    throw portableError('invalid_envelope')
  }
}

function validateEnvelopeShape(raw: unknown): Readonly<{
  contractVersion: number
  kind: string
  authority: string
  identity: PortableResourceIdentity
}> {
  if (!isRecord(raw) || Object.getPrototypeOf(raw) !== Object.prototype) {
    throw portableError('invalid_envelope')
  }
  const keys = Object.keys(raw).sort()
  if (keys.length !== 4 || keys.join(',') !== 'authority,contractVersion,identity,kind') {
    throw portableError('invalid_envelope')
  }
  if (!Number.isSafeInteger(raw.contractVersion) || (raw.contractVersion as number) < 1) {
    throw portableError('invalid_envelope')
  }
  const result = {
    contractVersion: raw.contractVersion as number,
    kind: validatePortableKind(raw.kind),
    authority: validatePortableAuthorityReference(raw.authority),
    identity: validatePortableIdentity(raw.identity)
  }
  if (utf8Length(encodeCanonical(result)) > PORTABLE_RESOURCE_REFERENCE_MAX_SERIALIZED_BYTES) {
    throw portableError('envelope_too_large')
  }
  return deepFreeze(result)
}

function validateBoundedIdentity(input: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
  const seen = new Set<object>()
  let nodes = 0
  let approximateBytes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_NODES ||
      current.depth > PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_DEPTH) {
      throw portableError('malformed_identity')
    }
    const value = current.value
    if (value === null || typeof value === 'boolean') {
      approximateBytes += 5
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw portableError('malformed_identity')
      approximateBytes += String(value).length
      continue
    }
    if (typeof value === 'string') {
      const bytes = utf8Length(value)
      if (bytes > PORTABLE_RESOURCE_REFERENCE_MAX_STRING_BYTES || isForbiddenString(value)) {
        throw portableError('malformed_identity')
      }
      approximateBytes += bytes + 2
      continue
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
      throw portableError('malformed_identity')
    }
    seen.add(value)
    if (Array.isArray(value)) {
      if (value.length > PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE) {
        throw portableError('malformed_identity')
      }
      approximateBytes += value.length + 2
      for (const nested of value) stack.push({ value: nested, depth: current.depth + 1 })
      continue
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw portableError('malformed_identity')
    }
    const entries = Object.entries(value)
    if (entries.length > PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE) {
      throw portableError('malformed_identity')
    }
    approximateBytes += entries.length + 2
    for (const [key, nested] of entries) {
      const normalizedKey = key.replace(/[^A-Za-z0-9]/gu, '')
      if (!key || key !== key.trim() || utf8Length(key) > 128 ||
        dangerousPrototypeKeyPattern.test(key) || forbiddenPortableKey.test(normalizedKey)) {
        throw portableError('malformed_identity')
      }
      approximateBytes += utf8Length(key) + 3
      stack.push({ value: nested, depth: current.depth + 1 })
    }
    if (approximateBytes > PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_BYTES) {
      throw portableError('malformed_identity')
    }
  }
  if (utf8Length(encodeCanonical(input)) > PORTABLE_RESOURCE_REFERENCE_MAX_IDENTITY_BYTES) {
    throw portableError('malformed_identity')
  }
}

function isForbiddenString(value: string): boolean {
  const trimmed = value.trim()
  return trimmed !== value ||
    hasControlCharacter(trimmed) ||
    runtimeHandlePattern.test(trimmed) ||
    localConnectionPattern.test(trimmed) ||
    uriPattern.test(trimmed) ||
    networkTargetPattern.test(trimmed) ||
    trimmed.startsWith('/') || trimmed.startsWith('\\') ||
    trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('~/') ||
    /(?:^|\s)(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*$/iu.test(trimmed)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function encodeCanonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' ||
    typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(encodeCanonical).join(',')}]`
  if (!isRecord(value)) throw new TypeError('Value is not canonical JSON.')
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${encodeCanonical(value[key])}`
  ).join(',')}}`
}

function cloneCanonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneCanonical)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneCanonical((value as Record<string, unknown>)[key]),
      writable: false
    })
  }
  return result
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

function portableError(code: PortableResourceReferenceErrorCode): PortableResourceReferenceError {
  const messages: Record<PortableResourceReferenceErrorCode, string> = {
    invalid_envelope: 'Portable resource reference envelope is invalid.',
    envelope_too_large: 'Portable resource reference envelope exceeds its bound.',
    unsupported_version: 'Portable resource reference version is unsupported.',
    unknown_kind: 'Portable resource reference kind is not registered.',
    malformed_identity: 'Portable resource reference identity is invalid.',
    unknown_authority: 'Portable resource reference authority is not trusted locally.',
    unknown_resolver: 'Portable resource authority resolver is not registered.',
    incompatible_resolver: 'Portable resource authority resolver is incompatible with the reference kind.',
    duplicate_codec: 'Portable resource reference codec ownership conflicts.',
    duplicate_resolver: 'Portable resource authority resolver ownership conflicts.',
    principal_unavailable: 'A current Host principal is required.',
    principal_changed: 'The Host principal changed during portable resource resolution.',
    operation_cancelled: 'Portable resource processing was cancelled.',
    resolution_rejected: 'Portable resource reauthorization was rejected.',
    invalid_resolution: 'Portable resource resolver returned an invalid result.',
    unauthorized_export: 'Portable resource export is not authorized.',
    export_capacity_exceeded: 'Portable resource export binding capacity is exhausted.',
    invalid_export_projection: 'Portable resource export projection is invalid.'
  }
  return new PortableResourceReferenceError(code, messages[code])
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function hasOnlyKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
