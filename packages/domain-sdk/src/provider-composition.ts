import { z } from 'zod'

import {
  domainPackageContributionIdSchema,
  domainPackageModuleIdSchema,
  domainPackageNameSchema,
  domainPackageStableVersionSchema,
  domainPackageVersionSchema
} from './contract.js'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from './host.js'

export const PROVIDER_FACTORY_CONTRACT_VERSION = '1.0.0' as const
export const PROVIDER_FACTORY_SUPPORTED_CONTRACT_MAJOR = 1 as const

/** Canonical `main.extension` location for Shared Documents Provider factories. */
export const MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION =
  'main.document-provider-factory' as const

/** Canonical `main.extension` location for Content Space Provider factories. */
export const MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION =
  'main.content-space-provider-factory' as const

/** Canonical `main.extension` location for trusted non-secret Provider Instances. */
export const MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION =
  'main.provider-instance-directory-entry' as const

const providerKindPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u
const providerInstanceRefPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/u
const forbiddenInstanceRefPattern =
  /(?:^|[._-])(?:conn(?:ection)?|credential|endpoint|host|origin|password|secret|token|url|uri)(?:[._-]|$)/iu
const processLocalBrokerRefPattern = /^(?:cap|res)_[A-Za-z0-9._-]+$/u
const hostOwnedRuntimeHandlePattern = /^(?:xfer|portal)_[A-Za-z0-9_-]{32}$/u

export const providerKindSchema = z.string()
  .min(3)
  .max(96)
  .regex(providerKindPattern, 'Use a bounded lowercase Provider Kind.')

export const providerInstanceRefSchema = z.string()
  .min(3)
  .max(256)
  .regex(providerInstanceRefPattern, 'Use an opaque bounded Provider Instance Reference.')
  .refine(
    (value) => !forbiddenInstanceRefPattern.test(value),
    'Provider Instance References cannot identify local access or secret material.'
  )
  .refine(
    (value) => !processLocalBrokerRefPattern.test(value),
    'Provider Instance References cannot be process-local Broker handles.'
  )
  .refine(
    (value) => !hostOwnedRuntimeHandlePattern.test(value),
    'Provider Instance References cannot be Host-owned runtime handles.'
  )

const providerFactoryContractFields = {
  contractVersion: domainPackageStableVersionSchema,
  providerKind: providerKindSchema
}

export const documentProviderFactoryContributionContractSchema = z.object({
  location: z.literal(MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION),
  ...providerFactoryContractFields
}).strict()

export const contentSpaceProviderFactoryContributionContractSchema = z.object({
  location: z.literal(MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION),
  ...providerFactoryContractFields
}).strict()

export const providerFactoryContributionContractSchema = z.discriminatedUnion('location', [
  documentProviderFactoryContributionContractSchema,
  contentSpaceProviderFactoryContributionContractSchema
])

export const providerInstanceDirectoryEntryContributionContractSchema = z.object({
  location: z.literal(MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION),
  contractVersion: domainPackageStableVersionSchema,
  providerInstanceRef: providerInstanceRefSchema,
  providerKind: providerKindSchema,
  displayName: z.string().trim().min(1).max(160)
}).strict()

const providerInstanceDirectoryEntrySchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  providerKind: providerKindSchema,
  displayName: z.string().trim().min(1).max(160)
}).strict()

export type ProviderKind = string & { readonly __brand: 'ProviderKind' }
export type ProviderInstanceRef = string & { readonly __brand: 'ProviderInstanceRef' }
export type ProviderFactoryContributionContract = z.infer<
  typeof providerFactoryContributionContractSchema
>

export type ProviderCompositionOwner = Readonly<{
  packageName: string
  moduleId: string
  moduleVersion: string
  contributionId: string
}>

export type ProviderInstanceDirectoryEntry = Readonly<{
  providerInstanceRef: ProviderInstanceRef
  providerKind: ProviderKind
  displayName: string
}>

export type ProviderFactoryHostView<HostPorts> = Readonly<{
  owner: ProviderCompositionOwner
  instance: ProviderInstanceDirectoryEntry
  ports: HostPorts
}>

export type ProviderFactoryLocation =
  | typeof MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION
  | typeof MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION

