import {
  DOMAIN_PACKAGE_HOST_API_VERSION,
  domainContributionKey,
  domainPackageStableVersionSchema,
  isDomainPackageHostApiCompatible,
  type DomainPackageContributionDeclaration,
  type InstalledDomainContribution,
  type InstalledDomainRuntimeContribution,
  TrustedDomainProcessEntryError,
  type TrustedDomainPackageDefinition,
  type TrustedDomainProcessEntryInput,
  type TrustedDomainProcessRuntimeContribution
} from '@sciforge/domain-sdk'
import {
  defineTrustedMainDomainPackageEntry
} from '@sciforge/domain-sdk/main'

export type MainDomainContribution<Value = unknown> = TrustedDomainProcessRuntimeContribution<Value>

export type MainDomainModuleDefinition = TrustedDomainProcessEntryInput<unknown>

export type RegisteredMainDomainContribution<Value = unknown> =
  InstalledDomainRuntimeContribution<'main', Value>

export type DomainContributionRuntimeGuard<Value> = (
  value: unknown,
  metadata: InstalledDomainContribution<'main'>
) => value is Value

export type DomainModuleRegistration = Readonly<{
  moduleId: string
  disposed: boolean
  dispose(): void
}>

export type DomainModuleBatchRegistration = Readonly<{
  registrations: readonly DomainModuleRegistration[]
  disposed: boolean
  dispose(): void
}>

export type DomainModuleCatalogOptions = {
  hostApiVersion?: string
}

export type DomainModuleCatalogErrorCode =
  | 'invalid_module'
  | 'invalid_definition'
  | 'incompatible_host_api'
  | 'duplicate_package'
  | 'duplicate_module'
  | 'invalid_contribution'
  | 'invalid_contribution_value'
  | 'duplicate_contribution'

export class DomainModuleCatalogError extends Error {
  readonly code: DomainModuleCatalogErrorCode

  constructor(code: DomainModuleCatalogErrorCode, message: string) {
    super(message)
    this.name = 'DomainModuleCatalogError'
    this.code = code
  }
}

type StagedContribution = {
  metadata: InstalledDomainContribution<'main'>
  value: unknown
  onDispose?: () => void
  ordinal: number
}

type ModuleEntry = {
  definition: TrustedDomainPackageDefinition
  contributions: StagedContribution[]
  token: symbol
  registrationOrdinal: number
}

export class DomainModuleCatalog {
  readonly hostApiVersion: string
  readonly #modules = new Map<string, ModuleEntry>()
  readonly #packageNames = new Set<string>()
  readonly #contributions = new Map<string, StagedContribution>()
  #nextRegistrationOrdinal = 0

  constructor(options: DomainModuleCatalogOptions = {}) {
    this.hostApiVersion = domainPackageStableVersionSchema.parse(
      options.hostApiVersion ?? DOMAIN_PACKAGE_HOST_API_VERSION
    )
  }

  registerModule(definition: MainDomainModuleDefinition): DomainModuleRegistration {
    return this.registerBatch([definition]).registrations[0]!
  }

