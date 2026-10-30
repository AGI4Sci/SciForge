import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  type MainWorkspacePreviewPluginSlotContribution,
  type WorkspacePreviewProvider
} from '@sciforge/domain-sdk/workspace-preview'
import {
  LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS,
  domainPackageDefinition
} from '../definition.js'
import {
  createLifeScienceWorkspacePreviewProviderContributions
} from '../backend/provider-contributions.js'

export type LifeSciencePreviewMainContribution =
  MainWorkspacePreviewPluginSlotContribution<WorkspacePreviewProvider>

export function createDomainMainEntry(
  _host: DomainMainHost
): TrustedDomainProcessEntryInput<LifeSciencePreviewMainContribution> {
  return {
    definition: domainPackageDefinition,
    contributions: createLifeScienceWorkspacePreviewProviderContributions(
      LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS,
      MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
      'main'
    )
  }
}

export {
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE,
  createLifeScienceWorkspacePreviewProvider
} from '../backend/providers.js'
