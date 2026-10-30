import {
  type WorkspacePreviewPluginManifest,
  workspacePreviewPluginManifestSchema
} from '@sciforge/domain-sdk/workspace-preview'
import {
  LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS,
  domainPackageDefinition
} from './definition.js'

export type LifeScienceWorkspacePreviewPluginId =
  | 'molecular'
  | 'sequence-genomics'
  | 'biology-index-transport'
  | 'omics-matrix'
  | 'bioimaging'
  | 'proteomics-spectra'

export type LifeScienceWorkspacePreviewPluginContract = Readonly<{
  contributionId: string
  manifest: WorkspacePreviewPluginManifest
}>

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS:
readonly LifeScienceWorkspacePreviewPluginContract[] = Object.freeze(
  LIFE_SCIENCE_PREVIEW_CONTRIBUTION_IDS.map((contributionId) => Object.freeze({
    contributionId,
    manifest: canonicalManifestForContribution(contributionId)
  }))
)

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS:
readonly WorkspacePreviewPluginManifest[] = Object.freeze(
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.map(({ manifest }) => manifest)
)

export const LIFE_SCIENCE_WORKSPACE_PREVIEW_MANIFESTS_BY_PLUGIN_ID:
Readonly<Record<string, WorkspacePreviewPluginManifest>> = Object.freeze(Object.fromEntries(
  LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest])
))

export function lifeScienceWorkspacePreviewManifestForContribution(
  contributionId: string
): WorkspacePreviewPluginManifest | null {
  return LIFE_SCIENCE_WORKSPACE_PREVIEW_PLUGIN_CONTRACTS.find(
    (contract) => contract.contributionId === contributionId
  )?.manifest ?? null
}

function canonicalManifestForContribution(
  contributionId: string
): WorkspacePreviewPluginManifest {
  const contract = domainPackageDefinition.contributionContracts[contributionId]
  const parsed = workspacePreviewPluginManifestSchema.safeParse(contract)
  if (!parsed.success) {
    throw new Error(
      `Life Science Preview contribution ${contributionId} has an invalid canonical manifest.`
    )
  }
  // The definition's deeply frozen JSON value is the canonical object. Validate it without
  // returning Zod's clone so process entry contract and value.manifest can share identity.
  return contract as unknown as WorkspacePreviewPluginManifest
}
