import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
  type MainWorkspacePreviewPluginSlotContribution,
  type WorkspacePreviewProvider
} from '@sciforge/domain-sdk/workspace-preview'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from '../contract.js'
import {
  LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS,
  domainPackageDefinition
} from '../definition.js'
import { createLifeScienceWorkspacePreviewProvider } from './providers.js'

export type LifeSciencePreviewMainContribution =
  MainWorkspacePreviewPluginSlotContribution<WorkspacePreviewProvider>

export function createDomainMainEntry(
  _host: DomainMainHost
): TrustedDomainProcessEntryInput<LifeSciencePreviewMainContribution> {
  const contractsByContributionId = new Map(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => [contract.contributionId, contract])
  )
  return {
    definition: domainPackageDefinition,
    contributions: LIFE_SCIENCE_PREVIEW_MAIN_CONTRIBUTIONS.map((declaration) => {
      const contract = contractsByContributionId.get(declaration.id)
      if (!contract) throw new Error(`Life Science Preview main contribution ${declaration.id} has no canonical manifest.`)
      return Object.freeze({
        id: declaration.id,
        kind: MAIN_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND,
        contract: contract.manifest,
        value: Object.freeze({
          manifest: contract.manifest,
          provider: createLifeScienceWorkspacePreviewProvider(contract.manifest)
        })
      })
    })
  }
}

export {
  LIFE_SCIENCE_MOLECULAR_SELECTION_OPERATION_TYPE,
  createLifeScienceWorkspacePreviewProvider
} from './providers.js'
