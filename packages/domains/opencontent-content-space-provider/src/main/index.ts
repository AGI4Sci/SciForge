import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'

import {
  OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRACT,
  OPENCONTENT_CONTENT_SPACE_FACTORY_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createOpenContentContentSpaceProvider } from './provider.js'
import type { OpenContentIdentityBindingPort } from './identity-binding.js'

export type { OpenContentIdentityBindingPort } from './identity-binding.js'

type OpenContentAdapterMainContribution = ReturnType<
  typeof defineContentSpaceProviderFactory
>

export function createDomainMainEntry(
  host: DomainMainHost,
  options: Readonly<{
    identities?: OpenContentIdentityBindingPort
  }> = {}
): TrustedDomainProcessEntryInput<OpenContentAdapterMainContribution> {
  if (!host.internalServices) {
    throw new Error('OpenContent Content Space Provider requires Host service mediation.')
  }
  const factory = defineContentSpaceProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: OPENCONTENT_PROVIDER_KIND,
    createProvider: ({ instance }) => {
      if (instance.providerInstanceRef !== OPENCONTENT_PROVIDER_INSTANCE_REF) {
        throw new Error('The selected OpenContent Provider Instance is not installed.')
      }
      const facade = host.internalServices!.acquire<OpenContentContentSpaceFacade>(
        OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
        OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION
      )
      return createOpenContentContentSpaceProvider({
        providerInstanceRef: instance.providerInstanceRef,
        facade,
        ...(options.identities === undefined ? {} : { identities: options.identities })
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
