import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { defineDomainMainInternalServiceDescriptor } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  defineProviderInstanceDirectoryEntry,
  providerInstanceDirectoryEntryContributionContractSchema
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
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION
} from '../contract.js'
import {
  OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRACT,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  createOpenContentCapabilityFactory,
  type OpenContentCapabilityFactoryContribution
} from './connection-capabilities.js'
import { createOpenContentConnectionService } from './connection-service.js'
import { createOpenContentClient } from './opencontent-client.js'
import { createOpenContentPrivateAccountRuntime } from './provider-credential-runtime.js'
import { createOpenContentTeamAdministration } from './team-administration.js'
import {
  createOpenContentSupplierRuntimeSession,
  resolveOpenContentSupplierRuntimeAssets
} from './skill-runtime.js'
import { createOpenContentContentSpaceFacade } from './facade.js'
import { resolveOpenContentDeploymentConfiguration } from './deployment-config.js'
import type {
  OpenContentDeploymentRuntime,
  OpenContentDeploymentRuntimeGetter
} from './runtime.js'

const OPENCONTENT_ADAPTER_MODULE_ID = 'sciforge.opencontent-content-space-provider'

const internalServiceDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID]
})

const installedProviderContract =
  providerInstanceDirectoryEntryContributionContractSchema.parse(
    OPENCONTENT_PROVIDER_INSTANCE_CONTRACT
  )

const instance = defineProviderInstanceDirectoryEntry({
  contractVersion: installedProviderContract.contractVersion,
  providerInstanceRef: installedProviderContract.providerInstanceRef,
  providerKind: installedProviderContract.providerKind,
  displayName: installedProviderContract.displayName
})

type OpenContentMainContribution =
  | typeof instance
  | typeof internalServiceDescriptor
  | OpenContentCapabilityFactoryContribution

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<OpenContentMainContribution> {
  if (!host.internalServices) {
    throw new Error('OpenContent Connector requires Host internal-service mediation.')
  }
  let runtime: OpenContentDeploymentRuntime | undefined
  const getRuntime: OpenContentDeploymentRuntimeGetter = () => runtime
  const accounts = createOpenContentPrivateAccountRuntime({
    providerInstanceRef: instance.providerInstanceRef,
    credentials: host.packageSecrets?.providerCredentials,
    getRuntime
  })
  const connections = createOpenContentConnectionService({
    providerInstanceRef: instance.providerInstanceRef,
    accounts,
    getRuntime
  })
  const deployment = resolveOpenContentDeploymentConfiguration(
    host,
    instance.providerInstanceRef
  )
  if (deployment) {
    const client = createOpenContentClient({ baseUrl: deployment.origin })
    const teamAdministration = createOpenContentTeamAdministration({
      baseUrl: deployment.origin
    })
    const supplierAssets = resolveOpenContentSupplierRuntimeAssets(host)
    const supplierAssetPaths = supplierAssets === undefined
      ? undefined
      : assertOpenContentSkillBundledAssetsPresent(supplierAssets)
    const executablePath = supplierAssets === undefined
      ? undefined
      : host.getExecutablePath?.()
    if (supplierAssets !== undefined && executablePath === undefined) {
      throw new Error('OpenContent Connector requires the Host executable.')
    }
    const assertSupplierAssetsCurrent = supplierAssets === undefined
      ? undefined
      : () => {
          const currentAssets = resolveOpenContentSupplierRuntimeAssets(host)
          if (currentAssets === undefined || !sameSupplierAssetLocation(supplierAssets, currentAssets)) {
            throw new TypeError('Bundled OpenContent assets are unavailable or invalid.')
          }
          assertOpenContentSkillBundledAssetsPresent(currentAssets)
        }
    const supplierRuntime = supplierAssets === undefined || supplierAssetPaths === undefined ||
      executablePath === undefined
      ? undefined
      : createOpenContentSupplierRuntimeSession({
          providerInstanceRef: instance.providerInstanceRef,
          connections,
          processPort: createNodeOpenContentCliProcessPort({
            trustedEntrypoint: supplierAssetPaths.cliEntrypoint,
            executablePath,
            electronRunAsNode: true
          }),
          assets: supplierAssets,
          site: deployment.origin,
          assertAssetsCurrent: assertSupplierAssetsCurrent
        })
    runtime = Object.freeze({
      client,
      teamAdministration,
      ...(supplierRuntime ? { supplierRuntime } : {})
    })
  }
  const facade = createOpenContentContentSpaceFacade({
    providerInstanceRef: instance.providerInstanceRef,
    connections,
    getRuntime
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
          providerInstanceRef: instance.providerInstanceRef,
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

function sameSupplierAssetLocation(
  expected: OpenContentSkillBundledAssetLocation,
  current: OpenContentSkillBundledAssetLocation
): boolean {
  return expected.mode === 'source'
    ? current.mode === 'source' && expected.assetRoot === current.assetRoot
    : current.mode === 'packaged' && expected.resourcesPath === current.resourcesPath
}