  registerBatch(
    definitions: readonly MainDomainModuleDefinition[]
  ): DomainModuleBatchRegistration {
    const staged = this.#stageBatch(definitions)

    for (const entry of staged) {
      this.#modules.set(entry.definition.module.id, entry)
      this.#packageNames.add(entry.definition.packageName)
      for (const contribution of entry.contributions) {
        this.#contributions.set(contributionIdentity(contribution.metadata.declaration), contribution)
      }
    }

    const registrations = staged.map((entry) => this.#registrationFor(entry))
    let disposed = false
    return Object.freeze({
      registrations: Object.freeze(registrations),
      get disposed() {
        return disposed || registrations.every((registration) => registration.disposed)
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        const errors: unknown[] = []
        for (const registration of [...registrations].reverse()) {
          try {
            registration.dispose()
          } catch (error) {
            errors.push(error)
          }
        }
        throwDisposalErrors(errors, 'Domain module batch disposal failed.')
      }
    })
  }

  hasModule(moduleId: string): boolean {
    return this.#modules.has(moduleId)
  }

  getModule(moduleId: string): TrustedDomainPackageDefinition['module'] | null {
    return this.#modules.get(moduleId)?.definition.module ?? null
  }

  listModules(): readonly TrustedDomainPackageDefinition['module'][] {
    return Object.freeze(
      [...this.#modules.values()]
        .map((entry) => entry.definition.module)
        .sort(compareModules)
    )
  }

  listPackages(): readonly TrustedDomainPackageDefinition[] {
    return Object.freeze(
      [...this.#modules.values()]
        .map((entry) => entry.definition)
        .sort((left, right) => compareModules(left.module, right.module))
    )
  }

  listContributions<Value>(
    kind: string,
    guard: DomainContributionRuntimeGuard<Value>
  ): readonly RegisteredMainDomainContribution<Value>[] {
    const contributions = [...this.#contributions.values()]
      .filter((contribution) => contribution.metadata.declaration.kind === kind)
      .sort(compareContributions)
    return Object.freeze(contributions.map((contribution) => {
      if (!guard(contribution.value, contribution.metadata)) {
        const declaration = contribution.metadata.declaration
        throw new DomainModuleCatalogError(
          'invalid_contribution_value',
          `Contribution ${declaration.kind}:${declaration.id} from ${contribution.metadata.owner.moduleId} failed runtime validation.`
        )
      }
      return registeredContribution(contribution, contribution.value)
    }))
  }

  unregisterModule(moduleId: string): boolean {
    const entry = this.#modules.get(moduleId)
    if (!entry) return false
    this.#unregisterEntry(entry)
    return true
  }

  dispose(): void {
    const entries = [...this.#modules.values()]
      .sort((left, right) => right.registrationOrdinal - left.registrationOrdinal)
    const errors: unknown[] = []
    for (const entry of entries) {
      try {
        this.#unregisterEntry(entry)
      } catch (error) {
        errors.push(error)
      }
    }
    throwDisposalErrors(errors, 'Domain module catalog disposal failed.')
  }

  #stageBatch(definitions: readonly MainDomainModuleDefinition[]): ModuleEntry[] {
    const packageNames = new Set<string>()
    const moduleIds = new Set<string>()
    const contributionKeys = new Set<string>()
    const staged: ModuleEntry[] = []

    for (const input of definitions) {
      if (!input || typeof input !== 'object') {
        throw new DomainModuleCatalogError('invalid_module', 'Domain module definition must be an object.')
      }

      let processEntry
      try {
        processEntry = defineTrustedMainDomainPackageEntry(input)
      } catch (error) {
        throw new DomainModuleCatalogError(
          processEntryErrorCode(error),
          `Trusted domain package main entry is invalid: ${errorMessage(error)}`
        )
      }
      const definition = processEntry.definition
      if (!isDomainPackageHostApiCompatible(definition.module.hostApi, this.hostApiVersion)) {
        throw new DomainModuleCatalogError(
          'incompatible_host_api',
          `Module ${definition.module.id} requires host API >=${definition.module.hostApi.minimum} and <${definition.module.hostApi.maximumExclusive}; current host API is ${this.hostApiVersion}.`
        )
      }
      if (this.#packageNames.has(definition.packageName) || packageNames.has(definition.packageName)) {
        throw new DomainModuleCatalogError(
          'duplicate_package',
          `Trusted domain package ${definition.packageName} is already registered.`
        )
      }
      packageNames.add(definition.packageName)
      if (this.#modules.has(definition.module.id) || moduleIds.has(definition.module.id)) {
        throw new DomainModuleCatalogError(
          'duplicate_module',
          `Module ${definition.module.id} is already registered.`
        )
      }
      moduleIds.add(definition.module.id)

      const mainEntrypoint = definition.entrypoints.find((entrypoint) => entrypoint.process === 'main')!

      const contributions = mainEntrypoint.contributions.map((declaration, ordinal) => {
        const key = contributionIdentity(declaration)
        if (this.#contributions.has(key) || contributionKeys.has(key)) {
          throw new DomainModuleCatalogError(
            'duplicate_contribution',
            `Contribution ${declaration.kind}:${declaration.id} is already registered.`
          )
        }
        contributionKeys.add(key)
        const runtime = processEntry.contributions[ordinal]!
        return {
          metadata: installedContributionMetadata(definition, declaration),
          value: runtime.value,
          ...(runtime.onDispose ? { onDispose: runtime.onDispose } : {}),
          ordinal
        }
      })

      staged.push({
        definition,
        contributions,
        token: Symbol(definition.module.id),
        registrationOrdinal: this.#nextRegistrationOrdinal + staged.length
      })
    }

    this.#nextRegistrationOrdinal += staged.length
    return staged
  }

  #registrationFor(entry: ModuleEntry): DomainModuleRegistration {
    const catalog = this
    let disposed = false
    return Object.freeze({
      moduleId: entry.definition.module.id,
      get disposed() {
        return disposed || catalog.#modules.get(entry.definition.module.id)?.token !== entry.token
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.#modules.get(entry.definition.module.id)?.token !== entry.token) return
        this.#unregisterEntry(entry)
      }
    })
  }

  #unregisterEntry(entry: ModuleEntry): void {
    if (this.#modules.get(entry.definition.module.id)?.token !== entry.token) return

    this.#modules.delete(entry.definition.module.id)
    this.#packageNames.delete(entry.definition.packageName)
    for (const contribution of entry.contributions) {
      const key = contributionIdentity(contribution.metadata.declaration)
      if (this.#contributions.get(key) === contribution) this.#contributions.delete(key)
    }

    const errors: unknown[] = []
    for (const contribution of [...entry.contributions].sort((left, right) => right.ordinal - left.ordinal)) {
      if (!contribution.onDispose) continue
      try {
        contribution.onDispose()
      } catch (error) {
        errors.push(error)
      }
    }
    throwDisposalErrors(errors, `Module ${entry.definition.module.id} disposal failed.`)
  }
}

function contributionIdentity(declaration: Pick<DomainPackageContributionDeclaration, 'kind' | 'id'>): string {
  return domainContributionKey(declaration.kind, declaration.id)
}

function installedContributionMetadata(
  definition: TrustedDomainPackageDefinition,
  declaration: DomainPackageContributionDeclaration
): InstalledDomainContribution<'main'> {
  return Object.freeze({
    process: 'main',
    packageName: definition.packageName,
    entrypoint: './main',
    declaration,
    ...(definition.contributionContracts[declaration.id] === undefined
      ? {}
      : { contract: definition.contributionContracts[declaration.id] }),
    owner: Object.freeze({
      moduleId: definition.module.id,
      moduleVersion: definition.module.version
    })
  })
}

function compareModules(
  left: TrustedDomainPackageDefinition['module'],
  right: TrustedDomainPackageDefinition['module']
): number {
  return right.priority - left.priority || left.id.localeCompare(right.id)
}

function compareContributions(left: StagedContribution, right: StagedContribution): number {
  return right.metadata.declaration.priority - left.metadata.declaration.priority ||
    left.metadata.owner.moduleId.localeCompare(right.metadata.owner.moduleId) ||
    left.metadata.declaration.kind.localeCompare(right.metadata.declaration.kind) ||
    left.metadata.declaration.id.localeCompare(right.metadata.declaration.id)
}

function registeredContribution<Value>(
  contribution: StagedContribution,
  value: Value
): RegisteredMainDomainContribution<Value> {
  return Object.freeze({
    ...contribution.metadata,
    value
  })
}

function throwDisposalErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function processEntryErrorCode(error: unknown): DomainModuleCatalogErrorCode {
  if (!(error instanceof TrustedDomainProcessEntryError)) return 'invalid_definition'
  if (error.code === 'missing_process_entrypoint') return 'invalid_definition'
  if (error.code === 'duplicate_runtime_contribution') return 'duplicate_contribution'
  return 'invalid_contribution'
}
