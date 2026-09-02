import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionBundleExportInputV2Schema,
  artifactVersionBundleExportResultV2Schema,
  artifactVersionCommitResultV1Schema,
  artifactVersionCompareInputV1Schema,
  artifactVersionCompareResultV1Schema,
  artifactVersionDescribeInputV2Schema,
  artifactVersionDescribeResultV2Schema,
  artifactVersionListInputV2Schema,
  artifactVersionListResultV2Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeResultV1Schema,
  artifactVersionReadInputV1Schema,
  artifactVersionReadResultV1Schema,
  artifactVersionRestoreAsNewInputV1Schema,
  type ArtifactVersionBundleExportInputV2,
  type ArtifactVersionBundleReceiptV2,
  type ArtifactVersionCommitReceiptV1,
  type ArtifactVersionCompareInputV1,
  type ArtifactVersionCompareV1,
  type ArtifactVersionDescribeV2,
  type ArtifactVersionListInputV2,
  type ArtifactVersionListV2,
  type ArtifactVersionMaterializeInputV1,
  type ArtifactVersionMaterializeReceiptV1,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadV1,
  type ArtifactVersionResultV1,
  type ArtifactVersionRestoreAsNewInputV1,
} from '@sciforge/domain-artifact-versions/contract'
import {
  RESEARCH_CHECKPOINT_CAPABILITY_IDS,
  researchCheckpointLegacyImportInputV1Schema,
  researchCheckpointLegacyImportResultV1Schema,
  researchCheckpointLegacyPreviewInputV1Schema,
  researchCheckpointLegacyPreviewResultV1Schema,
  researchCheckpointReadInputV1Schema,
  researchCheckpointReadResultV1Schema,
  researchCheckpointRestoreAsNewInputV1Schema,
  researchCheckpointRestoreAsNewResultV1Schema,
  researchCheckpointStartInputV1Schema,
  researchCheckpointStartResultV1Schema,
  researchCheckpointStatusInputV1Schema,
  researchCheckpointStatusResultV1Schema,
  researchCheckpointStopInputV1Schema,
  researchCheckpointStopResultV1Schema,
  type ResearchCheckpointCommittedTurnStatusV1,
  type ResearchCheckpointLegacyImportInputV1,
  type ResearchCheckpointLegacyPreviewInputV1,
  type ResearchCheckpointLegacyPreviewV1,
  type ResearchCheckpointReadInputV1,
  type ResearchCheckpointRecordV1,
  type ResearchCheckpointResultV1,
  type ResearchCheckpointRestoreAsNewInputV1,
  type ResearchCheckpointRestoreAsNewReceiptV1,
  type ResearchCheckpointStartInputV1,
  type ResearchCheckpointStartReceiptV1,
  type ResearchCheckpointStatusInputV1,
  type ResearchCheckpointStatusV1,
  type ResearchCheckpointStopInputV1,
  type ResearchCheckpointStopReceiptV1
} from '@sciforge/domain-research-checkpoints/contract'

const contracts = Object.freeze({
  describeArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2,
    effect: 'read' as const,
    inputSchema: artifactVersionDescribeInputV2Schema,
    outputSchema: artifactVersionDescribeResultV2Schema
  },
  listArtifactVersions: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
    effect: 'read' as const,
    inputSchema: artifactVersionListInputV2Schema,
    outputSchema: artifactVersionListResultV2Schema
  },
  readArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
    effect: 'read' as const,
    inputSchema: artifactVersionReadInputV1Schema,
    outputSchema: artifactVersionReadResultV1Schema
  },
  materializeArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionMaterializeInputV1Schema,
    outputSchema: artifactVersionMaterializeResultV1Schema
  },
  compareArtifacts: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
    effect: 'read' as const,
    inputSchema: artifactVersionCompareInputV1Schema,
    outputSchema: artifactVersionCompareResultV1Schema
  },
  restoreArtifact: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionRestoreAsNewInputV1Schema,
    outputSchema: artifactVersionCommitResultV1Schema
  },
  restoreResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew,
    effect: 'workspace-write' as const,
    inputSchema: researchCheckpointRestoreAsNewInputV1Schema,
    outputSchema: researchCheckpointRestoreAsNewResultV1Schema
  },
  exportBundle: {
    actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundleV2,
    effect: 'workspace-write' as const,
    inputSchema: artifactVersionBundleExportInputV2Schema,
    outputSchema: artifactVersionBundleExportResultV2Schema
  },
  researchCheckpointStatus: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
    effect: 'read' as const,
    inputSchema: researchCheckpointStatusInputV1Schema,
    outputSchema: researchCheckpointStatusResultV1Schema
  },
  readResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read,
    effect: 'read' as const,
    inputSchema: researchCheckpointReadInputV1Schema,
    outputSchema: researchCheckpointReadResultV1Schema
  },
  startResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
    effect: 'workspace-write' as const,
    inputSchema: researchCheckpointStartInputV1Schema,
    outputSchema: researchCheckpointStartResultV1Schema
  },
  stopResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop,
    effect: 'workspace-write' as const,
    inputSchema: researchCheckpointStopInputV1Schema,
    outputSchema: researchCheckpointStopResultV1Schema
  },
  previewLegacyResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy,
    effect: 'read' as const,
    inputSchema: researchCheckpointLegacyPreviewInputV1Schema,
    outputSchema: researchCheckpointLegacyPreviewResultV1Schema
  },
  importLegacyResearchCheckpoint: {
    actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy,
    effect: 'workspace-write' as const,
    inputSchema: researchCheckpointLegacyImportInputV1Schema,
    outputSchema: researchCheckpointLegacyImportResultV1Schema
  }
})

