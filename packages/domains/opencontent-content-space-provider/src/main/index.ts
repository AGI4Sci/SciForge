import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_PROVIDER_KIND
} from '@sciforge/domain-opencontent-connector/contract'
import type { OpenContentContentSpaceFacade } from '@sciforge/domain-opencontent-connector/main-contract'

import {
  OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRACT,
  OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createOpenContentContentSpaceProvider } from './provider.js'

type OpenContentAdapterMainContribution = ReturnType<
  typeof defineContentSpaceProviderFactory
>

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<OpenContentAdapterMainContribution> {
  if (!host.internalServices) {
    throw new Error('OpenContent Content Space Provider requires Host service mediation.')
  }
  const factory = defineContentSpaceProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: OPENCONTENT_PROVIDER_KIND,
    createProvider: ({ instance }) => {
      const facade = host.internalServices!.acquire<OpenContentContentSpaceFacade>(
        OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
        OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION
      )
      return createOpenContentContentSpaceProvider({
        providerInstanceRef: instance.providerInstanceRef,
        facade
      })
    }
  })
  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRIBUTION,
      contract: OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRACT,
      value: factory
    }]
  }
}
