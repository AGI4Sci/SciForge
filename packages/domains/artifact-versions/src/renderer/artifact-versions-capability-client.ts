import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionBundleExportInputV1Schema,
  artifactVersionBundleExportResultV1Schema,
  artifactVersionBundleVerifyInputV1Schema,
  artifactVersionBundleVerifyResultV1Schema,
  artifactVersionCommitResultV1Schema,
  artifactVersionCompareInputV1Schema,
  artifactVersionCompareResultV1Schema,
  artifactVersionListInputV1Schema,
  artifactVersionListResultV1Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeResultV1Schema,
  artifactVersionRefreshInputV1Schema,
  artifactVersionRefreshResultV1Schema,
  artifactVersionRestoreAsNewInputV1Schema,
  type ArtifactVersionBundleExportInputV1,
  type ArtifactVersionBundleReceiptV1,
  type ArtifactVersionBundleVerificationV1,
  type ArtifactVersionBundleVerifyInputV1,
  type ArtifactVersionCommitReceiptV1,
  type ArtifactVersionCompareInputV1,
  type ArtifactVersionCompareV1,
  type ArtifactVersionListInputV1,
  type ArtifactVersionListV1,
  type ArtifactVersionMaterializeInputV1,
  type ArtifactVersionMaterializeReceiptV1,
  type ArtifactVersionRefreshInputV1,
  type ArtifactVersionRefreshV1,
  type ArtifactVersionRestoreAsNewInputV1,
  type ArtifactVersionResultV1
} from '../contract.js'

export const artifactVersionsCapabilityContracts = Object.freeze({
  list: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
    effect: 'read' as const,
    inputSchema: artifactVersionListInputV1Schema,
    outputSchema: artifactVersionListResultV1Schema
  },
  refresh: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh,
    effect: 'compute' as const,
    inputSchema: artifactVersionRefreshInputV1Schema,
    outputSchema: artifactVersionRefreshResultV1Schema
  },
  compare: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
    effect: 'read' as const,
    inputSchema: artifactVersionCompareInputV1Schema,
    outputSchema: artifactVersionCompareResultV1Schema
  },
  materialize: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionMaterializeInputV1Schema,
    outputSchema: artifactVersionMaterializeResultV1Schema
  },
  restoreAsNew: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionRestoreAsNewInputV1Schema,
    outputSchema: artifactVersionCommitResultV1Schema
  },
  exportBundle: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionBundleExportInputV1Schema,
    outputSchema: artifactVersionBundleExportResultV1Schema
  },
  verifyBundle: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle,
    effect: 'read' as const,
    inputSchema: artifactVersionBundleVerifyInputV1Schema,
    outputSchema: artifactVersionBundleVerifyResultV1Schema
  }
})

export type ArtifactVersionsCapabilityClient = Readonly<{
  list(
    workspaceRoot: string,
    input?: ArtifactVersionListInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionListV1>>
  refresh(
    workspaceRoot: string,
    input?: ArtifactVersionRefreshInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionRefreshV1>>
  compare(
    workspaceRoot: string,
    input: ArtifactVersionCompareInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCompareV1>>
  materialize(
    workspaceRoot: string,
    input: ArtifactVersionMaterializeInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionMaterializeReceiptV1>>
  restoreAsNew(
    workspaceRoot: string,
    input: ArtifactVersionRestoreAsNewInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCommitReceiptV1>>
  exportBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleExportInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleReceiptV1>>
  verifyBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleVerifyInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleVerificationV1>>
}>

export function createArtifactVersionsCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ArtifactVersionsCapabilityClient {
  return Object.freeze({
    list: (workspaceRoot, input = {}) => invoker.invoke(
      artifactVersionsCapabilityContracts.list,
      input,
      { workspaceId: workspaceRoot }
    ),
    refresh: (workspaceRoot, input = {}) => invoker.invoke(
      artifactVersionsCapabilityContracts.refresh,
      input,
      { workspaceId: workspaceRoot }
    ),
    compare: (workspaceRoot, input) => invoker.invoke(
      artifactVersionsCapabilityContracts.compare,
      input,
      { workspaceId: workspaceRoot }
    ),
    materialize: (workspaceRoot, input) => invoker.invoke(
      artifactVersionsCapabilityContracts.materialize,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    restoreAsNew: (workspaceRoot, input) => invoker.invoke(
      artifactVersionsCapabilityContracts.restoreAsNew,
      input,
      { workspaceId: workspaceRoot }
    ),
    exportBundle: (workspaceRoot, input) => invoker.invoke(
      artifactVersionsCapabilityContracts.exportBundle,
      input,
      { workspaceId: workspaceRoot }
    ),
    verifyBundle: (workspaceRoot, input) => invoker.invoke(
      artifactVersionsCapabilityContracts.verifyBundle,
      input,
      { workspaceId: workspaceRoot }
    )
  })
}