export type ResearchDossierCapabilityClient = Readonly<{
  describeArtifactVersion(
    workspaceRoot: string,
    versionId: string
  ): Promise<ArtifactVersionResultV1<ArtifactVersionDescribeV2>>
  listArtifactVersions(
    workspaceRoot: string,
    input: ArtifactVersionListInputV2
  ): Promise<ArtifactVersionResultV1<ArtifactVersionListV2>>
  readArtifactVersion(
    workspaceRoot: string,
    input: ArtifactVersionReadInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionReadV1>>
  materializeArtifactVersion(
    workspaceRoot: string,
    input: ArtifactVersionMaterializeInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionMaterializeReceiptV1>>
  compareArtifactVersions(
    workspaceRoot: string,
    input: ArtifactVersionCompareInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCompareV1>>
  restoreArtifactVersionAsNew(
    workspaceRoot: string,
    input: ArtifactVersionRestoreAsNewInputV1
  ): Promise<ArtifactVersionResultV1<ArtifactVersionCommitReceiptV1>>
  restoreResearchCheckpointAsNew(
    workspaceRoot: string,
    input: ResearchCheckpointRestoreAsNewInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointRestoreAsNewReceiptV1>>
  exportArtifactBundle(
    workspaceRoot: string,
    input: ArtifactVersionBundleExportInputV2
  ): Promise<ArtifactVersionResultV1<ArtifactVersionBundleReceiptV2>>
  readResearchRecordingStatus(
    workspaceRoot: string,
    input: ResearchCheckpointStatusInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStatusV1>>
  readResearchCheckpoint(
    workspaceRoot: string,
    input: ResearchCheckpointReadInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointRecordV1>>
  startResearchRecording(
    workspaceRoot: string,
    input: ResearchCheckpointStartInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStartReceiptV1>>
  stopResearchRecording(
    workspaceRoot: string,
    input: ResearchCheckpointStopInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStopReceiptV1>>
  previewLegacyResearchTurns(
    workspaceRoot: string,
    input: ResearchCheckpointLegacyPreviewInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointLegacyPreviewV1>>
  importLegacyResearchTurns(
    workspaceRoot: string,
    input: ResearchCheckpointLegacyImportInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointCommittedTurnStatusV1>>
}>

export function createResearchDossierCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ResearchDossierCapabilityClient {
  return Object.freeze({
    describeArtifactVersion: (workspaceRoot, versionId) => invoker.invoke(
      contracts.describeArtifact,
      { versionId },
      { workspaceId: workspaceRoot }
    ),
    listArtifactVersions: (workspaceRoot, input) => invoker.invoke(
      contracts.listArtifactVersions,
      input,
      { workspaceId: workspaceRoot }
    ),
    readArtifactVersion: (workspaceRoot, input) => invoker.invoke(
      contracts.readArtifact,
      input,
      { workspaceId: workspaceRoot }
    ),
    materializeArtifactVersion: (workspaceRoot, input) => invoker.invoke(
      contracts.materializeArtifact,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    compareArtifactVersions: (workspaceRoot, input) => invoker.invoke(
      contracts.compareArtifacts,
      input,
      { workspaceId: workspaceRoot }
    ),
    restoreArtifactVersionAsNew: (workspaceRoot, input) => invoker.invoke(
      contracts.restoreArtifact,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    restoreResearchCheckpointAsNew: (workspaceRoot, input) => invoker.invoke(
      contracts.restoreResearchCheckpoint,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    exportArtifactBundle: (workspaceRoot, input) => invoker.invoke(
      contracts.exportBundle,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    readResearchRecordingStatus: (workspaceRoot, input) => invoker.invoke(
      contracts.researchCheckpointStatus,
      input,
      { workspaceId: workspaceRoot }
    ),
    readResearchCheckpoint: (workspaceRoot, input) => invoker.invoke(
      contracts.readResearchCheckpoint,
      input,
      { workspaceId: workspaceRoot }
    ),
    startResearchRecording: (workspaceRoot, input) => invoker.invoke(
      contracts.startResearchCheckpoint,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    stopResearchRecording: (workspaceRoot, input) => invoker.invoke(
      contracts.stopResearchCheckpoint,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    ),
    previewLegacyResearchTurns: (workspaceRoot, input) => invoker.invoke(
      contracts.previewLegacyResearchCheckpoint,
      input,
      { workspaceId: workspaceRoot }
    ),
    importLegacyResearchTurns: (workspaceRoot, input) => invoker.invoke(
      contracts.importLegacyResearchCheckpoint,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    )
  })
}

export const researchDossierCapabilityContracts = contracts
