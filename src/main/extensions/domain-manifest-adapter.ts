import {
  domainPackageDefinitionSchema,
  isDomainPackageHostApiCompatible,
  type SandboxedDomainPackageDefinition
} from '@sciforge/domain-sdk'
import { ExtensionStoreError, extensionErrorMessage } from './errors'

export type InstallableDomainDefinition = SandboxedDomainPackageDefinition

/**
 * This is the single adapter between the installer and the domain SDK's public
 * manifest contract. It intentionally contains no local copy of that schema.
 *
 * Keeping the dependency isolated prevents the installer from becoming a second
 * manifest authority. Compile-time-trusted packages deliberately cannot cross
 * this runtime installation boundary.
 */
export function parseInstallableDomainDefinition(input: unknown): InstallableDomainDefinition {
  let definition
  try {
    definition = domainPackageDefinitionSchema.parse(input)
  } catch (error) {
    throw new ExtensionStoreError(
      'invalid_domain_manifest',
      `Invalid SciForge domain manifest: ${extensionErrorMessage(error)}`,
      { cause: error }
    )
  }
  if (definition.kind !== 'sandboxed-runtime') {
    throw new ExtensionStoreError(
      'invalid_domain_manifest',
      'Installable extension artifacts must use the sandboxed-runtime domain contract.'
    )
  }
  return definition
}

export function assertCompatibleHostApi(
  definition: InstallableDomainDefinition,
  hostApiVersion: string
): void {
  if (isDomainPackageHostApiCompatible(definition.module.hostApi, hostApiVersion)) return
  throw new ExtensionStoreError(
    'incompatible_host_api',
    `Extension ${definition.packageName}@${definition.module.version} requires host API ` +
      `>=${definition.module.hostApi.minimum} and ` +
      `<${definition.module.hostApi.maximumExclusive}; current host API is ${hostApiVersion}.`
  )
}

export function domainPublisherId(definition: InstallableDomainDefinition): string {
  return definition.publisher.id
}
