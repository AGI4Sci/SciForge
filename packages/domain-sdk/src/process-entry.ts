import {
  DOMAIN_PACKAGE_HOST_API_VERSION,
  defineTrustedDomainPackage,
  domainContributionKey,
  domainPackageContributionIdSchema,
  domainPackageContributionKindSchema,
  domainPackageJsonValueSchema,
  domainPackageJsonValuesEqual,
  type DomainPackageJsonValue,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput,
  isDomainPackageHostApiCompatible
} from './contract.js'
import type {
  InstalledDomainContribution,
  InstalledDomainPackageSet
} from './installed-set.js'

export type TrustedDomainProcessRuntimeContribution<Value> = Readonly<{
  id: string
  kind: string
  value: Value
  contract?: DomainPackageJsonValue
  onDispose?: () => void
}>

export type TrustedDomainProcessEntry<
  Process extends DomainPackageProcess,
  Value
> = Readonly<{
  process: Process
  definition: TrustedDomainPackageDefinition
  contributions: readonly TrustedDomainProcessRuntimeContribution<Value>[]
}>

export type TrustedDomainProcessEntryInput<Value> = {
  definition: TrustedDomainPackageDefinitionInput
  contributions: readonly TrustedDomainProcessRuntimeContribution<Value>[]
}

export type InstalledDomainProcessRuntimeContribution<
  Process extends DomainPackageProcess,
  Value
> = InstalledDomainContribution<Process> & Readonly<{
  value: Value
  onDispose?: () => void
}>

/** Runtime contribution bound by exactly one process entrypoint. */
export type InstalledDomainRuntimeContribution<
  Process extends DomainPackageProcess,
  Value
> = InstalledDomainProcessRuntimeContribution<Process, Value>

export type InstalledDomainProcessEntrySet<
  Process extends DomainPackageProcess,
  Value
> = Readonly<{
  process: Process
  entries: readonly TrustedDomainProcessEntry<Process, Value>[]
  contributions: readonly InstalledDomainProcessRuntimeContribution<Process, Value>[]
}>

export type TrustedDomainProcessEntryErrorCode =
  | 'missing_process_entrypoint'
  | 'invalid_runtime_contribution'
  | 'duplicate_runtime_contribution'
  | 'runtime_contribution_mismatch'
  | 'runtime_contribution_contract_mismatch'
  | 'duplicate_process_entry'
  | 'unexpected_process_entry'
  | 'missing_process_entry'
  | 'definition_mismatch'
  | 'incompatible_host_api'

export class TrustedDomainProcessEntryError extends Error {
  readonly code: TrustedDomainProcessEntryErrorCode

  constructor(code: TrustedDomainProcessEntryErrorCode, message: string) {
    super(message)
    this.name = 'TrustedDomainProcessEntryError'
    this.code = code
  }
}

export function defineTrustedDomainProcessEntry<
  Process extends DomainPackageProcess,
  Value
>(
  process: Process,
  input: TrustedDomainProcessEntryInput<Value>
): TrustedDomainProcessEntry<Process, Value> {
  const definition = defineTrustedDomainPackage(input.definition)
  const entrypoint = definition.entrypoints.find((candidate) => candidate.process === process)
  if (!entrypoint) {
    throw new TrustedDomainProcessEntryError(
      'missing_process_entrypoint',
      `Domain package ${definition.packageName} does not declare ${process}.`
    )
  }

  const valuesByKey = new Map<string, TrustedDomainProcessRuntimeContribution<Value>>()
  for (const contribution of input.contributions) {
    if (!contribution || typeof contribution !== 'object' ||
      !Object.hasOwn(contribution, 'value') ||
      (contribution.onDispose !== undefined && typeof contribution.onDispose !== 'function')) {
      throw new TrustedDomainProcessEntryError(
        'invalid_runtime_contribution',
        `Domain package ${definition.packageName} has an invalid ${process} contribution.`
      )
    }
    const id = domainPackageContributionIdSchema.parse(contribution.id)
    const kind = domainPackageContributionKindSchema.parse(contribution.kind)
    const key = domainContributionKey(kind, id)
    if (valuesByKey.has(key)) {
      throw new TrustedDomainProcessEntryError(
        'duplicate_runtime_contribution',
        `Domain package ${definition.packageName} repeats ${process} value ${kind}:${id}.`
      )
    }
    const contract = contribution.contract === undefined
      ? undefined
      : domainPackageJsonValueSchema.parse(contribution.contract)
    valuesByKey.set(key, Object.freeze({
      id,
      kind,
      value: contribution.value,
      ...(contract === undefined ? {} : { contract }),
      ...(contribution.onDispose ? { onDispose: contribution.onDispose } : {})
    }))
  }

  const declarationKeys = entrypoint.contributions.map((declaration) =>
    domainContributionKey(declaration.kind, declaration.id)
  )
  if (
    declarationKeys.some((key) => !valuesByKey.has(key)) ||
    [...valuesByKey.keys()].some((key) => !declarationKeys.includes(key))
  ) {
    throw new TrustedDomainProcessEntryError(
      'runtime_contribution_mismatch',
      `Domain package ${definition.packageName} ${process} values do not exactly match its declarations.`
    )
  }
  for (const declaration of entrypoint.contributions) {
    const runtime = valuesByKey.get(domainContributionKey(declaration.kind, declaration.id))!
    const expected = definition.contributionContracts[declaration.id]
    if ((expected === undefined) !== (runtime.contract === undefined) ||
        (expected !== undefined && runtime.contract !== undefined &&
          !domainPackageJsonValuesEqual(expected, runtime.contract))) {
      throw new TrustedDomainProcessEntryError(
        'runtime_contribution_contract_mismatch',
        `Domain package ${definition.packageName} ${process} contribution ${declaration.id} does not match its canonical contract.`
      )
    }
  }

  return Object.freeze({
    process,
    definition,
    contributions: Object.freeze(declarationKeys.map((key) => valuesByKey.get(key)!))
  })
}

