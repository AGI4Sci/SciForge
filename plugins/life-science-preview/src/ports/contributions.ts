/**
 * Contribution metadata types for the workspace-preview slot contributions
 * this plugin assembles (kind `main.workspace-preview-plugin`, the
 * MainWorkspacePreviewPluginSlotContribution shape from the public SDK
 * contract). The canonical manifest table itself is plugin-owned data and
 * lives in dsh-adapter/contributions.ts, mirroring the trusted domain
 * package's sciforge.domain.json contributionContracts verbatim.
 */
import type { WorkspacePreviewPluginManifest } from '@sciforge/domain-sdk/workspace-preview'
import type { LifeScienceWorkspacePreviewProvider } from '../core/provider.js'

export type LifeScienceContributionDeclaration = Readonly<{
  id: string
}>

export type LifeSciencePreviewContribution = Readonly<{
  id: string
  kind: string
  contract: WorkspacePreviewPluginManifest
  value: Readonly<{
    manifest: WorkspacePreviewPluginManifest
    provider: LifeScienceWorkspacePreviewProvider
  }>
}>
