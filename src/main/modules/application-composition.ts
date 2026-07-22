import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  ARTIFACT_CAPABILITY_CONTRIBUTION_FACTORY,
  SURFACE_CAPABILITY_CONTRIBUTION_FACTORY,
  WORKSPACE_PREVIEW_CAPABILITY_CONTRIBUTION_FACTORY
} from '../capabilities/app-registry'
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

const CORE_MAIN_DOMAIN_ENTRIES: readonly MainDomainModuleDefinition[] = Object.freeze([
  coreCapabilityEntry({
    packageName: '@sciforge/core-surface',
    moduleId: 'sciforge.surface',
    displayName: 'Surface Inspection',
    contributionId: 'sciforge.surface.capability-factory',
    priority: 10_000,
    value: SURFACE_CAPABILITY_CONTRIBUTION_FACTORY
  }),
  coreCapabilityEntry({
    packageName: '@sciforge/core-artifact',
    moduleId: 'sciforge.artifact',
    displayName: 'Artifact Inspection',
    contributionId: 'sciforge.artifact.capability-factory',
    priority: 9_999,
    value: ARTIFACT_CAPABILITY_CONTRIBUTION_FACTORY
  }),
  coreCapabilityEntry({
    packageName: '@sciforge/core-workspace-preview',
    moduleId: 'sciforge.workspace-preview',
    displayName: 'Workspace Preview',
    contributionId: 'sciforge.workspace-preview.capability-factory',
    priority: 9_998,
    value: WORKSPACE_PREVIEW_CAPABILITY_CONTRIBUTION_FACTORY
  })
])

export function createApplicationDomainCatalog(host: InstalledMainDomainHost): DomainModuleCatalog {
  const catalog = new DomainModuleCatalog()
  catalog.registerBatch([
    ...CORE_MAIN_DOMAIN_ENTRIES,
    ...createInstalledMainDomainEntries(host)
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
