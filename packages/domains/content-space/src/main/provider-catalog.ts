import type { DomainMainContributionHost } from '@sciforge/domain-sdk/host'
import {
  createContentSpaceProviderFactoryCatalog,
  createProviderInstanceDirectory,
  type ProviderFactoryCatalog,
  type ProviderInstanceDirectory,
  type ProviderInstanceDirectoryEntry,
  type ProviderKind
} from '@sciforge/domain-sdk/provider-composition'

import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  defineContentSpaceProvider,
  type ContentSpaceProvider,
  type ContentSpaceProviderHostPorts
} from '../contract.js'

const CONTENT_SPACE_PROVIDER_HOST_PORTS: ContentSpaceProviderHostPorts = Object.freeze({
  contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION
})

export type PinnedContentSpaceProvider = Readonly<{
  providerInstanceRef: string
  providerKind: ProviderKind
  provider: ContentSpaceProvider
}>

/** Domain-owned projection over generic, fully composed Provider contributions. */
export class ContentSpaceProviderCatalog {
  readonly #directory: ProviderInstanceDirectory
  readonly #factories: ProviderFactoryCatalog<ContentSpaceProvider, ContentSpaceProviderHostPorts>

  constructor(contributions: DomainMainContributionHost) {
    this.#directory = createProviderInstanceDirectory(contributions)
    this.#factories = createContentSpaceProviderFactoryCatalog<
      ContentSpaceProvider,
      ContentSpaceProviderHostPorts
    >(contributions)
  }

  listProviderKinds(): readonly ProviderKind[] {
    return Object.freeze(this.#factories.list().map(({ providerKind }) => providerKind))
  }

  listProviderInstances(): readonly ProviderInstanceDirectoryEntry[] {
    const supportedKinds = new Set(this.listProviderKinds())
    return Object.freeze(this.#directory.list().filter(({ providerKind }) =>
      supportedKinds.has(providerKind)
    ))
  }

  hasProviderInstance(providerInstanceRef: string): boolean {
    try {
      return this.#directory.resolve(providerInstanceRef) !== undefined
    } catch {
      return false
    }
  }

  async pin(providerInstanceRef: string): Promise<PinnedContentSpaceProvider> {
    const selection = this.#factories.select(this.#directory, providerInstanceRef)
    const provider = defineContentSpaceProvider(
      await selection.createProvider(CONTENT_SPACE_PROVIDER_HOST_PORTS)
    )
    return Object.freeze({
      providerInstanceRef: selection.providerInstanceRef,
      providerKind: selection.providerKind,
      provider
    })
  }
}