export function defineInstalledDomainProcessEntrySet<
  Process extends DomainPackageProcess,
  Value
>(
  definitionSet: InstalledDomainPackageSet,
  process: Process,
  inputs: readonly TrustedDomainProcessEntryInput<Value>[],
  hostApiVersion = DOMAIN_PACKAGE_HOST_API_VERSION
): InstalledDomainProcessEntrySet<Process, Value> {
  const entries = inputs.map((input) => defineTrustedDomainProcessEntry(process, input))
  const entriesByModuleId = new Map<string, TrustedDomainProcessEntry<Process, Value>>()
  for (const entry of entries) {
    const moduleId = entry.definition.module.id
    if (entriesByModuleId.has(moduleId)) {
      throw new TrustedDomainProcessEntryError(
        'duplicate_process_entry',
        `Installed ${process} entry for ${moduleId} is duplicated.`
      )
    }
    entriesByModuleId.set(moduleId, entry)
  }

  const expectedDefinitions = definitionSet.definitions.filter((definition) =>
    definition.entrypoints.some((entrypoint) => entrypoint.process === process)
  )
  for (const definition of expectedDefinitions) {
    if (!isDomainPackageHostApiCompatible(definition.module.hostApi, hostApiVersion)) {
      throw new TrustedDomainProcessEntryError(
        'incompatible_host_api',
        `Domain module ${definition.module.id} requires host API >=${definition.module.hostApi.minimum} and <${definition.module.hostApi.maximumExclusive}; current host API is ${hostApiVersion}.`
      )
    }
  }
  for (const entry of entries) {
    const installed = expectedDefinitions.find((definition) =>
      definition.module.id === entry.definition.module.id
    )
    if (!installed) {
      throw new TrustedDomainProcessEntryError(
        'unexpected_process_entry',
        `Domain module ${entry.definition.module.id} is not installed for ${process}.`
      )
    }
    if (JSON.stringify(installed) !== JSON.stringify(entry.definition)) {
      throw new TrustedDomainProcessEntryError(
        'definition_mismatch',
        `Domain module ${entry.definition.module.id} ${process} entry does not match the installed definition.`
      )
    }
  }
  for (const definition of expectedDefinitions) {
    if (!entriesByModuleId.has(definition.module.id)) {
      throw new TrustedDomainProcessEntryError(
        'missing_process_entry',
        `Installed domain module ${definition.module.id} has no ${process} entry.`
      )
    }
  }

  const orderedEntries = Object.freeze(expectedDefinitions.map((definition) =>
    entriesByModuleId.get(definition.module.id)!
  ))
  const runtimeByKey = new Map<string, TrustedDomainProcessRuntimeContribution<Value>>()
  for (const entry of orderedEntries) {
    for (const contribution of entry.contributions) {
      runtimeByKey.set(domainContributionKey(contribution.kind, contribution.id), contribution)
    }
  }
  const contributions = Object.freeze(definitionSet.contributionsFor(process).map((metadata) => {
    const runtime = runtimeByKey.get(domainContributionKey(
      metadata.declaration.kind,
      metadata.declaration.id
    ))!
    return Object.freeze({
      ...metadata,
      value: runtime.value,
      ...(runtime.contract === undefined ? {} : { contract: runtime.contract }),
      ...(runtime.onDispose ? { onDispose: runtime.onDispose } : {})
    })
  }))

  return Object.freeze({ process, entries: orderedEntries, contributions })
}