export type ProviderFactoryRuntimeValue<
  Provider,
  HostPorts,
  Location extends ProviderFactoryLocation = ProviderFactoryLocation
> = Readonly<{
  location: Location
  contractVersion: string
  providerKind: ProviderKind
  createProvider(
    hostView: ProviderFactoryHostView<HostPorts>
  ): Provider | Promise<Provider>
}>

export type ProviderFactoryRuntimeValueInput<Provider, HostPorts> = Readonly<{
  contractVersion: string
  providerKind: string
  createProvider(
    hostView: ProviderFactoryHostView<HostPorts>
  ): Provider | Promise<Provider>
}>

export type DocumentProviderFactoryRuntimeValue<Provider, HostPorts> =
  ProviderFactoryRuntimeValue<
    Provider,
    HostPorts,
    typeof MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION
  >

export type ContentSpaceProviderFactoryRuntimeValue<Provider, HostPorts> =
  ProviderFactoryRuntimeValue<
    Provider,
    HostPorts,
    typeof MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION
  >

export type ProviderInstanceDirectoryEntryRuntimeValue = Readonly<{
  location: typeof MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION
  contractVersion: string
  providerInstanceRef: ProviderInstanceRef
  providerKind: ProviderKind
  displayName: string
}>

export type ProviderInstanceDirectoryEntryRuntimeValueInput = Readonly<{
  contractVersion: string
  providerInstanceRef: string
  providerKind: string
  displayName: string
}>

export type ProviderCompositionErrorCode =
  | 'composition_not_ready'
  | 'invalid_contribution'
  | 'incompatible_contract_version'
  | 'duplicate_provider_kind'
  | 'invalid_provider_instance'
  | 'duplicate_provider_instance'
  | 'unknown_provider_instance'
  | 'missing_provider'
  | 'provider_unavailable'

export class ProviderCompositionError extends Error {
  readonly code: ProviderCompositionErrorCode

  constructor(code: ProviderCompositionErrorCode, message: string) {
    super(message.slice(0, 256))
    this.name = 'ProviderCompositionError'
    this.code = code
  }
}

const providerInstanceDirectoryBrand: unique symbol = Symbol('ProviderInstanceDirectory')
const composedProviderInstanceDirectories = new WeakSet<object>()

/**
 * A read-only directory composed exclusively from trusted `main.extension` declarations.
 * Callers cannot construct or populate it directly.
 */
export type ProviderInstanceDirectory = Readonly<{
  readonly [providerInstanceDirectoryBrand]: true
  resolve(input: string): ProviderInstanceDirectoryEntry | undefined
  list(): readonly ProviderInstanceDirectoryEntry[]
}>

class ComposedProviderInstanceDirectory implements ProviderInstanceDirectory {
  readonly [providerInstanceDirectoryBrand] = true as const
  readonly #byRef = new Map<ProviderInstanceRef, ProviderInstanceDirectoryEntry>()

  constructor(entries: readonly Readonly<{
    providerInstanceRef: string
    providerKind: string
    displayName: string
  }>[]) {
    for (const rawEntry of entries) {
      const parsed = providerInstanceDirectoryEntrySchema.safeParse(rawEntry)
      if (!parsed.success) throw providerCompositionError('invalid_provider_instance')
      const providerInstanceRef = parseProviderInstanceRef(parsed.data.providerInstanceRef)
      if (this.#byRef.has(providerInstanceRef)) {
        throw providerCompositionError('duplicate_provider_instance')
      }
      this.#byRef.set(providerInstanceRef, Object.freeze({
        providerInstanceRef,
        providerKind: parseProviderKind(parsed.data.providerKind),
        displayName: parsed.data.displayName
      }))
    }
    composedProviderInstanceDirectories.add(this)
    Object.freeze(this)
  }

  resolve(input: string): ProviderInstanceDirectoryEntry | undefined {
    return this.#byRef.get(parseProviderInstanceRef(input))
  }

  list(): readonly ProviderInstanceDirectoryEntry[] {
    return Object.freeze([...this.#byRef.values()].sort((left, right) =>
      left.providerInstanceRef.localeCompare(right.providerInstanceRef)
    ))
  }
}

Object.freeze(ComposedProviderInstanceDirectory.prototype)

