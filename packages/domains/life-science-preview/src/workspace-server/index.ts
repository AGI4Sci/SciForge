import type { WorkspacePreviewProvider } from '@sciforge/domain-sdk/workspace-preview'
import {
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  type DomainWorkspaceServerEntryFactory,
  type WorkspaceServerWorkspacePreviewPluginSlotContribution
} from '@sciforge/domain-sdk/workspace-server'
import {
  LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS,
  domainPackageDefinition
} from '../definition.js'
import {
  createLifeScienceWorkspacePreviewProviderContributions
} from '../backend/provider-contributions.js'

export type LifeSciencePreviewWorkspaceServerContribution =
  WorkspaceServerWorkspacePreviewPluginSlotContribution<WorkspacePreviewProvider>

export const createDomainWorkspaceServerEntry:
  DomainWorkspaceServerEntryFactory<LifeSciencePreviewWorkspaceServerContribution> = (_host) => ({
  definition: domainPackageDefinition,
  contributions: createLifeScienceWorkspacePreviewProviderContributions(
    LIFE_SCIENCE_PREVIEW_WORKSPACE_SERVER_CONTRIBUTIONS,
    WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
    'workspace-server'
  )
})

export {
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE,
  createLifeScienceWorkspacePreviewProvider
} from '../backend/providers.js'
