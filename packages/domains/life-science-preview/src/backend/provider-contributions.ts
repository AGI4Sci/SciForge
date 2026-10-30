import type {
  DomainPackageContributionDeclaration
} from '@sciforge/domain-sdk/contract'
import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS
} from '../contract.js'
import {
  createLifeScienceWorkspacePreviewProvider
} from './providers.js'

export function createLifeScienceWorkspacePreviewProviderContributions<
  Kind extends string
>(
  declarations: readonly DomainPackageContributionDeclaration[],
  kind: Kind,
  processName: 'main' | 'workspace-server'
) {
  const contractsByContributionId = new Map(
    LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map((contract) => [
      contract.contributionId,
      contract
    ])
  )
  return declarations.map((declaration) => {
    const contract = contractsByContributionId.get(declaration.id)
    if (!contract) {
      throw new Error(
        `Life Science Preview ${processName} contribution ${declaration.id} has no canonical manifest.`
      )
    }
    return Object.freeze({
      id: declaration.id,
      kind,
      contract: contract.manifest,
      value: Object.freeze({
        manifest: contract.manifest,
        provider: createLifeScienceWorkspacePreviewProvider(contract.manifest)
      })
    })
  })
}
