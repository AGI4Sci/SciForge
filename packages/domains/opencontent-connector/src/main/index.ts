import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { defineDomainMainInternalServiceDescriptor } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  assertOpenContentSkillBundledAssetsPresent,
  type OpenContentSkillBundledAssetLocation
} from './bundled-assets.js'
import {
  createNodeOpenContentCliProcessPort
} from './node-cli-process-port.js'

import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND
} from '../contract.js'
import {
  OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRACT,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import { createOpenContentCapabilityFactory } from './connection-capabilities.js'
import { createOpenContentConnectionService } from './connection-service.js'
import { createOpenContentClient } from './opencontent-client.js'
import { createOpenContentTeamAdministration } from './team-administration.js'
import {
  createOpenContentSkillRuntimeSession,
  resolveOpenContentSkillRuntimeAssets
} from './skill-runtime.js'
import { createOpenContentContentSpaceFacade } from './facade.js'

const OPENCONTENT_ADAPTER_MODULE_ID = 'sciforge.opencontent-content-space-provider'

const OPENCONTENT_CONNECTION_PROFILE = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  displayName: 'OpenContent' as const,
  origin: 'https://test1.edoc2.com' as const
})

const internalServiceDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID]
})

const instance = defineProviderInstanceDirectoryEntry({
  contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
  providerInstanceRef: OPENCONTENT_CONNECTION_PROFILE.providerInstanceRef,
  providerKind: OPENCONTENT_PROVIDER_KIND,
  displayName: OPENCONTENT_CONNECTION_PROFILE.displayName
})

type OpenContentMainContribution =
  | typeof instance
  | typeof internalServiceDescriptor
  | ReturnType<typeof createOpenContentCapabilityFactory>

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<OpenContentMainContribution> {
  if (!host.packageSettings || !host.packageSecrets?.providerCredentials) {
    throw new Error('OpenContent Connector requires secure owner-scoped package storage.')
  }
  if (!host.internalServices) {
    throw new Error('OpenContent Connector requires Host internal-service mediation.')
  }
  const client = createOpenContentClient({
    baseUrl: OPENCONTENT_CONNECTION_PROFILE.origin
  })
  const connections = createOpenContentConnectionService({
    providerInstanceRef: OPENCONTENT_CONNECTION_PROFILE.providerInstanceRef,
    settings: host.packageSettings,
    credentials: host.packageSecrets.providerCredentials,
    client
  })
  const teamAdministration = createOpenContentTeamAdministration({
    baseUrl: OPENCONTENT_CONNECTION_PROFILE.origin
  })
  const skillAssets = resolveOpenContentSkillRuntimeAssets(host)
  const skillAssetPaths = skillAssets === undefined
    ? undefined
    : assertOpenContentSkillBundledAssetsPresent(skillAssets)
  const executablePath = skillAssets === undefined
    ? undefined
    : host.getExecutablePath?.()
  if (skillAssets !== undefined && executablePath === undefined) {
    throw new Error('OpenContent Connector requires the Host executable.')
  }
  const assertSkillAssetsCurrent = skillAssets === undefined
    ? undefined
    : () => {
        const currentAssets = resolveOpenContentSkillRuntimeAssets(host)
        if (currentAssets === undefined || !sameSkillAssetLocation(skillAssets, currentAssets)) {
          throw new TypeError('Bundled OpenContent assets are unavailable or invalid.')
        }
        assertOpenContentSkillBundledAssetsPresent(currentAssets)
      }
  const skillRuntime = skillAssets === undefined || skillAssetPaths === undefined ||
    executablePath === undefined
    ? undefined
    : createOpenContentSkillRuntimeSession({
        connections,
        processPort: createNodeOpenContentCliProcessPort({
          trustedEntrypoint: skillAssetPaths.cliEntrypoint,
          executablePath,
          electronRunAsNode: true
        }),
        assets: skillAssets,
        site: OPENCONTENT_CONNECTION_PROFILE.origin,
        assertAssetsCurrent: assertSkillAssetsCurrent
      })
  const facade = createOpenContentContentSpaceFacade({
    client,
    connections,
    teamAdministration,
    ...(skillRuntime ? { skillRuntime } : {})
  })
  host.internalServices.register({
    serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
    contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
    allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID],
    service: facade
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createOpenContentCapabilityFactory({
          defineCapability: (options) => host.defineCapability(options),
          connections
        })
      },
      {
        ...OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION,
        contract: OPENCONTENT_PROVIDER_INSTANCE_CONTRACT,
        value: instance
      },
      {
        ...OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION,
        contract: OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
        value: internalServiceDescriptor
      }
    ]
  }
}

function sameSkillAssetLocation(
  expected: OpenContentSkillBundledAssetLocation,
  current: OpenContentSkillBundledAssetLocation
): boolean {
  return expected.mode === 'source'
    ? current.mode === 'source' && expected.assetRoot === current.assetRoot
    : current.mode === 'packaged' && expected.resourcesPath === current.resourcesPath
}