export type ProviderFactorySelection<Provider, HostPorts> = Readonly<{
  contractVersion: string
  providerKind: ProviderKind
  providerInstanceRef: ProviderInstanceRef
  owner: ProviderCompositionOwner
  createProvider(ports: HostPorts): Promise<Provider>
}>

export type ProviderFactoryCatalog<Provider, HostPorts> = Readonly<{
  list(): readonly Readonly<{
    contractVersion: string
    providerKind: ProviderKind
    owner: ProviderCompositionOwner
  }>[]
  select(
    directory: ProviderInstanceDirectory,
    providerInstanceRef: string
  ): ProviderFactorySelection<Provider, HostPorts>
}>

export function defineDocumentProviderFactory<Provider, HostPorts>(
  input: ProviderFactoryRuntimeValueInput<Provider, HostPorts>
): DocumentProviderFactoryRuntimeValue<Provider, HostPorts> {
  return defineProviderFactoryRuntimeValue(MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION, input)
}

export function defineContentSpaceProviderFactory<Provider, HostPorts>(
  input: ProviderFactoryRuntimeValueInput<Provider, HostPorts>
): ContentSpaceProviderFactoryRuntimeValue<Provider, HostPorts> {
  return defineProviderFactoryRuntimeValue(MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION, input)
}

export function defineProviderInstanceDirectoryEntry(
  input: ProviderInstanceDirectoryEntryRuntimeValueInput
): ProviderInstanceDirectoryEntryRuntimeValue {
  if (!hasExactKeys(
    input,
    ['contractVersion', 'displayName', 'providerInstanceRef', 'providerKind']
  )) {
    throw providerCompositionError('invalid_contribution')
  }
  const parsed = providerInstanceDirectoryEntryContributionContractSchema.safeParse({
    location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
    ...input
  })
  if (!parsed.success) throw providerCompositionError('invalid_contribution')
  return Object.freeze({
    location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
    contractVersion: parsed.data.contractVersion,
    providerInstanceRef: parseProviderInstanceRef(parsed.data.providerInstanceRef),
    providerKind: parseProviderKind(parsed.data.providerKind),
    displayName: parsed.data.displayName
  })
}

export function createProviderInstanceDirectory(
  host: DomainMainContributionHost
): ProviderInstanceDirectory {
  const entries = contributionsAt(
    host,
    MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION
  ).map(validateOwnedProviderInstanceDirectoryEntry).map(({ runtime }) => ({
    providerInstanceRef: runtime.providerInstanceRef,
    providerKind: runtime.providerKind,
    displayName: runtime.displayName
  }))
  return new ComposedProviderInstanceDirectory(entries)
}

export function createDocumentProviderFactoryCatalog<Provider, HostPorts>(
  host: DomainMainContributionHost
): ProviderFactoryCatalog<Provider, HostPorts> {
  return createProviderFactoryCatalog(host, MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION)
}

export function createContentSpaceProviderFactoryCatalog<Provider, HostPorts>(
  host: DomainMainContributionHost
): ProviderFactoryCatalog<Provider, HostPorts> {
  return createProviderFactoryCatalog(host, MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION)
}

export function parseProviderKind(input: unknown): ProviderKind {
  return providerKindSchema.parse(input) as ProviderKind
}

export function parseProviderInstanceRef(input: unknown): ProviderInstanceRef {
  return providerInstanceRefSchema.parse(input) as ProviderInstanceRef
}

function defineProviderFactoryRuntimeValue<Provider, HostPorts, Location extends ProviderFactoryLocation>(
  location: Location,
  input: ProviderFactoryRuntimeValueInput<Provider, HostPorts>
): ProviderFactoryRuntimeValue<Provider, HostPorts, Location> {
  if (!hasExactKeys(input, ['contractVersion', 'createProvider', 'providerKind']) ||
    !domainPackageStableVersionSchema.safeParse(input.contractVersion).success ||
    !providerKindSchema.safeParse(input.providerKind).success ||
    typeof input.createProvider !== 'function') {
    throw providerCompositionError('invalid_contribution')
  }
  return Object.freeze({
    location,
    contractVersion: input.contractVersion,
    providerKind: parseProviderKind(input.providerKind),
    createProvider: input.createProvider
  })
}

