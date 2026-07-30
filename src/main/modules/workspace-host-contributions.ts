import {
  MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
  isWorkspaceHostProvider,
  type WorkspaceHostProvider
} from '@sciforge/domain-sdk/workspace-host'

import {
  DomainModuleCatalog,
  type DomainContributionRuntimeGuard
} from './catalog'

export {
  MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-host'

export type RegisteredWorkspaceHostProvider = Readonly<{
  providerId: string
  owner: Readonly<{
    moduleId: string
    moduleVersion: string
  }>
  ownerDisplayName: string
  provider: WorkspaceHostProvider
}>

export const isMainWorkspaceHostProviderContribution: DomainContributionRuntimeGuard<
  WorkspaceHostProvider
> = (value): value is WorkspaceHostProvider => isWorkspaceHostProvider(value)

/**
 * Projects owner-aware Workspace Host providers from the canonical domain
 * catalog. The declaration ID is the provider identity returned by the
 * package-owned authorization capability.
 */
export function listMainWorkspaceHostProviderContributions(
  catalog: DomainModuleCatalog
): readonly RegisteredWorkspaceHostProvider[] {
  return Object.freeze(catalog.listContributions(
    MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
    isMainWorkspaceHostProviderContribution
  ).map((installed) => Object.freeze({
    providerId: installed.declaration.id,
    owner: Object.freeze({ ...installed.owner }),
    ownerDisplayName: catalog.getModule(installed.owner.moduleId)?.displayName ??
      installed.owner.moduleId,
    provider: installed.value
  })))
}

export class WorkspaceHostProviderRegistry {
  readonly #providers: ReadonlyMap<string, RegisteredWorkspaceHostProvider>

  constructor(catalog: DomainModuleCatalog) {
    const providers = listMainWorkspaceHostProviderContributions(catalog)
    this.#providers = new Map(providers.map((provider) => [
      provider.providerId,
      provider
    ]))
  }

  list(): readonly RegisteredWorkspaceHostProvider[] {
    return Object.freeze([...this.#providers.values()])
  }

  resolve(providerId: string): RegisteredWorkspaceHostProvider | undefined {
    return this.#providers.get(normalizeProviderId(providerId))
  }

  require(providerId: string): RegisteredWorkspaceHostProvider {
    const normalized = normalizeProviderId(providerId)
    const provider = this.#providers.get(normalized)
    if (!provider) {
      throw new WorkspaceHostProviderRegistryError(
        'provider-not-found',
        `No Workspace Host provider is registered for ${normalized}.`
      )
    }
    return provider
  }
}

export type WorkspaceHostProviderRegistryErrorCode =
  | 'invalid-provider-id'
  | 'provider-not-found'

export class WorkspaceHostProviderRegistryError extends Error {
  constructor(
    readonly code: WorkspaceHostProviderRegistryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceHostProviderRegistryError'
  }
}

function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim()
  if (!normalized) {
    throw new WorkspaceHostProviderRegistryError(
      'invalid-provider-id',
      'Workspace Host provider ID must be non-empty.'
    )
  }
  return normalized
}
