import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import { installedMainDomainContributions } from '@sciforge/domain-sdk/main'
import { installedDomainPackages } from '../../shared/installed-domain-packages'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  CONTROLLED_PROCESS_CAPABILITY_CONTRIBUTION_FACTORY,
  SURFACE_CAPABILITY_CONTRIBUTION_FACTORY,
  WORKSPACE_PREVIEW_CAPABILITY_CONTRIBUTION_FACTORY
} from '../capabilities/app-registry'
import {
  VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY
} from '../capabilities/version-control-provider'
import type { CapabilityRegistry } from '../capabilities/registry'
import { DomainModuleCatalog, type MainDomainModuleDefinition } from './catalog'
import {
  createInstalledMainDomainEntries,
  type InstalledMainDomainHost
} from './installed-domain-main'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  composeMainCapabilityRegistry
} from './main-contributions'
import { HostInternalServiceRegistry } from './internal-services'

const CORE_MAIN_DOMAIN_ENTRIES: readonly MainDomainModuleDefinition[] = Object.freeze([
  coreCapabilityEntry({
    packageName: '@sciforge/core-controlled-process',
    moduleId: 'sciforge.controlled-process',
    displayName: 'Controlled Process',
    contributionId: 'sciforge.controlled-process.capability-factory',
    priority: 10_000,
    value: CONTROLLED_PROCESS_CAPABILITY_CONTRIBUTION_FACTORY
  }),
  coreCapabilityEntry({
    packageName: '@sciforge/core-surface',
    moduleId: 'sciforge.surface',
    displayName: 'Surface Context',
    contributionId: 'sciforge.surface.capability-factory',
    priority: 10_000,
    value: SURFACE_CAPABILITY_CONTRIBUTION_FACTORY
  }),
  coreCapabilityEntry({
    packageName: '@sciforge/core-version-control',
    moduleId: 'sciforge.version-control',
    displayName: 'Version Control',
    contributionId: 'sciforge.version-control.capability-factory',
    priority: 10_000,
    value: VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY
  }),
  coreCapabilityEntry({
    packageName: '@sciforge/core-workspace-preview',
    moduleId: 'sciforge.workspace-preview',
    displayName: 'Workspace Preview',
    contributionId: 'sciforge.workspace-preview.capability-factory',
    priority: 9_999,
    value: WORKSPACE_PREVIEW_CAPABILITY_CONTRIBUTION_FACTORY
  })
])

export function createApplicationDomainCatalog(
  host: Omit<InstalledMainDomainHost, 'internalServicesFor'>
): DomainModuleCatalog {
  const catalog = new DomainModuleCatalog()
  const internalServices = new HostInternalServiceRegistry(
    installedMainDomainContributions(installedDomainPackages)
  )
  const installedEntries = createInstalledMainDomainEntries({
    ...host,
    internalServicesFor: (owner) => internalServices.forOwner(owner)
  })
  internalServices.assertComplete()
  catalog.registerBatch([
    ...CORE_MAIN_DOMAIN_ENTRIES,
    ...installedEntries
  ])
  return catalog
}

export function createApplicationCapabilityRegistry(
  catalog: DomainModuleCatalog,
  dependencies: AppCapabilityDependencies
): CapabilityRegistry {
  return composeMainCapabilityRegistry(catalog, dependencies)
}

function coreCapabilityEntry(input: Readonly<{
  packageName: string
  moduleId: string
  displayName: string
  contributionId: string
  priority: number
  value: unknown
}>): MainDomainModuleDefinition {
  return Object.freeze({
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time',
      packageName: input.packageName,
      module: {
        id: input.moduleId,
        displayName: input.displayName,
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: input.priority
      },
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: input.contributionId,
          kind: MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
          priority: input.priority
        }]
      }]
    },
    contributions: [{
      id: input.contributionId,
      kind: MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      value: input.value
    }]
  })
}