type OwnedProviderFactory<Provider, HostPorts> = Readonly<{
  owner: ProviderCompositionOwner
  runtime: ProviderFactoryRuntimeValue<Provider, HostPorts>
}>

function createProviderFactoryCatalog<Provider, HostPorts>(
  host: DomainMainContributionHost,
  location: ProviderFactoryLocation
): ProviderFactoryCatalog<Provider, HostPorts> {
  const byKind = new Map<ProviderKind, OwnedProviderFactory<Provider, HostPorts>>()
  for (const contribution of contributionsAt(host, location)) {
    const owned = validateOwnedProviderFactory<Provider, HostPorts>(location, contribution)
    if (byKind.has(owned.runtime.providerKind)) {
      throw providerCompositionError('duplicate_provider_kind')
    }
    byKind.set(owned.runtime.providerKind, owned)
  }

  const list = Object.freeze([...byKind.values()]
    .sort((left, right) => left.runtime.providerKind.localeCompare(right.runtime.providerKind))
    .map((owned) => Object.freeze({
      contractVersion: owned.runtime.contractVersion,
      providerKind: owned.runtime.providerKind,
      owner: owned.owner
    })))

  return Object.freeze({
    list: () => list,
    select: (directory: ProviderInstanceDirectory, rawProviderInstanceRef: string) => {
      if (!composedProviderInstanceDirectories.has(directory)) {
        throw providerCompositionError('invalid_provider_instance')
      }
      let instance: ProviderInstanceDirectoryEntry | undefined
      try {
        instance = directory.resolve(rawProviderInstanceRef)
      } catch {
        throw providerCompositionError('invalid_provider_instance')
      }
      if (!instance) throw providerCompositionError('unknown_provider_instance')
      const owned = byKind.get(instance.providerKind)
      if (!owned) throw providerCompositionError('missing_provider')

      return Object.freeze({
        contractVersion: owned.runtime.contractVersion,
        providerKind: owned.runtime.providerKind,
        providerInstanceRef: instance.providerInstanceRef,
        owner: owned.owner,
        createProvider: async (ports: HostPorts): Promise<Provider> => {
          try {
            return await owned.runtime.createProvider(Object.freeze({
              owner: owned.owner,
              instance,
              ports
            }))
          } catch {
            throw providerCompositionError('provider_unavailable')
          }
        }
      })
    }
  })
}

function validateOwnedProviderFactory<Provider, HostPorts>(
  expectedLocation: ProviderFactoryLocation,
  contribution: DomainMainContribution
): OwnedProviderFactory<Provider, HostPorts> {
  try {
    const owner = validateContributionMetadata(contribution)
    const contractSchema = expectedLocation === MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION
      ? documentProviderFactoryContributionContractSchema
      : contentSpaceProviderFactoryContributionContractSchema
    const contract = contractSchema.parse(contribution.contract)
    assertSupportedContractVersion(contract.contractVersion)
    if (contribution.version !== contract.contractVersion ||
      !isProviderFactoryRuntimeValue<Provider, HostPorts>(contribution.value) ||
      contribution.value.location !== expectedLocation ||
      contribution.value.contractVersion !== contract.contractVersion ||
      contribution.value.providerKind !== contract.providerKind) {
      throw new Error('Provider factory metadata and runtime value drifted.')
    }
    return Object.freeze({ owner, runtime: contribution.value })
  } catch (error) {
    if (error instanceof ProviderCompositionError) throw error
    throw providerCompositionError('invalid_contribution')
  }
}

function validateOwnedProviderInstanceDirectoryEntry(
  contribution: DomainMainContribution
): Readonly<{
  owner: ProviderCompositionOwner
  runtime: ProviderInstanceDirectoryEntryRuntimeValue
}> {
  try {
    const owner = validateContributionMetadata(contribution)
    const contract = providerInstanceDirectoryEntryContributionContractSchema.parse(
      contribution.contract
    )
    assertSupportedContractVersion(contract.contractVersion)
    if (contribution.version !== contract.contractVersion ||
      !isProviderInstanceDirectoryEntryRuntimeValue(contribution.value) ||
      contribution.value.contractVersion !== contract.contractVersion ||
      contribution.value.providerInstanceRef !== contract.providerInstanceRef ||
      contribution.value.providerKind !== contract.providerKind ||
      contribution.value.displayName !== contract.displayName) {
      throw new Error('Provider Instance metadata and runtime value drifted.')
    }
    return Object.freeze({ owner, runtime: contribution.value })
  } catch (error) {
    if (error instanceof ProviderCompositionError) throw error
    throw providerCompositionError('invalid_contribution')
  }
}

