import type { TrustedDomainPackageDefinition } from '@sciforge/domain-sdk'
import type {
  DomainExtensionSummary,
  DomainExtensionsApi
} from '../../shared/domain-extensions'
import type { SignedExtensionStore } from './store'
import type {
  InstalledExtensionPackage,
  InstalledExtensionStatus
} from './types'

type ExtensionStorePort = Pick<
  SignedExtensionStore,
  'install' | 'list' | 'status' | 'setEnabled' | 'rollback' | 'uninstall'
>

export type CreateDomainExtensionsApiOptions = Readonly<{
  bundledDefinitions: readonly TrustedDomainPackageDefinition[]
  store: ExtensionStorePort
  installationBlockedReason?: string
}>

/**
 * The single renderer-facing lifecycle adapter for bundled and installed
 * domain packages. It exposes bounded metadata only; executable entrypoints
 * remain confined to the extension store and their future isolated hosts.
 */
export function createDomainExtensionsApi(
  options: CreateDomainExtensionsApiOptions
): DomainExtensionsApi {
  const bundled = bundledSummaries(options.bundledDefinitions)
  const bundledPackageNames = new Set(bundled.map((extension) => extension.packageName))
  const bundledModuleIds = new Set(bundled.map((extension) => extension.moduleId))

  const conflictFor = (
    packageName: string,
    moduleId: string
  ): string | null => {
    if (bundledPackageNames.has(packageName)) {
      return `Package ${packageName} is already supplied by the SciForge application bundle.`
    }
    if (bundledModuleIds.has(moduleId)) {
      return `Module ${moduleId} is already supplied by the SciForge application bundle.`
    }
    return null
  }

  const summarizeInstalled = async (
    record: InstalledExtensionPackage,
    knownStatus?: InstalledExtensionStatus | null
  ): Promise<DomainExtensionSummary> => {
    const status = knownStatus === undefined
      ? await options.store.status(record.packageName)
      : knownStatus
    const active = status?.active ??
      record.versions.find((version) => version.version === record.activeVersion)!
    const conflict = conflictFor(record.packageName, record.moduleId)
    const diagnostic = conflict ??
      (status?.health === 'ready'
        ? undefined
        : status?.issue ?? 'The installed extension version could not be verified.')

    return {
      packageName: record.packageName,
      moduleId: record.moduleId,
      moduleDisplayName: record.displayName,
      version: active.version,
      publisher: {
        id: record.publisherId,
        displayName: record.publisherDisplayName
      },
      source: 'user',
      verification: 'official-signed',
      execution: 'sandboxed-runtime',
      status: diagnostic
        ? 'invalid'
        : record.enabled
          ? 'installed'
          : 'disabled',
      permissions: uniqueSorted(active.runtime.requestedPermissions.map((permission) => permission.id)),
      contributionKinds: uniqueSorted(
        active.runtime.entrypoints.flatMap((entrypoint) =>
          entrypoint.contributions.map((contribution) => contribution.kind)
        )
      ),
      contributionCount: active.runtime.entrypoints.reduce(
        (count, entrypoint) => count + entrypoint.contributions.length,
        0
      ),
      canRollback: record.versions.length > 1,
      installedAt: active.installedAt,
      ...(diagnostic ? { diagnostic } : {})
    }
  }

  const assertUserManaged = (packageName: string): void => {
    if (bundledPackageNames.has(packageName)) {
      throw new Error(`Bundled extension ${packageName} cannot be changed at runtime.`)
    }
  }

  return Object.freeze({
    list: async () => {
      const records = await options.store.list()
      const installed = await Promise.all(records.map((record) => summarizeInstalled(record)))
      return [...bundled, ...installed].sort(compareExtensionSummaries)
    },
    install: async ({ path }) => {
      if (options.installationBlockedReason) {
        throw new Error(options.installationBlockedReason)
      }
      const status = await options.store.install(path)
      return summarizeInstalled(status.package, status)
    },
    uninstall: async ({ packageName }) => {
      assertUserManaged(packageName)
      const removed = await options.store.uninstall(packageName)
      if (!removed) throw new Error(`Installed extension ${packageName} was not found.`)
    },
    rollback: async ({ packageName }) => {
      assertUserManaged(packageName)
      const status = await options.store.rollback(packageName)
      return summarizeInstalled(status.package, status)
    },
    setEnabled: async ({ packageName, enabled }) => {
      assertUserManaged(packageName)
      const record = await options.store.setEnabled(packageName, enabled)
      return summarizeInstalled(record)
    }
  })
}

function bundledSummaries(
  definitions: readonly TrustedDomainPackageDefinition[]
): DomainExtensionSummary[] {
  return definitions.flatMap((definition) => {
    if (!definition.publisher) return []
    const contributionKinds = uniqueSorted(
      definition.entrypoints.flatMap((entrypoint) =>
        entrypoint.contributions.map((contribution) => contribution.kind)
      )
    )
    return [{
      packageName: definition.packageName,
      moduleId: definition.module.id,
      moduleDisplayName: definition.module.displayName,
      version: definition.module.version,
      publisher: { ...definition.publisher },
      source: 'bundled' as const,
      verification: 'bundled' as const,
      execution: 'trusted-compile-time' as const,
      status: 'active' as const,
      permissions: [],
      contributionKinds,
      contributionCount: definition.entrypoints.reduce(
        (count, entrypoint) => count + entrypoint.contributions.length,
        0
      ),
      canRollback: false
    }]
  })
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function compareExtensionSummaries(
  left: DomainExtensionSummary,
  right: DomainExtensionSummary
): number {
  return (left.source === right.source ? 0 : left.source === 'bundled' ? -1 : 1) ||
    left.moduleDisplayName.localeCompare(right.moduleDisplayName) ||
    left.packageName.localeCompare(right.packageName)
}
