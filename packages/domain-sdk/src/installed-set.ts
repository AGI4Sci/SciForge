import {
  defineTrustedDomainPackage,
  domainContributionKey,
  type DomainPackageContributionDeclaration,
  type DomainPackageJsonValue,
  type DomainPackageProcess,
  type TrustedDomainPackageDefinition,
  type TrustedDomainPackageDefinitionInput
} from './contract.js'

export type InstalledDomainContribution<
  Process extends DomainPackageProcess = DomainPackageProcess
> = Readonly<{
  process: Process
  packageName: string
  entrypoint:
    Process extends 'main'
      ? './main'
      : Process extends 'renderer'
        ? './renderer'
        : './workspace-server'
  declaration: DomainPackageContributionDeclaration
  contract?: DomainPackageJsonValue
  owner: Readonly<{
    moduleId: string
    moduleVersion: string
  }>
}>

export type InstalledDomainPackageSet = Readonly<{
  definitions: readonly TrustedDomainPackageDefinition[]
  contributionsFor<Process extends DomainPackageProcess>(
    process: Process
  ): readonly InstalledDomainContribution<Process>[]
}>

export type InstalledDomainPackageSetErrorCode =
  | 'duplicate_package'
  | 'duplicate_module'
  | 'duplicate_contribution'

export class InstalledDomainPackageSetError extends Error {
  readonly code: InstalledDomainPackageSetErrorCode

  constructor(code: InstalledDomainPackageSetErrorCode, message: string) {
    super(message)
    this.name = 'InstalledDomainPackageSetError'
    this.code = code
  }
}

/**
 * Builds immutable process projections from one trusted compile-time set.
 * It resolves no paths and imports no implementation entrypoints.
 */
export function defineInstalledDomainPackageSet(
  inputs: readonly TrustedDomainPackageDefinitionInput[]
): InstalledDomainPackageSet {
  const definitions = inputs.map(defineTrustedDomainPackage)
  validateInstalledDefinitions(definitions)
  definitions.sort(compareDefinitions)
  Object.freeze(definitions)

  const contributionsByProcess = new Map<
    DomainPackageProcess,
    readonly InstalledDomainContribution[]
  >()
  for (const process of ['main', 'renderer', 'workspace-server'] as const) {
    contributionsByProcess.set(process, projectContributions(definitions, process))
  }

  return Object.freeze({
    definitions,
    contributionsFor<Process extends DomainPackageProcess>(process: Process) {
      return contributionsByProcess.get(process)! as readonly InstalledDomainContribution<Process>[]
    }
  })
}

function validateInstalledDefinitions(
  definitions: readonly TrustedDomainPackageDefinition[]
): void {
  const packageNames = new Set<string>()
  const moduleIds = new Set<string>()
  const contributionKeys = new Set<string>()

  for (const definition of definitions) {
    if (packageNames.has(definition.packageName)) {
      throw new InstalledDomainPackageSetError(
        'duplicate_package',
        `Trusted domain package ${definition.packageName} is installed more than once.`
      )
    }
    packageNames.add(definition.packageName)

    if (moduleIds.has(definition.module.id)) {
      throw new InstalledDomainPackageSetError(
        'duplicate_module',
        `Trusted domain module ${definition.module.id} is installed more than once.`
      )
    }
    moduleIds.add(definition.module.id)

    for (const entrypoint of definition.entrypoints) {
      for (const contribution of entrypoint.contributions) {
        const key = `${entrypoint.process}\u0000${domainContributionKey(
          contribution.kind,
          contribution.id
        )}`
        if (contributionKeys.has(key)) {
          throw new InstalledDomainPackageSetError(
            'duplicate_contribution',
            `Installed ${entrypoint.process} contribution ${contribution.kind}:${contribution.id} is duplicated.`
          )
        }
        contributionKeys.add(key)
      }
    }
  }
}

function projectContributions<Process extends DomainPackageProcess>(
  definitions: readonly TrustedDomainPackageDefinition[],
  process: Process
): readonly InstalledDomainContribution<Process>[] {
  const projected: InstalledDomainContribution<Process>[] = []
  for (const definition of definitions) {
    const entrypoint = definition.entrypoints.find((candidate) => candidate.process === process)
    if (!entrypoint) continue
    for (const declaration of entrypoint.contributions) {
      projected.push(Object.freeze({
        process,
        packageName: definition.packageName,
        entrypoint: entrypoint.export as InstalledDomainContribution<Process>['entrypoint'],
        declaration,
        ...(definition.contributionContracts[declaration.id] === undefined
          ? {}
          : { contract: definition.contributionContracts[declaration.id] }),
        owner: Object.freeze({
          moduleId: definition.module.id,
          moduleVersion: definition.module.version
        })
      }))
    }
  }
  projected.sort(compareContributions)
  return Object.freeze(projected)
}

function compareDefinitions(
  left: TrustedDomainPackageDefinition,
  right: TrustedDomainPackageDefinition
): number {
  return right.module.priority - left.module.priority ||
    left.module.id.localeCompare(right.module.id)
}

function compareContributions(
  left: InstalledDomainContribution,
  right: InstalledDomainContribution
): number {
  return right.declaration.priority - left.declaration.priority ||
    left.owner.moduleId.localeCompare(right.owner.moduleId) ||
    left.declaration.kind.localeCompare(right.declaration.kind) ||
    left.declaration.id.localeCompare(right.declaration.id)
}