function validateContributionMetadata(
  contribution: DomainMainContribution
): ProviderCompositionOwner {
  if (!isRecord(contribution) || contribution.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND) {
    throw new Error('Provider composition requires a main extension contribution.')
  }
  const packageName = domainPackageNameSchema.parse(contribution.packageName)
  const moduleId = domainPackageModuleIdSchema.parse(contribution.owner?.moduleId)
  const moduleVersion = domainPackageVersionSchema.parse(contribution.owner?.moduleVersion)
  const contributionId = domainPackageContributionIdSchema.parse(contribution.id)
  domainPackageStableVersionSchema.parse(contribution.version)
  return Object.freeze({ packageName, moduleId, moduleVersion, contributionId })
}

function contributionsAt(
  host: DomainMainContributionHost,
  location:
    | ProviderFactoryLocation
    | typeof MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION
): readonly DomainMainContribution[] {
  if (host === null || typeof host !== 'object' || typeof host.list !== 'function') {
    throw providerCompositionError('composition_not_ready')
  }
  const listed = host.list(MAIN_EXTENSION_CONTRIBUTION_KIND)
  if (!Array.isArray(listed)) throw providerCompositionError('invalid_contribution')
  const matching: DomainMainContribution[] = []
  for (const contribution of listed) {
    if (!isRecord(contribution.contract) ||
      typeof contribution.contract.location !== 'string') {
      throw providerCompositionError('invalid_contribution')
    }
    if (contribution.contract.location === location) matching.push(contribution)
  }
  return Object.freeze(matching)
}

function isProviderFactoryRuntimeValue<Provider, HostPorts>(
  value: unknown
): value is ProviderFactoryRuntimeValue<Provider, HostPorts> {
  if (!hasExactKeys(
    value,
    ['contractVersion', 'createProvider', 'location', 'providerKind']
  )) return false
  return (value.location === MAIN_DOCUMENT_PROVIDER_FACTORY_LOCATION ||
      value.location === MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION) &&
    domainPackageStableVersionSchema.safeParse(value.contractVersion).success &&
    providerKindSchema.safeParse(value.providerKind).success &&
    typeof value.createProvider === 'function'
}

function isProviderInstanceDirectoryEntryRuntimeValue(
  value: unknown
): value is ProviderInstanceDirectoryEntryRuntimeValue {
  if (!hasExactKeys(
    value,
    ['contractVersion', 'displayName', 'location', 'providerInstanceRef', 'providerKind']
  )) return false
  return value.location === MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION &&
    providerInstanceDirectoryEntryContributionContractSchema.safeParse(value).success
}

function assertSupportedContractVersion(version: string): void {
  if (Number(version.split('.')[0]) !== PROVIDER_FACTORY_SUPPORTED_CONTRACT_MAJOR) {
    throw providerCompositionError('incompatible_contract_version')
  }
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

function providerCompositionError(
  code: ProviderCompositionErrorCode
): ProviderCompositionError {
  const messages: Record<ProviderCompositionErrorCode, string> = {
    composition_not_ready: 'Main extension composition is not ready.',
    invalid_contribution: 'Provider composition contribution is invalid.',
    incompatible_contract_version: 'Provider composition contract version is incompatible.',
    duplicate_provider_kind: 'Provider Kind ownership conflicts in this catalog.',
    invalid_provider_instance: 'Provider Instance Reference is invalid.',
    duplicate_provider_instance: 'Provider Instance Reference ownership conflicts.',
    unknown_provider_instance: 'Provider Instance Reference is not trusted locally.',
    missing_provider: 'The pinned Provider implementation is not installed.',
    provider_unavailable: 'The pinned Provider is unavailable.'
  }
  return new ProviderCompositionError(code, messages[code])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
