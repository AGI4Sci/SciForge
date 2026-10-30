import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'

import {
  LOCAL_MOCK_PROVIDER_FACTORY_CONTRACT,
  LOCAL_MOCK_PROVIDER_FACTORY_CONTRIBUTION,
  LOCAL_MOCK_PROVIDER_INSTANCE_CONTRACT,
  LOCAL_MOCK_PROVIDER_INSTANCE_CONTRIBUTION,
  LOCAL_MOCK_PROVIDER_INSTANCE_REF,
  LOCAL_MOCK_PROVIDER_KIND,
  domainPackageDefinition
} from '../definition.js'
import { createLocalMockContentSpaceProvider } from './local-mock-provider.js'

const factory = defineContentSpaceProviderFactory({
  contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
  providerKind: LOCAL_MOCK_PROVIDER_KIND,
  createProvider: ({ instance }) => createLocalMockContentSpaceProvider({
    providerInstanceRef: instance.providerInstanceRef
  })
})
const instance = defineProviderInstanceDirectoryEntry({
  contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
  providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
  providerKind: LOCAL_MOCK_PROVIDER_KIND,
  displayName: 'Local Content Space'
})

type LocalMockMainContribution = typeof factory | typeof instance

export function createDomainMainEntry(
  _host: DomainMainHost
): TrustedDomainProcessEntryInput<LocalMockMainContribution> {
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...LOCAL_MOCK_PROVIDER_FACTORY_CONTRIBUTION,
        contract: LOCAL_MOCK_PROVIDER_FACTORY_CONTRACT,
        value: factory
      },
      {
        ...LOCAL_MOCK_PROVIDER_INSTANCE_CONTRIBUTION,
        contract: LOCAL_MOCK_PROVIDER_INSTANCE_CONTRACT,
        value: instance
      }
    ]
  }
}
